import { createHmac, randomBytes } from 'node:crypto';
import { prisma } from '../db.js';
import { bus, type EventTopic } from './events.js';
import { logger } from './logger.js';

// Wires the in-memory event bus to outbound HTTP delivery for every active
// WebhookSubscription. Each delivery is signed with HMAC-SHA256 so the
// receiver can verify the payload originated from us:
//
//   X-BSN-Signature: sha256=<hex>
//   X-BSN-Event: <topic>
//   X-BSN-Delivery: <delivery row id>
//   X-BSN-Attempt: <n>
//
// Retry policy: exponential-ish backoff at 30s, 5m, 30m (4 total attempts
// counting the immediate fire). After the final failure the row is marked
// `dead_letter` and stays dormant until an operator manually retries it.

const BACKOFF_MS = [30_000, 5 * 60_000, 30 * 60_000];
const FETCH_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 30_000;
const TOPICS_TO_FORWARD: EventTopic[] = [
  'kunjungan.created',
  'kunjungan.reviewed',
  'nasabah.reassign',
  'blast.completed',
];

export function generateWebhookSecret(): string {
  return 'whsec_' + randomBytes(32).toString('hex');
}

// Try to deliver one row. On failure either schedules the next retry (when
// attempts < BACKOFF_MS.length + 1) or marks dead_letter.
async function attempt(deliveryId: string): Promise<void> {
  const row = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { webhook: true },
  });
  if (!row || !row.webhook.active) return;

  const attemptNum = row.attempts + 1;
  const body = JSON.stringify(row.payload);
  const sig = createHmac('sha256', row.webhook.secret).update(body).digest('hex');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let responseStatus: number | null = null;
  let error: string | null = null;
  let ok = false;

  try {
    const r = await fetch(row.webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-BSN-Event': row.event,
        'X-BSN-Signature': `sha256=${sig}`,
        'X-BSN-Delivery': row.id,
        'X-BSN-Attempt': String(attemptNum),
      },
      body,
      signal: controller.signal,
    });
    responseStatus = r.status;
    ok = r.ok;
    if (!ok) error = `HTTP ${r.status}`;
  } catch (e: any) {
    error = String(e?.message ?? e).slice(0, 500);
  } finally {
    clearTimeout(timeout);
  }

  if (ok) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'success', responseStatus, attempts: attemptNum,
        lastAttemptAt: new Date(), nextAttemptAt: null, error: null,
      },
    });
    await prisma.webhookSubscription.update({
      where: { id: row.webhookId },
      data: { lastDeliveryAt: new Date() },
    });
    return;
  }

  // Failure: schedule next retry, or dead-letter when backoff exhausted.
  // attemptNum 1 → use BACKOFF_MS[0] for retry #2, etc. After all BACKOFF_MS
  // slots are consumed (attemptNum > BACKOFF_MS.length) the row is dead.
  const nextBackoff = BACKOFF_MS[attemptNum - 1];
  const finalStatus = nextBackoff === undefined ? 'dead_letter' : 'pending';
  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: finalStatus, responseStatus, attempts: attemptNum,
      lastAttemptAt: new Date(),
      nextAttemptAt: nextBackoff === undefined ? null : new Date(Date.now() + nextBackoff),
      error,
    },
  });
  if (finalStatus === 'dead_letter') {
    logger.warn({ deliveryId, webhookId: row.webhookId, attempts: attemptNum, error },
      'webhook_dead_letter');
  }
}

// Sweep ready-to-retry rows. Bounded fetch so a flood of retries can't
// overrun the worker — leftovers will be picked up on the next poll.
async function sweep(): Promise<void> {
  const due = await prisma.webhookDelivery.findMany({
    where: { status: 'pending', nextAttemptAt: { lte: new Date() } },
    select: { id: true },
    take: 50,
    orderBy: { nextAttemptAt: 'asc' },
  });
  for (const d of due) {
    await attempt(d.id).catch(e =>
      logger.warn({ err: String(e), deliveryId: d.id }, 'webhook_attempt_threw'));
  }
}

async function fanout(topic: string, data: Record<string, unknown>): Promise<void> {
  const subs = await prisma.webhookSubscription.findMany({
    where: { active: true },
    select: { id: true, events: true, branchId: true },
  });
  const branchId = (data.branchId ?? null) as string | null;
  const matching = subs.filter(s => {
    if (s.events.length > 0 && !s.events.includes(topic)) return false;
    if (s.branchId && branchId && s.branchId !== branchId) return false;
    return true;
  });

  for (const s of matching) {
    const row = await prisma.webhookDelivery.create({
      data: {
        webhookId: s.id, event: topic,
        payload: { event: topic, data, timestamp: new Date().toISOString() } as any,
        status: 'pending', attempts: 0, nextAttemptAt: new Date(),
      },
    });
    void attempt(row.id).catch(e =>
      logger.warn({ err: String(e), deliveryId: row.id }, 'webhook_attempt_threw'));
  }
}

let unsub: (() => void) | null = null;
let timer: NodeJS.Timeout | null = null;

export function startWebhookDispatcher(): void {
  if (unsub) return;
  unsub = bus.subscribe(ev => {
    if (!TOPICS_TO_FORWARD.includes(ev.topic)) return;
    fanout(ev.topic, ev.data).catch(e =>
      logger.warn({ err: String(e) }, 'webhook_fanout_failed'));
  });
  timer = setInterval(() => {
    sweep().catch(e => logger.warn({ err: String(e) }, 'webhook_sweep_failed'));
  }, POLL_INTERVAL_MS);
  logger.info({ topics: TOPICS_TO_FORWARD, pollMs: POLL_INTERVAL_MS }, 'webhook_dispatcher_started');
}

export function stopWebhookDispatcher(): void {
  if (unsub) unsub();
  unsub = null;
  if (timer) clearInterval(timer);
  timer = null;
}

// Manual retry — resets the row to pending and fires one attempt now,
// regardless of dead-letter status. The operator UI surfaces this.
export async function manualRetryDelivery(deliveryId: string): Promise<void> {
  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: { status: 'pending', nextAttemptAt: new Date(), error: null },
  });
  await attempt(deliveryId);
}

// Test helpers.
export const __attemptForTests = attempt;
export const __sweepForTests = sweep;
