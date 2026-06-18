import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('petugas profile (BQ) + monthly leaderboard (BU)', () => {
  const app = buildApp();
  let s: SeedOut;
  let adminTok: string;
  let supTok: string;
  let petTok: string;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
    adminTok = await login(app, s.adminUsername, s.password);
    supTok = await login(app, s.supervisorAUsername, s.password);
    petTok = await login(app, s.petugasAUsername, s.password);
  });

  // --- BQ ---------------------------------------------------------------

  it('petugas profile returns bio + rollup + recent kunjungan', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    await prisma.kunjungan.create({
      data: {
        nasabahId: n!.id, petugasId: s.petugasAId, branchId: s.branchAId,
        hasil: 'BAYAR', nominal: 75_000n, catatan: '', lokasi: '',
        jam: '10:00', tanggal: new Date(), reviewStatus: 'APPROVED',
      },
    });
    await prisma.pembayaran.create({
      data: {
        nasabahId: n!.id, branchId: s.branchAId,
        nominal: 75_000n, metode: 'tunai', status: 'berhasil',
        jam: '10:00', tanggal: new Date(),
      },
    });

    const r = await request(app).get(`/api/petugas/${s.petugasAId}/profile`)
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(200);
    expect(r.body.petugas.kode).toBe('PT1');
    expect(r.body.rollup30d.totalVisits).toBeGreaterThanOrEqual(1);
    expect(r.body.rollup30d.collected).toBeGreaterThanOrEqual(75_000);
    expect(r.body.recentKunjungan.length).toBeGreaterThanOrEqual(1);
  });

  it('petugas profile is branch-scoped for SUPERVISOR', async () => {
    const r = await request(app).get(`/api/petugas/${s.petugasBId}/profile`)
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.status).toBe(404);
  });

  it('PETUGAS forbidden on petugas profile', async () => {
    const r = await request(app).get(`/api/petugas/${s.petugasAId}/profile`)
      .set('Authorization', `Bearer ${petTok}`);
    expect(r.status).toBe(403);
  });

  // --- BU ---------------------------------------------------------------

  it('monthly leaderboard ranks by collected desc', async () => {
    const n1 = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const n3 = await prisma.nasabah.findFirst({ where: { kode: 'N0003' } });
    const now = new Date();
    // petugasA: 200k; petugasB equivalent (other branch but ADMIN sees all):
    await prisma.pembayaran.create({
      data: {
        nasabahId: n1!.id, branchId: s.branchAId,
        nominal: 200_000n, metode: 'tunai', status: 'berhasil',
        jam: '10:00', tanggal: now,
      },
    });
    await prisma.pembayaran.create({
      data: {
        nasabahId: n3!.id, branchId: s.branchAId,
        nominal: 50_000n, metode: 'tunai', status: 'berhasil',
        jam: '10:00', tanggal: now,
      },
    });

    const r = await request(app).get(`/api/analytics/leaderboard-monthly?year=${now.getFullYear()}&month=${now.getMonth() + 1}`)
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(200);
    expect(r.body.rows.length).toBeGreaterThanOrEqual(2);
    expect(r.body.rows[0].kode).toBe('PT1');
    expect(r.body.rows[0].collected).toBe(200_000);
  });

  it('SUPERVISOR leaderboard auto-scoped to their branch', async () => {
    const r = await request(app).get('/api/analytics/leaderboard-monthly')
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.body.rows.every((x: any) => x.branchKode === 'TST001')).toBe(true);
  });

  it('PETUGAS forbidden on leaderboard', async () => {
    const r = await request(app).get('/api/analytics/leaderboard-monthly')
      .set('Authorization', `Bearer ${petTok}`);
    expect(r.status).toBe(403);
  });

  it('rejects out-of-range month', async () => {
    const r = await request(app).get('/api/analytics/leaderboard-monthly?month=13')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(400);
  });
});
