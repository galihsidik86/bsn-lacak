import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('Analytics endpoints', () => {
  const app = buildApp();
  let s: SeedOut;
  let supTok: string;
  let adminTok: string;
  let petTok: string;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
    supTok = await login(app, s.supervisorAUsername, s.password);
    adminTok = await login(app, s.adminUsername, s.password);
    petTok = await login(app, s.petugasAUsername, s.password);
  });

  it('PETUGAS is rejected with 403', async () => {
    const r = await request(app).get('/api/analytics/overview')
      .set('Authorization', `Bearer ${petTok}`);
    expect(r.status).toBe(403);
  });

  it('SUPERVISOR sees branch-scoped overview', async () => {
    const r = await request(app).get('/api/analytics/overview')
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('revenue');
    expect(r.body).toHaveProperty('leaderboard');
    expect(r.body).toHaveProperty('posture');
    // Branch B's data should not leak into supervisor A's response.
    for (const row of r.body.leaderboard) {
      expect(row.branchNama).not.toBe('Test Cabang B');
    }
  });

  it('ADMIN sees all branches in revenue rollup', async () => {
    const r = await request(app).get('/api/analytics/overview')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(200);
    const branchNames = new Set(r.body.revenue.map((x: any) => x.branchNama));
    expect(branchNames.has('Test Cabang A')).toBe(true);
    expect(branchNames.has('Test Cabang B')).toBe(true);
  });

  it('closing.csv returns text/csv with BOM header', async () => {
    const now = new Date();
    const r = await request(app)
      .get(`/api/analytics/closing.csv?year=${now.getFullYear()}&month=${now.getMonth() + 1}`)
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.text.charCodeAt(0)).toBe(0xfeff);   // BOM
    expect(r.text).toMatch(/Bulan,Kode Cabang/);
  });

  it('closing endpoint rejects malformed year/month', async () => {
    const r = await request(app)
      .get('/api/analytics/closing?year=abc&month=13')
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.status).toBe(400);
  });
});
