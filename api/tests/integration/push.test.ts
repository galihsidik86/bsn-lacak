import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, username: string, password: string): Promise<string> {
  const r = await request(app).post('/api/auth/login').send({ username, password });
  return r.body.token as string;
}

d('push subscribe', () => {
  const app = buildApp();
  let s: SeedOut;
  let petTok: string;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
    petTok = await login(app, s.petugasAUsername, s.password);
  });

  it('rejects subscribe without auth', async () => {
    const r = await request(app).post('/api/push/subscribe')
      .send({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'a', auth: 'b' } });
    expect(r.status).toBe(401);
  });

  it('stores a subscription on first POST', async () => {
    const r = await request(app).post('/api/push/subscribe')
      .set('Authorization', `Bearer ${petTok}`)
      .send({
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
        keys: { p256dh: 'p256-key', auth: 'auth-key' },
      });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    const sub = await prisma.pushSubscription.findUnique({
      where: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123' },
    });
    expect(sub).not.toBeNull();
    expect(sub!.userId).toBe(s.petugasUserAId);
  });

  it('rebinds subscription endpoint to the new user on conflict', async () => {
    // First user subscribes the endpoint.
    await request(app).post('/api/push/subscribe')
      .set('Authorization', `Bearer ${petTok}`)
      .send({
        endpoint: 'https://fcm.googleapis.com/fcm/send/shared',
        keys: { p256dh: 'p1', auth: 'a1' },
      });
    // A second user (supervisor) hits same endpoint on a shared device.
    const supTok = await login(app, s.supervisorAUsername, s.password);
    const r = await request(app).post('/api/push/subscribe')
      .set('Authorization', `Bearer ${supTok}`)
      .send({
        endpoint: 'https://fcm.googleapis.com/fcm/send/shared',
        keys: { p256dh: 'p2', auth: 'a2' },
      });
    expect(r.status).toBe(200);
    const sub = await prisma.pushSubscription.findUnique({
      where: { endpoint: 'https://fcm.googleapis.com/fcm/send/shared' },
    });
    expect(sub!.userId).toBe(s.supervisorAId);
  });

  it('unsubscribes only the requesting user own endpoint', async () => {
    await request(app).post('/api/push/subscribe')
      .set('Authorization', `Bearer ${petTok}`)
      .send({
        endpoint: 'https://fcm.googleapis.com/fcm/send/mine',
        keys: { p256dh: 'p', auth: 'a' },
      });
    const r = await request(app).post('/api/push/unsubscribe')
      .set('Authorization', `Bearer ${petTok}`)
      .send({ endpoint: 'https://fcm.googleapis.com/fcm/send/mine' });
    expect(r.status).toBe(200);
    const sub = await prisma.pushSubscription.findUnique({
      where: { endpoint: 'https://fcm.googleapis.com/fcm/send/mine' },
    });
    expect(sub).toBeNull();
  });

  it('400 on malformed payload', async () => {
    const r = await request(app).post('/api/push/subscribe')
      .set('Authorization', `Bearer ${petTok}`)
      .send({ endpoint: 'not-a-url', keys: { p256dh: 'a' } });
    expect(r.status).toBe(400);
  });
});
