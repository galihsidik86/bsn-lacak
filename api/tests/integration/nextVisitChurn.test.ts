import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';
import { nextVisitDate } from '../../src/lib/visitCadence.js';
import { churnScore, riskTier } from '../../src/lib/churnScore.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

describe('visitCadence lib', () => {
  it('K1 + BAYAR pushes 30 days out', () => {
    const from = new Date('2026-06-01T00:00:00Z');
    const next = nextVisitDate(from, 'K1', 'BAYAR');
    expect(Math.round((next.getTime() - from.getTime()) / 86400000)).toBe(30);
  });

  it('K5 + TIDAKADA pulls forward to 1 day', () => {
    const from = new Date('2026-06-01T00:00:00Z');
    const next = nextVisitDate(from, 'K5', 'TIDAKADA');
    expect(Math.round((next.getTime() - from.getTime()) / 86400000)).toBe(1);
  });
});

describe('churnScore lib', () => {
  it('clean nasabah scores 0', () => {
    expect(churnScore({
      active: true, dpd: 0, daysSinceLastPayment: 0,
      failedVisits30d: 0, visitsLast30d: 5,
    })).toBe(0);
  });

  it('inactive + high DPD + no visit hits critical tier', () => {
    const s = churnScore({
      active: false, dpd: 120, daysSinceLastPayment: 180,
      failedVisits30d: 5, visitsLast30d: 0,
    });
    expect(s).toBeGreaterThanOrEqual(75);
    expect(riskTier(s)).toBe('critical');
  });
});

d('next-visit + churn API', () => {
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

  it('kunjungan create auto-sets nextVisitAt on the nasabah', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const r = await request(app).post('/api/kunjungan')
      .set('Authorization', `Bearer ${petTok}`)
      .field('nasabahId', n!.id).field('petugasId', s.petugasAId)
      .field('hasil', 'BAYAR').field('nominal', '50000')
      .field('catatan', '').field('lokasi', '')
      .field('lat', '-6.4825').field('lng', '106.8595');
    expect(r.status).toBe(201);
    // The auto-cadence fires inside a fire-and-forget async block; allow a
    // tick before reading.
    await new Promise(r => setTimeout(r, 80));
    const after = await prisma.nasabah.findUnique({ where: { id: n!.id } });
    expect(after?.nextVisitAt).not.toBeNull();
    // K1 + BAYAR = +30 days from today.
    const ageDays = (after!.nextVisitAt!.getTime() - Date.now()) / 86400000;
    expect(ageDays).toBeGreaterThan(28);
    expect(ageDays).toBeLessThan(32);
  });

  it('PATCH /:id/next-visit accepts manual date', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const target = new Date(Date.now() + 5 * 86400000);
    const r = await request(app).patch(`/api/nasabah/${n!.id}/next-visit`)
      .set('Authorization', `Bearer ${supTok}`)
      .send({ nextVisitAt: target.toISOString() });
    expect(r.status).toBe(200);
    expect(new Date(r.body.nextVisitAt).getTime()).toBe(target.getTime());
  });

  it('PATCH /:id/next-visit clears with null', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    await prisma.nasabah.update({ where: { id: n!.id }, data: { nextVisitAt: new Date() } });
    const r = await request(app).patch(`/api/nasabah/${n!.id}/next-visit`)
      .set('Authorization', `Bearer ${supTok}`)
      .send({ nextVisitAt: null });
    expect(r.status).toBe(200);
    expect(r.body.nextVisitAt).toBeNull();
  });

  it('GET /nasabah/due-soon filters within window', async () => {
    const ids = await prisma.nasabah.findMany({
      where: { branchId: s.branchAId },
      select: { id: true },
    });
    await prisma.nasabah.update({
      where: { id: ids[0].id },
      data: { nextVisitAt: new Date(Date.now() + 2 * 86400000) }, // within 7d
    });
    await prisma.nasabah.update({
      where: { id: ids[1].id },
      data: { nextVisitAt: new Date(Date.now() + 30 * 86400000) }, // outside 7d
    });
    const r = await request(app).get('/api/nasabah/due-soon?days=7')
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.status).toBe(200);
    expect(r.body.windowDays).toBe(7);
    expect(r.body.rows.length).toBe(1);
  });

  it('SUPERVISOR cross-branch next-visit → 404', async () => {
    const branchB = await prisma.nasabah.findFirst({ where: { kode: 'N0004' } });
    const r = await request(app).patch(`/api/nasabah/${branchB!.id}/next-visit`)
      .set('Authorization', `Bearer ${supTok}`)
      .send({ nextVisitAt: new Date().toISOString() });
    expect(r.status).toBe(404);
  });

  it('GET /analytics/churn returns sorted rows with tiers', async () => {
    const r = await request(app).get('/api/analytics/churn?limit=50')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.rows)).toBe(true);
    expect(r.body.rows.length).toBeGreaterThan(0);
    for (let i = 1; i < r.body.rows.length; i++) {
      expect(r.body.rows[i - 1].score).toBeGreaterThanOrEqual(r.body.rows[i].score);
    }
  });

  it('PETUGAS forbidden on /analytics/churn', async () => {
    const r = await request(app).get('/api/analytics/churn')
      .set('Authorization', `Bearer ${petTok}`);
    expect(r.status).toBe(403);
  });

  it('SUPERVISOR churn is scoped to their branch', async () => {
    const r = await request(app).get('/api/analytics/churn?limit=100')
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.body.rows.every((x: any) => x.branchKode === 'TST001')).toBe(true);
  });
});
