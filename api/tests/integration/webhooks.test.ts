import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('Webhook subscriptions', () => {
  const app = buildApp();
  let s: SeedOut;
  let adminTok: string;
  let supTok: string;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
    adminTok = await login(app, s.adminUsername, s.password);
    supTok = await login(app, s.supervisorAUsername, s.password);
  });

  it('ADMIN creates a webhook and gets the secret once', async () => {
    const r = await request(app).post('/api/webhooks')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: 'ERP', url: 'https://example.com/hook', events: ['kunjungan.created'] });
    expect(r.status).toBe(201);
    expect(r.body.secret).toMatch(/^whsec_[a-f0-9]{64}$/);
  });

  it('SUPERVISOR cannot manage webhooks (403)', async () => {
    const r = await request(app).post('/api/webhooks')
      .set('Authorization', `Bearer ${supTok}`)
      .send({ name: 'x', url: 'https://example.com/x' });
    expect(r.status).toBe(403);
  });

  it('PATCH toggles active', async () => {
    const c = await request(app).post('/api/webhooks')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: 'X', url: 'https://example.com/x' });
    const r = await request(app).patch(`/api/webhooks/${c.body.id}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ active: false });
    expect(r.body.active).toBe(false);
  });

  it('LIST does not expose secrets', async () => {
    await request(app).post('/api/webhooks')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: 'X', url: 'https://example.com/x' });
    const r = await request(app).get('/api/webhooks')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.body.length).toBeGreaterThan(0);
    expect(r.body[0]).not.toHaveProperty('secret');
  });

  it('400 on invalid url', async () => {
    const r = await request(app).post('/api/webhooks')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: 'X', url: 'not-a-url' });
    expect(r.status).toBe(400);
  });

  it('DELETE removes the webhook', async () => {
    const c = await request(app).post('/api/webhooks')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: 'X', url: 'https://example.com/x' });
    await request(app).delete(`/api/webhooks/${c.body.id}`)
      .set('Authorization', `Bearer ${adminTok}`);
    const r = await request(app).get(`/api/webhooks/${c.body.id}/deliveries`)
      .set('Authorization', `Bearer ${adminTok}`);
    // Deliveries returns [] for a deleted webhook (cascade), not 404.
    expect(r.body).toEqual([]);
  });
});
