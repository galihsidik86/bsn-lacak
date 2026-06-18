import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';
import { runFollowupSweep } from '../../src/workers/followupWorker.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('auto-followup worker (CG) + period delta (CI)', () => {
  const app = buildApp();
  let s: SeedOut;
  let adminTok: string;
  let petTok: string;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
    adminTok = await login(app, s.adminUsername, s.password);
    petTok = await login(app, s.petugasAUsername, s.password);
  });

  // --- CG ---------------------------------------------------------------

  it('fires once for JANJI > 24h old; deduplicates on second sweep', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    // 25h-old JANJI — within the sweep window.
    await prisma.kunjungan.create({
      data: {
        nasabahId: n!.id, petugasId: s.petugasAId, branchId: s.branchAId,
        hasil: 'JANJI', nominal: 0n, catatan: 'janji bayar', lokasi: '',
        jam: '10:00',
        tanggal: new Date(Date.now() - 25 * 60 * 60_000),
        createdAt: new Date(Date.now() - 25 * 60 * 60_000),
        reviewStatus: 'APPROVED',
      },
    });
    const first = await runFollowupSweep();
    expect(first.sent).toBe(1);

    const notif = await prisma.notification.findFirst({
      where: { userId: s.petugasUserAId, type: 'kunjungan.followup' },
    });
    expect(notif).not.toBeNull();

    const second = await runFollowupSweep();
    expect(second.sent).toBe(0);
  });

  it('does not fire on JANJI < 24h old', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    await prisma.kunjungan.create({
      data: {
        nasabahId: n!.id, petugasId: s.petugasAId, branchId: s.branchAId,
        hasil: 'JANJI', nominal: 0n, catatan: 'fresh', lokasi: '',
        jam: '10:00',
        tanggal: new Date(Date.now() - 5 * 60 * 60_000),
        reviewStatus: 'APPROVED',
      },
    });
    const r = await runFollowupSweep();
    expect(r.sent).toBe(0);
  });

  it('does not fire on non-JANJI hasil', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    await prisma.kunjungan.create({
      data: {
        nasabahId: n!.id, petugasId: s.petugasAId, branchId: s.branchAId,
        hasil: 'BAYAR', nominal: 100_000n, catatan: '', lokasi: '',
        jam: '10:00',
        tanggal: new Date(Date.now() - 25 * 60 * 60_000),
        reviewStatus: 'APPROVED',
      },
    });
    const r = await runFollowupSweep();
    expect(r.sent).toBe(0);
  });

  // --- CI ---------------------------------------------------------------

  it('period-delta returns shape + math', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const now = new Date();
    // Two pembayaran this month, one last month.
    await prisma.pembayaran.create({
      data: {
        nasabahId: n!.id, branchId: s.branchAId,
        nominal: 200_000n, metode: 'tunai', status: 'berhasil',
        jam: '10:00', tanggal: now,
      },
    });
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);
    await prisma.pembayaran.create({
      data: {
        nasabahId: n!.id, branchId: s.branchAId,
        nominal: 100_000n, metode: 'tunai', status: 'berhasil',
        jam: '10:00', tanggal: lastMonth,
      },
    });

    const r = await request(app).get('/api/analytics/period-delta')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(200);
    expect(r.body.thisMonth.collected).toBe(200_000);
    expect(r.body.lastMonth.collected).toBe(100_000);
    // 100% growth.
    expect(r.body.delta.collectedPct).toBe(100);
  });

  it('PETUGAS forbidden on period-delta', async () => {
    const r = await request(app).get('/api/analytics/period-delta')
      .set('Authorization', `Bearer ${petTok}`);
    expect(r.status).toBe(403);
  });

  it('zero previous → 100% delta when current > 0', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    await prisma.pembayaran.create({
      data: {
        nasabahId: n!.id, branchId: s.branchAId,
        nominal: 50_000n, metode: 'tunai', status: 'berhasil',
        jam: '10:00', tanggal: new Date(),
      },
    });
    const r = await request(app).get('/api/analytics/period-delta')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.body.delta.collectedPct).toBe(100);
  });
});
