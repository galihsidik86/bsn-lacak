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
//
// One retry on a 5xx or network failure; failure is recorded either way so
// the operator UI can show the delivery history.

const RETRY_MS = 5_000;
const FETCH_TIMEOUT_MS = 10_000;
const TOPICS_TO_FORWARD: EventTopic[] = [
  'kunjungan.created',
  'kunjungan.reviewed',
  'nasabah.reassign',
  'blast.completed',
];

export function generateWebhookSecret(): string {
  return 'whsec_' + randomBytes(32).toString('hex');
}

async function deliver(subId: string, event: string, payload: unknown, attempt = 1): Promise<void> {
  const sub = await prisma.webhookSubscription.findUnique({ where: { id: subId } });
  if (!sub || !sub.active) return;

  const body = JSON.stringify(payload);
  const sig = createHmac('sha256', sub.secret).update(body).digest('hex');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let status: 'success' | 'failed' | 'retrying' = 'failed';
  let responseStatus: number | null = null;
  let error: string | null = null;

  try {
    const r = await fetch(sub.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-BSN-Event': event,
        'X-BSN-Signature': `sha256=${sig}`,
      },
      body,
      signal: controller.signal,
    });
    responseStatus = r.status;
    if (r.ok) status = 'success';
    else if (r.status >= 500 && attempt === 1) status = 'retrying';
    else status = 'failed';
  } catch (e: any) {
    error = String(e?.message ?? e).slice(0, 500);
    status = attempt === 1 ? 'retrying' : 'failed';
  } finally {
    clearTimeout(timeout);
  }

  await prisma.webhookDelivery.create({
    data: {
      webhookId: subId,
      event,
      payload: payload as any,
      status,
      responseStatus,
      attempts: attempt,
      error,
    },
  });
  await prisma.webhookSubscription.update({
    where: { id: subId },
    data: { lastDeliveryAt: new Date() },
  });

  if (status === 'retrying') {
    setTimeout(() => {
      void deliver(subId, event, payload, attempt + 1).catch(e =>
        logger.warn({ err: String(e), subId, event }, 'webhook_retry_threw'));
    }, RETRY_MS);
  }
}

async function fanout(topic: string, data: Record<string, unknown>): Promise<void> {
  const subs = await prisma.webhookSubscription.findMany({
    where: { active: true },
    select: { id: true, events: true, branchId: true },
  });
  const branchId = (data.branchId ?? null) as string | null;
  const matching = subs.filter(s => {
    // Empty events array = subscribe to everything.
    if (s.events.length > 0 && !s.events.includes(topic)) return false;
    // Branch-scoped subscription only sees its own branch events. Events
    // without a branchId field (e.g. blast.completed for global blast)
    // still fan out to ALL subscriptions.
    if (s.branchId && branchId && s.branchId !== branchId) return false;
    return true;
  });

  for (const s of matching) {
    void deliver(s.id, topic, { event: topic, data, timestamp: new Date().toISOString() })
      .catch(e => logger.warn({ err: String(e), subId: s.id }, 'webhook_dispatch_failed'));
  }
}

let unsub: (() => void) | null = null;

export function startWebhookDispatcher(): void {
  if (unsub) return;
  unsub = bus.subscribe(ev => {
    if (!TOPICS_TO_FORWARD.includes(ev.topic)) return;
    fanout(ev.topic, ev.data).catch(e => logger.warn({ err: String(e) }, 'webhook_fanout_failed'));
  });
  logger.info({ topics: TOPICS_TO_FORWARD }, 'webhook_dispatcher_started');
}

export function stopWebhookDispatcher(): void {
  if (unsub) unsub();
  unsub = null;
}
