import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('petugas race chart', () => {
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

  it('returns month axis matching window', async () => {
    const r = await request(app).get('/api/analytics/petugas-race?months=3')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(200);
    expect(r.body.months.length).toBe(3);
    // Months should be in chronological order, last entry = current month.
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    expect(r.body.months[2]).toBe(expected);
  });

  it('aggregates collected per (petugas × month) from successful pembayaran', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const now = new Date();
    await prisma.pembayaran.create({
      data: {
        nasabahId: n!.id, branchId: s.branchAId,
        nominal: 150_000n, metode: 'tunai', status: 'berhasil',
        jam: '10:00', tanggal: now,
      },
    });
    await prisma.pembayaran.create({
      data: {
        nasabahId: n!.id, branchId: s.branchAId,
        nominal: 50_000n, metode: 'transfer', status: 'gagal',
        jam: '10:30', tanggal: now,
      },
    });

    const r = await request(app).get('/api/analytics/petugas-race?months=6')
      .set('Authorization', `Bearer ${adminTok}`);
    const p1 = r.body.petugas.find((p: any) => p.kode === 'PT1');
    expect(p1).toBeTruthy();
    expect(p1.total).toBe(150_000);
    // Failed payment must NOT be counted.
    expect(p1.total).not.toBe(200_000);
  });

  it('SUPERVISOR is auto-scoped to their branch', async () => {
    const r = await request(app).get('/api/analytics/petugas-race?months=6')
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.body.petugas.every((p: any) => p.branchKode === 'TST001')).toBe(true);
  });

  it('PETUGAS forbidden', async () => {
    const r = await request(app).get('/api/analytics/petugas-race')
      .set('Authorization', `Bearer ${petTok}`);
    expect(r.status).toBe(403);
  });
});
