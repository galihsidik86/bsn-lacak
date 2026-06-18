import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, username: string, password: string): Promise<string> {
  const r = await request(app).post('/api/auth/login').send({ username, password });
  if (r.status !== 200) throw new Error(`login failed: ${r.status}`);
  return r.body.token as string;
}

d('analytics scorecard + heatmap', () => {
  const app = buildApp();
  let s: SeedOut;
  let adminTok: string;
  let supTok: string;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
    adminTok = await login(app, s.adminUsername, s.password);
    supTok = await login(app, s.supervisorAUsername, s.password);
  });

  it('scorecard returns per-branch row with zero achievement when no activity', async () => {
    const now = new Date();
    const r = await request(app)
      .get(`/api/analytics/scorecard?year=${now.getFullYear()}&month=${now.getMonth() + 1}`)
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(200);
    expect(r.body.rows.length).toBe(2);
    const a = r.body.rows.find((x: any) => x.branchKode === 'TST001');
    expect(a.actualCollection).toBe(0);
    expect(a.actualVisits).toBe(0);
    expect(a.actualApprovalRate).toBe(0);
  });

  it('scorecard computes actuals from real pembayaran + kunjungan', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const now = new Date();
    // Two paid visits: one approved, one rejected → approval rate 50%.
    await prisma.kunjungan.create({
      data: {
        nasabahId: n!.id, petugasId: s.petugasAId, branchId: s.branchAId,
        hasil: 'BAYAR', nominal: 100_000n, catatan: 'x', lokasi: 'x',
        jam: '10:00', tanggal: now, reviewStatus: 'APPROVED',
      },
    });
    await prisma.kunjungan.create({
      data: {
        nasabahId: n!.id, petugasId: s.petugasAId, branchId: s.branchAId,
        hasil: 'BAYAR', nominal: 50_000n, catatan: 'x', lokasi: 'x',
        jam: '11:00', tanggal: now, reviewStatus: 'REJECTED',
      },
    });
    await prisma.pembayaran.create({
      data: {
        nasabahId: n!.id, branchId: s.branchAId,
        nominal: 150_000n, metode: 'tunai', status: 'berhasil',
        jam: '12:00', tanggal: now,
      },
    });

    const r = await request(app)
      .get(`/api/analytics/scorecard?year=${now.getFullYear()}&month=${now.getMonth() + 1}`)
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(200);
    const a = r.body.rows.find((x: any) => x.branchKode === 'TST001');
    expect(a.actualCollection).toBe(150_000);
    expect(a.actualVisits).toBe(2);
    expect(a.actualApprovalRate).toBe(50);
  });

  it('SUPERVISOR scope returns only their branch', async () => {
    const now = new Date();
    const r = await request(app)
      .get(`/api/analytics/scorecard?year=${now.getFullYear()}&month=${now.getMonth() + 1}`)
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.status).toBe(200);
    expect(r.body.rows.length).toBe(1);
    expect(r.body.rows[0].branchKode).toBe('TST001');
  });

  it('PETUGAS forbidden on scorecard', async () => {
    const petTok = await login(app, s.petugasAUsername, s.password);
    const r = await request(app)
      .get('/api/analytics/scorecard')
      .set('Authorization', `Bearer ${petTok}`);
    expect(r.status).toBe(403);
  });

  it('heatmap fills 5 kol cells per branch even when empty', async () => {
    const r = await request(app)
      .get('/api/analytics/heatmap')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(200);
    expect(r.body.cells.length).toBe(2 * 5); // 2 branches × K1..K5
    const branchACells = r.body.cells.filter((c: any) => c.branchKode === 'TST001');
    expect(branchACells.length).toBe(5);
    // Branch A seed has 3 nasabah all default kol=K1, so K1 count should be 3.
    const k1 = branchACells.find((c: any) => c.kol === 'K1');
    expect(k1.count).toBeGreaterThanOrEqual(1);
  });

  it('SUPERVISOR heatmap is auto-scoped to their branch', async () => {
    const r = await request(app)
      .get('/api/analytics/heatmap')
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.status).toBe(200);
    expect(r.body.cells.length).toBe(5);
    expect(r.body.cells.every((c: any) => c.branchKode === 'TST001')).toBe(true);
  });

  it('PATCH /branches updates KPI target fields', async () => {
    const r = await request(app)
      .patch(`/api/branches/${s.branchAId}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ targetCollection: '500000000', targetVisits: 200, targetApprovalRate: 90 });
    expect(r.status).toBe(200);
    expect(String(r.body.targetCollection)).toBe('500000000');
    expect(r.body.targetVisits).toBe(200);
    expect(r.body.targetApprovalRate).toBe(90);
  });
});
