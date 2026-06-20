import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';
import { runIdleDetectorSweep } from '../../src/workers/idleDetectorWorker.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('vehicle + KM (DR) + idle detector (DS)', () => {
  const app = buildApp();
  let s: SeedOut;
  let adminTok: string;
  let supATok: string;
  let petTok: string;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
    adminTok = await login(app, s.adminUsername, s.password);
    supATok = await login(app, s.supervisorAUsername, s.password);
    petTok = await login(app, s.petugasAUsername, s.password);
  });

  // --- DR ---------------------------------------------------------------

  it('clock-in with km sets kmStart; clock-out with km sets kmEnd', async () => {
    const ci = await request(app).post('/api/attendance/clock-in')
      .set('Authorization', `Bearer ${petTok}`)
      .send({ km: 1000 });
    expect(ci.status).toBe(201);
    expect(ci.body.kmStart).toBe(1000);

    const co = await request(app).post('/api/attendance/clock-out')
      .set('Authorization', `Bearer ${petTok}`)
      .send({ km: 1042 });
    expect(co.status).toBe(200);
    expect(co.body.kmStart).toBe(1000);
    expect(co.body.kmEnd).toBe(1042);
  });

  it('clock-out with km below kmStart rejected', async () => {
    await request(app).post('/api/attendance/clock-in')
      .set('Authorization', `Bearer ${petTok}`)
      .send({ km: 1000 });
    const r = await request(app).post('/api/attendance/clock-out')
      .set('Authorization', `Bearer ${petTok}`)
      .send({ km: 900 });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('km_end_below_start');
  });

  it('KM analytics aggregates per petugas', async () => {
    const now = new Date();
    await prisma.attendance.createMany({
      data: [
        { petugasId: s.petugasAId, branchId: s.branchAId,
          clockInAt: new Date(now.getFullYear(), now.getMonth(), 1, 8),
          clockOutAt: new Date(now.getFullYear(), now.getMonth(), 1, 17),
          kmStart: 10_000, kmEnd: 10_050 },
        { petugasId: s.petugasAId, branchId: s.branchAId,
          clockInAt: new Date(now.getFullYear(), now.getMonth(), 2, 8),
          clockOutAt: new Date(now.getFullYear(), now.getMonth(), 2, 17),
          kmStart: 10_050, kmEnd: 10_080 },
        // No kmEnd → excluded.
        { petugasId: s.otherPetugasAId, branchId: s.branchAId,
          clockInAt: new Date(now.getFullYear(), now.getMonth(), 3, 8),
          kmStart: 5000 },
      ],
    });
    const r = await request(app).get(`/api/analytics/km-report?year=${now.getFullYear()}&month=${now.getMonth() + 1}`)
      .set('Authorization', `Bearer ${supATok}`);
    expect(r.status).toBe(200);
    expect(r.body.rows.length).toBe(1);
    expect(r.body.rows[0].petugasId).toBe(s.petugasAId);
    expect(r.body.rows[0].sessions).toBe(2);
    expect(r.body.rows[0].totalKm).toBe(80);
  });

  it('PETUGAS forbidden from KM report', async () => {
    const r = await request(app).get('/api/analytics/km-report')
      .set('Authorization', `Bearer ${petTok}`);
    expect(r.status).toBe(403);
  });

  it('ADMIN can set kendaraanPlat via petugas patch', async () => {
    const r = await request(app).patch(`/api/petugas/${s.petugasAId}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ kendaraanPlat: 'B 1234 XYZ', kendaraanModel: 'Honda Beat' });
    expect(r.status).toBe(200);
    expect(r.body.kendaraanPlat).toBe('B 1234 XYZ');
    expect(r.body.kendaraanModel).toBe('Honda Beat');
  });

  // --- DS ---------------------------------------------------------------

  it('idle sweep flags petugas with no recent kunjungan and notifies supervisor', async () => {
    // Both petugasA and otherPetugasA have no recent kunjungan; supervisorA gets alerted.
    const out = await runIdleDetectorSweep({ force: true });
    expect(out.ok).toBe(true);
    expect((out.alerted ?? 0)).toBeGreaterThan(0);

    const sup = await prisma.user.findUnique({ where: { id: s.supervisorAId }, select: { id: true } });
    const notifs = await prisma.notification.findMany({
      where: { userId: sup!.id, type: 'petugas.idle' },
    });
    expect(notifs.length).toBeGreaterThan(0);
  });

  it('idle sweep dedups same petugas within same day', async () => {
    const first = await runIdleDetectorSweep({ force: true });
    expect((first.alerted ?? 0)).toBeGreaterThan(0);
    const second = await runIdleDetectorSweep({ force: true });
    expect(second.alerted ?? 0).toBe(0);
  });

  it('petugas with recent kunjungan AND mostly BAYAR is NOT flagged', async () => {
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    const today = new Date();
    today.setHours(8, 0, 0, 0);
    // 6 BAYAR kunjungan in last 5 days — well above sample threshold,
    // 0% TIDAKADA. Plus recent activity, so neither trigger fires.
    for (let i = 0; i < 6; i++) {
      await prisma.kunjungan.create({
        data: {
          nasabahId: target!.id, petugasId: s.petugasAId, branchId: s.branchAId,
          tanggal: new Date(today.getTime() - i * 86400_000 / 2),
          jam: '10:00', hasil: 'BAYAR',
          catatan: 'd', lokasi: 'x', valid: true, nominal: 1000n,
        },
      });
    }
    // Soft-delete the other petugas to take it out of consideration.
    await prisma.petugas.update({ where: { id: s.otherPetugasAId }, data: { active: false } });
    await prisma.petugas.update({ where: { id: s.petugasBId }, data: { active: false } });

    const out = await runIdleDetectorSweep({ force: true });
    expect(out.alerted ?? 0).toBe(0);
  });

  it('high TIDAKADA ratio triggers idle alert', async () => {
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    const today = new Date();
    today.setHours(8, 0, 0, 0);
    // Put TODAY's kunjungan so the "no_visits in IDLE_KANTOR_DAYS" trigger
    // doesn't pre-empt; we want to test the ratio trigger specifically.
    // 5 visits in the last 3 days, 4 of them TIDAKADA = 80% → > 50% default.
    for (let i = 0; i < 5; i++) {
      await prisma.kunjungan.create({
        data: {
          nasabahId: target!.id, petugasId: s.petugasAId, branchId: s.branchAId,
          tanggal: new Date(today.getTime() - i * 6 * 3600_000),
          jam: '10:00',
          hasil: i === 0 ? 'BAYAR' : 'TIDAKADA',
          catatan: 'd', lokasi: 'x', valid: true,
          nominal: i === 0 ? 1000n : 0n,
        },
      });
    }
    await prisma.petugas.update({ where: { id: s.otherPetugasAId }, data: { active: false } });
    await prisma.petugas.update({ where: { id: s.petugasBId }, data: { active: false } });

    const out = await runIdleDetectorSweep({ force: true });
    expect(out.alerted ?? 0).toBe(1);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'idle.alert_sent', target: s.petugasAId },
    });
    expect(audit?.meta).toMatchObject({ reason: 'tidakada_high' });
  });
});
