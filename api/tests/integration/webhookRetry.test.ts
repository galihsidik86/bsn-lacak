import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';
import { __attemptForTests, manualRetryDelivery } from '../../src/lib/webhookDispatcher.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

// Make a delivery row tied to a webhook subscription. The caller controls
// the URL by passing an http.MockedFunction; we stub global fetch per-test.
async function makeDelivery(s: SeedOut, url: string) {
  // The webhook subscription needs a createdById — borrow the admin seed user.
  const admin = await prisma.user.findFirst({ where: { username: 'admin1' } });
  const sub = await prisma.webhookSubscription.create({
    data: {
      name: 'test', url, secret: 'whsec_' + 'a'.repeat(64),
      events: ['kunjungan.created'], active: true,
      createdById: admin!.id, branchId: s.branchAId,
    },
  });
  const del = await prisma.webhookDelivery.create({
    data: {
      webhookId: sub.id, event: 'kunjungan.created',
      payload: { event: 'kunjungan.created', data: {} } as any,
      status: 'pending', attempts: 0, nextAttemptAt: new Date(),
    },
  });
  return { sub, del };
}

d('Webhook retry + dead-letter', () => {
  const app = buildApp();
  let s: SeedOut;
  let adminTok: string;
  const originalFetch = global.fetch;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => {
    await prisma.$disconnect();
    global.fetch = originalFetch;
  });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
    adminTok = await login(app, s.adminUsername, s.password);
    global.fetch = originalFetch;
  });

  it('success on first attempt sets status=success', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 }) as any;
    const { del } = await makeDelivery(s, 'https://example.com/ok');
    await __attemptForTests(del.id);
    const after = await prisma.webhookDelivery.findUnique({ where: { id: del.id } });
    expect(after!.status).toBe('success');
    expect(after!.attempts).toBe(1);
    expect(after!.nextAttemptAt).toBeNull();
  });

  it('failure schedules pending + nextAttemptAt in future', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as any;
    const { del } = await makeDelivery(s, 'https://example.com/fail');
    await __attemptForTests(del.id);
    const after = await prisma.webhookDelivery.findUnique({ where: { id: del.id } });
    expect(after!.status).toBe('pending');
    expect(after!.attempts).toBe(1);
    expect(after!.nextAttemptAt).not.toBeNull();
    expect(after!.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('dead-letters after the backoff array is exhausted', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as any;
    const { del } = await makeDelivery(s, 'https://example.com/fail');
    // BACKOFF_MS has 3 slots → after the immediate fire + 3 retries = 4
    // attempts the row should be dead-letter.
    await __attemptForTests(del.id);
    await __attemptForTests(del.id);
    await __attemptForTests(del.id);
    await __attemptForTests(del.id);
    const after = await prisma.webhookDelivery.findUnique({ where: { id: del.id } });
    expect(after!.status).toBe('dead_letter');
    expect(after!.attempts).toBe(4);
    expect(after!.nextAttemptAt).toBeNull();
  });

  it('manual retry endpoint resets + re-fires', async () => {
    let count = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      count++;
      // Fail once, then succeed.
      return Promise.resolve({ ok: count > 1, status: count > 1 ? 200 : 500 });
    }) as any;
    const { del } = await makeDelivery(s, 'https://example.com/once');
    await __attemptForTests(del.id);
    let after = await prisma.webhookDelivery.findUnique({ where: { id: del.id } });
    expect(after!.status).toBe('pending');

    // Operator hits retry — should succeed on the second fetch.
    const r = await request(app).post(`/api/webhooks/deliveries/${del.id}/retry`)
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(200);
    after = await prisma.webhookDelivery.findUnique({ where: { id: del.id } });
    expect(after!.status).toBe('success');
  });

  it('SUPERVISOR cannot retry (admin-only route)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as any;
    const { del } = await makeDelivery(s, 'https://example.com/fail');
    await __attemptForTests(del.id);
    const supTok = await login(app, s.supervisorAUsername, s.password);
    const r = await request(app).post(`/api/webhooks/deliveries/${del.id}/retry`)
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.status).toBe(403);
  });

  it('GET /:id/deliveries supports status filter', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as any;
    const { sub, del } = await makeDelivery(s, 'https://example.com/fail');
    await __attemptForTests(del.id);
    // Also create a success row.
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 }) as any;
    const ok = await prisma.webhookDelivery.create({
      data: {
        webhookId: sub.id, event: 'kunjungan.created',
        payload: {} as any, status: 'pending', attempts: 0, nextAttemptAt: new Date(),
      },
    });
    await __attemptForTests(ok.id);

    const r = await request(app).get(`/api/webhooks/${sub.id}/deliveries?status=pending`)
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(200);
    expect(r.body.every((d: any) => d.status === 'pending')).toBe(true);
    expect(r.body.length).toBe(1);
  });

  // Smoke test the exported manualRetryDelivery so it's covered as a lib fn.
  it('manualRetryDelivery resets + reattempts', async () => {
    let count = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      count++;
      return Promise.resolve({ ok: count > 1, status: count > 1 ? 200 : 500 });
    }) as any;
    const { del } = await makeDelivery(s, 'https://example.com/once');
    await __attemptForTests(del.id);
    await manualRetryDelivery(del.id);
    const after = await prisma.webhookDelivery.findUnique({ where: { id: del.id } });
    expect(after!.status).toBe('success');
  });
});
