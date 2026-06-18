import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('activity feed (BH) + branch radar (BP)', () => {
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

  // --- BH ----------------------------------------------------------------

  it('activity feed merges kunjungan + pembayaran into one timeline', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const now = new Date();
    await prisma.kunjungan.create({
      data: {
        nasabahId: n!.id, petugasId: s.petugasAId, branchId: s.branchAId,
        hasil: 'BAYAR', nominal: 100_000n, catatan: '', lokasi: '',
        jam: '10:00', tanggal: now,
      },
    });
    await prisma.pembayaran.create({
      data: {
        nasabahId: n!.id, branchId: s.branchAId,
        nominal: 250_000n, metode: 'tunai', status: 'berhasil',
        jam: '10:30', tanggal: now,
      },
    });

    const r = await request(app).get('/api/activity/feed?days=7')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBeGreaterThanOrEqual(2);
    const types = r.body.items.map((it: any) => it.type);
    expect(types).toContain('kunjungan.created');
    expect(types).toContain('pembayaran.received');
  });

  it('activity feed is sorted newest first', async () => {
    const r = await request(app).get('/api/activity/feed?days=7')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(200);
    const items = r.body.items as Array<{ timestamp: string }>;
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1].timestamp >= items[i].timestamp).toBe(true);
    }
  });

  it('SUPERVISOR activity scoped to their branch', async () => {
    const nA = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    const nB = await prisma.nasabah.findFirst({ where: { branchId: s.branchBId } });
    await prisma.kunjungan.create({
      data: {
        nasabahId: nA!.id, petugasId: s.petugasAId, branchId: s.branchAId,
        hasil: 'BAYAR', nominal: 0n, catatan: '', lokasi: '',
        jam: '10:00', tanggal: new Date(),
      },
    });
    await prisma.kunjungan.create({
      data: {
        nasabahId: nB!.id, petugasId: s.petugasBId, branchId: s.branchBId,
        hasil: 'BAYAR', nominal: 0n, catatan: '', lokasi: '',
        jam: '11:00', tanggal: new Date(),
      },
    });
    const r = await request(app).get('/api/activity/feed?days=7')
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.body.items.every((it: any) => it.branchKode === 'TST001')).toBe(true);
  });

  it('PETUGAS forbidden on activity feed', async () => {
    const r = await request(app).get('/api/activity/feed')
      .set('Authorization', `Bearer ${petTok}`);
    expect(r.status).toBe(403);
  });

  // --- BP ----------------------------------------------------------------

  it('branch radar returns 5 metrics per active branch (ADMIN)', async () => {
    const r = await request(app).get('/api/analytics/branch-radar')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(200);
    expect(r.body.branches.length).toBe(2);
    const b = r.body.branches[0];
    expect(typeof b.metrics.collectionRate).toBe('number');
    expect(typeof b.metrics.approvalRate).toBe('number');
    expect(typeof b.metrics.visitDensity).toBe('number');
    expect(typeof b.metrics.dpdHealth).toBe('number');
    expect(typeof b.metrics.petugasUtilization).toBe('number');
  });

  it('SUPERVISOR forbidden on branch radar', async () => {
    const r = await request(app).get('/api/analytics/branch-radar')
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.status).toBe(403);
  });

  it('radar collectionRate reflects pembayaran / target', async () => {
    // Set a tiny target on branch A so the rate is computable.
    await prisma.branch.update({
      where: { id: s.branchAId },
      data: { targetCollection: 200_000n, targetVisits: 10 },
    });
    const n = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    await prisma.pembayaran.create({
      data: {
        nasabahId: n!.id, branchId: s.branchAId,
        nominal: 100_000n, metode: 'tunai', status: 'berhasil',
        jam: '10:00', tanggal: new Date(),
      },
    });
    const r = await request(app).get('/api/analytics/branch-radar')
      .set('Authorization', `Bearer ${adminTok}`);
    const a = r.body.branches.find((b: any) => b.branchKode === 'TST001');
    expect(a.metrics.collectionRate).toBe(50); // 100k / 200k
  });
});
