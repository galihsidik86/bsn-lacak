import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('system health (CB) + commission (CD)', () => {
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

  // --- CB ---------------------------------------------------------------

  it('system-health returns DB + workers + queues shape (ADMIN)', async () => {
    const r = await request(app).get('/api/system-health')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(200);
    expect(r.body.db.ok).toBe(true);
    expect(typeof r.body.db.latencyMs).toBe('number');
    expect(typeof r.body.process.uptimeSeconds).toBe('number');
    expect(typeof r.body.queues.pendingReviews).toBe('number');
    expect(typeof r.body.workers).toBe('object');
  });

  it('SUPERVISOR forbidden on system-health', async () => {
    const r = await request(app).get('/api/system-health')
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.status).toBe(403);
  });

  it('PETUGAS forbidden on system-health', async () => {
    const r = await request(app).get('/api/system-health')
      .set('Authorization', `Bearer ${petTok}`);
    expect(r.status).toBe(403);
  });

  // --- CD ---------------------------------------------------------------

  it('commission applies commissionBps × tertagih', async () => {
    // Set petugas A's commission to 250 bps = 2.5%.
    await prisma.petugas.update({
      where: { id: s.petugasAId },
      data: { commissionBps: 250 },
    });
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const now = new Date();
    await prisma.pembayaran.create({
      data: {
        nasabahId: n!.id, branchId: s.branchAId,
        nominal: 1_000_000n, metode: 'tunai', status: 'berhasil',
        jam: '10:00', tanggal: now,
      },
    });
    // Failed payment must NOT be counted.
    await prisma.pembayaran.create({
      data: {
        nasabahId: n!.id, branchId: s.branchAId,
        nominal: 500_000n, metode: 'tunai', status: 'gagal',
        jam: '10:00', tanggal: now,
      },
    });

    const r = await request(app).get(`/api/analytics/commission?year=${now.getFullYear()}&month=${now.getMonth() + 1}`)
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(200);
    const a = r.body.rows.find((x: any) => x.kode === 'PT1');
    expect(a.collected).toBe(1_000_000);
    expect(a.commissionBps).toBe(250);
    // 1_000_000 × 2.5% = 25_000.
    expect(a.commission).toBe(25_000);
  });

  it('SUPERVISOR commission auto-scoped to branch', async () => {
    const r = await request(app).get('/api/analytics/commission')
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.body.rows.every((x: any) => x.branchKode === 'TST001')).toBe(true);
  });

  it('PETUGAS forbidden on commission', async () => {
    const r = await request(app).get('/api/analytics/commission')
      .set('Authorization', `Bearer ${petTok}`);
    expect(r.status).toBe(403);
  });

  it('bad month rejected', async () => {
    const r = await request(app).get('/api/analytics/commission?month=13')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(400);
  });
});
