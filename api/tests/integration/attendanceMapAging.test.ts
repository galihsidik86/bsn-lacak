import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('attendance map + aging report', () => {
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

  it('attendance map: PETUGAS forbidden', async () => {
    const r = await request(app).get('/api/attendance/map')
      .set('Authorization', `Bearer ${petTok}`);
    expect(r.status).toBe(403);
  });

  it('attendance map: returns today only by default, with GPS coords', async () => {
    await prisma.attendance.create({
      data: {
        petugasId: s.petugasAId, branchId: s.branchAId,
        clockInAt: new Date(), clockInLat: -6.4825, clockInLng: 106.8595,
      },
    });
    // Older row outside the 1-day window — should NOT appear.
    await prisma.attendance.create({
      data: {
        petugasId: s.petugasAId, branchId: s.branchAId,
        clockInAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        clockInLat: -6.5, clockInLng: 106.7,
      },
    });
    const r = await request(app).get('/api/attendance/map')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(200);
    expect(r.body.windowDays).toBe(1);
    expect(r.body.points.length).toBe(1);
    expect(r.body.points[0].clockInLat).toBe(-6.4825);
    expect(r.body.points[0].petugasKode).toBe('PT1');
  });

  it('attendance map: ?days=7 includes older row', async () => {
    await prisma.attendance.create({
      data: {
        petugasId: s.petugasAId, branchId: s.branchAId,
        clockInAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        clockInLat: -6.5, clockInLng: 106.7,
      },
    });
    const r = await request(app).get('/api/attendance/map?days=7')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(200);
    expect(r.body.points.length).toBe(1);
  });

  it('attendance map: skips rows without GPS', async () => {
    await prisma.attendance.create({
      data: {
        petugasId: s.petugasAId, branchId: s.branchAId,
        clockInAt: new Date(), clockInLat: null, clockInLng: null,
      },
    });
    const r = await request(app).get('/api/attendance/map')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.body.points.length).toBe(0);
  });

  it('attendance map: SUPERVISOR scoped to their branch', async () => {
    await prisma.attendance.create({
      data: {
        petugasId: s.petugasAId, branchId: s.branchAId,
        clockInAt: new Date(), clockInLat: -6.48, clockInLng: 106.85,
      },
    });
    await prisma.attendance.create({
      data: {
        petugasId: s.petugasBId, branchId: s.branchBId,
        clockInAt: new Date(), clockInLat: -6.50, clockInLng: 106.80,
      },
    });
    const r = await request(app).get('/api/attendance/map')
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.body.points.length).toBe(1);
    expect(r.body.points[0].branchKode).toBe('TST001');
  });

  // --- aging report --------------------------------------------------

  async function makePendingKunjungan(branchId: string, petugasId: string, daysOld: number) {
    const n = await prisma.nasabah.findFirst({ where: { branchId } });
    return prisma.kunjungan.create({
      data: {
        nasabahId: n!.id, petugasId, branchId,
        hasil: 'BAYAR', nominal: 0n, catatan: 'x', lokasi: 'x',
        jam: '10:00', tanggal: new Date(),
        createdAt: new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000),
        reviewStatus: 'PENDING',
      },
    });
  }

  it('aging: buckets PENDING rows by age', async () => {
    await makePendingKunjungan(s.branchAId, s.petugasAId, 0.5); // 0_1d
    await makePendingKunjungan(s.branchAId, s.petugasAId, 2);   // 1_3d
    await makePendingKunjungan(s.branchAId, s.petugasAId, 5);   // 3_7d
    await makePendingKunjungan(s.branchAId, s.petugasAId, 10);  // 7d_plus

    const r = await request(app).get('/api/analytics/aging')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(200);
    expect(r.body.buckets['0_1d']).toBe(1);
    expect(r.body.buckets['1_3d']).toBe(1);
    expect(r.body.buckets['3_7d']).toBe(1);
    expect(r.body.buckets['7d_plus']).toBe(1);
  });

  it('aging: excludes already-reviewed rows', async () => {
    const n = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    await prisma.kunjungan.create({
      data: {
        nasabahId: n!.id, petugasId: s.petugasAId, branchId: s.branchAId,
        hasil: 'BAYAR', nominal: 0n, catatan: 'x', lokasi: 'x',
        jam: '10:00', tanggal: new Date(),
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        reviewStatus: 'APPROVED',
      },
    });
    const r = await request(app).get('/api/analytics/aging')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.body.buckets['3_7d']).toBe(0);
  });

  it('aging: per-branch + per-petugas breakdown', async () => {
    await makePendingKunjungan(s.branchAId, s.petugasAId, 0.5);
    await makePendingKunjungan(s.branchAId, s.petugasAId, 5);
    await makePendingKunjungan(s.branchBId, s.petugasBId, 2);

    const r = await request(app).get('/api/analytics/aging')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.body.branches.length).toBe(2);
    expect(r.body.petugas.length).toBe(2);
    // Petugas A should sort first (oldest pending is 5 days old).
    expect(r.body.petugas[0].petugasKode).toBe('PT1');
    expect(r.body.petugas[0].days).toBeGreaterThanOrEqual(4.9);
  });

  it('aging: SUPERVISOR scoped to their branch', async () => {
    await makePendingKunjungan(s.branchAId, s.petugasAId, 1);
    await makePendingKunjungan(s.branchBId, s.petugasBId, 2);
    const r = await request(app).get('/api/analytics/aging')
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.body.branches.length).toBe(1);
    expect(r.body.branches[0].branchKode).toBe('TST001');
  });

  it('aging: PETUGAS forbidden', async () => {
    const r = await request(app).get('/api/analytics/aging')
      .set('Authorization', `Bearer ${petTok}`);
    expect(r.status).toBe(403);
  });
});
