import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

async function postKunjungan(app: ReturnType<typeof buildApp>, tok: string, s: SeedOut) {
  const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
  return await request(app).post('/api/kunjungan')
    .set('Authorization', `Bearer ${tok}`)
    .field('nasabahId', n!.id)
    .field('petugasId', s.petugasAId)
    .field('hasil', 'BAYAR')
    .field('nominal', '100000')
    .field('catatan', 'ok')
    .field('lokasi', 'Jl. A');
}

d('Customer feedback', () => {
  const app = buildApp();
  let s: SeedOut;
  let petTok: string;
  let supTok: string;
  let supBTok: string;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
    petTok = await login(app, s.petugasAUsername, s.password);
    supTok = await login(app, s.supervisorAUsername, s.password);
    supBTok = await login(app, s.supervisorBUsername, s.password);
  });

  it('creating a kunjungan enqueues a feedback row', async () => {
    const k = await postKunjungan(app, petTok, s);
    expect(k.status).toBe(201);
    // enqueue is fire-and-forget; allow the microtask to flush.
    await new Promise(r => setTimeout(r, 100));
    const fb = await prisma.customerFeedback.findUnique({ where: { kunjunganId: k.body.id } });
    expect(fb).not.toBeNull();
    expect(fb!.token).toMatch(/^[a-f0-9]{48}$/);
  });

  it('public GET /:token returns the feedback summary', async () => {
    const k = await postKunjungan(app, petTok, s);
    await new Promise(r => setTimeout(r, 100));
    const fb = await prisma.customerFeedback.findUnique({ where: { kunjunganId: k.body.id } });
    const r = await request(app).get(`/api/feedback/${fb!.token}`);
    expect(r.status).toBe(200);
    expect(r.body.nasabahNama).toBeTruthy();
    expect(r.body.petugasNama).toBe('Test Petugas Satu');
    expect(r.body.rating).toBeNull();
  });

  it('public POST submits rating + comment', async () => {
    const k = await postKunjungan(app, petTok, s);
    await new Promise(r => setTimeout(r, 100));
    const fb = await prisma.customerFeedback.findUnique({ where: { kunjunganId: k.body.id } });
    const r = await request(app).post(`/api/feedback/${fb!.token}`)
      .send({ rating: 4, comment: 'sopan' });
    expect(r.status).toBe(200);
    const stored = await prisma.customerFeedback.findUnique({ where: { token: fb!.token } });
    expect(stored!.rating).toBe(4);
    expect(stored!.comment).toBe('sopan');
    expect(stored!.repliedAt).not.toBeNull();
  });

  it('rejects re-submission with 409', async () => {
    const k = await postKunjungan(app, petTok, s);
    await new Promise(r => setTimeout(r, 100));
    const fb = await prisma.customerFeedback.findUnique({ where: { kunjunganId: k.body.id } });
    await request(app).post(`/api/feedback/${fb!.token}`).send({ rating: 3 });
    const r2 = await request(app).post(`/api/feedback/${fb!.token}`).send({ rating: 5 });
    expect(r2.status).toBe(409);
  });

  it('rejects bad token shape with 404', async () => {
    const r = await request(app).get('/api/feedback/not-a-token');
    expect(r.status).toBe(404);
  });

  it('rejects out-of-range rating with 400', async () => {
    const k = await postKunjungan(app, petTok, s);
    await new Promise(r => setTimeout(r, 100));
    const fb = await prisma.customerFeedback.findUnique({ where: { kunjunganId: k.body.id } });
    const r = await request(app).post(`/api/feedback/${fb!.token}`).send({ rating: 7 });
    expect(r.status).toBe(400);
  });

  it('SUPERVISOR sees branch-scoped list, no cross-branch leak', async () => {
    const k = await postKunjungan(app, petTok, s);
    await new Promise(r => setTimeout(r, 100));
    const fb = await prisma.customerFeedback.findUnique({ where: { kunjunganId: k.body.id } });
    await request(app).post(`/api/feedback/${fb!.token}`).send({ rating: 2 });
    const r1 = await request(app).get('/api/feedback').set('Authorization', `Bearer ${supTok}`);
    expect(r1.body.length).toBe(1);
    const r2 = await request(app).get('/api/feedback').set('Authorization', `Bearer ${supBTok}`);
    expect(r2.body.length).toBe(0);
  });

  it('PETUGAS cannot list feedback (403)', async () => {
    const r = await request(app).get('/api/feedback').set('Authorization', `Bearer ${petTok}`);
    expect(r.status).toBe(403);
  });

  it('by-petugas rollup returns avg rating', async () => {
    const k = await postKunjungan(app, petTok, s);
    await new Promise(r => setTimeout(r, 100));
    const fb = await prisma.customerFeedback.findUnique({ where: { kunjunganId: k.body.id } });
    await request(app).post(`/api/feedback/${fb!.token}`).send({ rating: 5 });
    const r = await request(app).get('/api/feedback/by-petugas').set('Authorization', `Bearer ${supTok}`);
    expect(r.status).toBe(200);
    const row = r.body.rows.find((x: any) => x.petugasId === s.petugasAId);
    expect(row).toBeTruthy();
    expect(row._avg.rating).toBe(5);
  });
});
