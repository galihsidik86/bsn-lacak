import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('presence (CU) + branch budget (CV)', () => {
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

  // --- CU ---------------------------------------------------------------

  it('heartbeat stamps lastSeenAt; presence list shows the user', async () => {
    const r = await request(app).post('/api/users/heartbeat')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(200);

    const list = await request(app).get('/api/users/presence')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(list.status).toBe(200);
    expect(list.body.rows.some((u: any) => u.username === 'admin1')).toBe(true);
  });

  it('SUPERVISOR sees only their branch + ADMIN', async () => {
    // Heartbeat from supervisor B (other branch) + supervisor A (own branch)
    // + admin (HQ).
    const supBTok = await login(app, s.supervisorBUsername, s.password);
    await request(app).post('/api/users/heartbeat').set('Authorization', `Bearer ${adminTok}`);
    await request(app).post('/api/users/heartbeat').set('Authorization', `Bearer ${supBTok}`);
    await request(app).post('/api/users/heartbeat').set('Authorization', `Bearer ${supTok}`);

    const list = await request(app).get('/api/users/presence')
      .set('Authorization', `Bearer ${supTok}`);
    const usernames = list.body.rows.map((u: any) => u.username);
    expect(usernames).toContain('supA');
    expect(usernames).toContain('admin1');
    expect(usernames).not.toContain('supB');
  });

  it('PETUGAS forbidden on presence list', async () => {
    const r = await request(app).get('/api/users/presence')
      .set('Authorization', `Bearer ${petTok}`);
    expect(r.status).toBe(403);
  });

  it('old lastSeenAt drops out of the window', async () => {
    // Stamp adminTok then push their lastSeenAt 20 minutes ago.
    await request(app).post('/api/users/heartbeat').set('Authorization', `Bearer ${adminTok}`);
    await prisma.user.update({
      where: { username: 'admin1' },
      data: { lastSeenAt: new Date(Date.now() - 20 * 60_000) },
    });
    const list = await request(app).get('/api/users/presence?windowMin=5')
      .set('Authorization', `Bearer ${supTok}`);
    const usernames = list.body.rows.map((u: any) => u.username);
    expect(usernames).not.toContain('admin1');
  });

  // --- CV ---------------------------------------------------------------

  it('budget multiplies pembayaran × commissionBps', async () => {
    await prisma.branch.update({
      where: { id: s.branchAId },
      data: { budgetCommission: 1_000_000n, budgetOperational: 5_000_000n },
    });
    await prisma.petugas.update({
      where: { id: s.petugasAId },
      data: { commissionBps: 200 }, // 2%
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

    const r = await request(app)
      .get(`/api/analytics/branch-budget?year=${now.getFullYear()}&month=${now.getMonth() + 1}`)
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(200);
    const a = r.body.rows.find((b: any) => b.branchKode === 'TST001');
    expect(a.budgetOperational).toBe(5_000_000);
    expect(a.budgetCommission).toBe(1_000_000);
    // 1_000_000 × 2% = 20_000.
    expect(a.commissionUsed).toBe(20_000);
    // 20_000 / 1_000_000 = 2%.
    expect(a.commissionPct).toBe(2);
  });

  it('PETUGAS forbidden on budget', async () => {
    const r = await request(app).get('/api/analytics/branch-budget')
      .set('Authorization', `Bearer ${petTok}`);
    expect(r.status).toBe(403);
  });

  it('PATCH /branches accepts budget fields', async () => {
    const r = await request(app).patch(`/api/branches/${s.branchAId}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ budgetOperational: '7000000', budgetCommission: '2000000' });
    expect(r.status).toBe(200);
    expect(String(r.body.budgetOperational)).toBe('7000000');
    expect(String(r.body.budgetCommission)).toBe('2000000');
  });
});
