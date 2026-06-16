import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('Saved filters', () => {
  const app = buildApp();
  let s: SeedOut;
  let supTok: string;
  let supBTok: string;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
    supTok = await login(app, s.supervisorAUsername, s.password);
    supBTok = await login(app, s.supervisorBUsername, s.password);
  });

  it('creates, lists, and deletes filters per-user', async () => {
    const c = await request(app).post('/api/saved-filters')
      .set('Authorization', `Bearer ${supTok}`)
      .send({ screen: 'laporan', name: 'Pending hari ini', payload: { status: 'pending' } });
    expect(c.status).toBe(201);

    const r = await request(app).get('/api/saved-filters?screen=laporan')
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.body.length).toBe(1);

    await request(app).delete(`/api/saved-filters/${c.body.id}`)
      .set('Authorization', `Bearer ${supTok}`);
    const r2 = await request(app).get('/api/saved-filters?screen=laporan')
      .set('Authorization', `Bearer ${supTok}`);
    expect(r2.body.length).toBe(0);
  });

  it('cross-user filters do not leak', async () => {
    await request(app).post('/api/saved-filters')
      .set('Authorization', `Bearer ${supTok}`)
      .send({ screen: 'laporan', name: 'A1', payload: { x: 1 } });
    const r = await request(app).get('/api/saved-filters?screen=laporan')
      .set('Authorization', `Bearer ${supBTok}`);
    expect(r.body).toEqual([]);
  });

  it('400 on malformed screen slug', async () => {
    const r = await request(app).post('/api/saved-filters')
      .set('Authorization', `Bearer ${supTok}`)
      .send({ screen: 'has spaces!', name: 'X', payload: {} });
    expect(r.status).toBe(400);
  });

  it('PATCH updates payload', async () => {
    const c = await request(app).post('/api/saved-filters')
      .set('Authorization', `Bearer ${supTok}`)
      .send({ screen: 'audit', name: 'v1', payload: { since: 'old' } });
    const r = await request(app).patch(`/api/saved-filters/${c.body.id}`)
      .set('Authorization', `Bearer ${supTok}`)
      .send({ payload: { since: 'new' } });
    expect(r.status).toBe(200);
    expect(r.body.payload.since).toBe('new');
  });
});
