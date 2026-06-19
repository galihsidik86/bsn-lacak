import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('petugas transfer history (CC) + KPI scorecard (CY)', () => {
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

  // --- CC ---------------------------------------------------------------

  it('ADMIN moves petugas across branches → transfer row logged', async () => {
    const r = await request(app)
      .patch(`/api/petugas/${s.petugasAId}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ branchId: s.branchBId, transferReason: 'pemerataan beban' });
    expect(r.status).toBe(200);

    const list = await request(app)
      .get(`/api/petugas/${s.petugasAId}/transfers`)
      .set('Authorization', `Bearer ${adminTok}`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(1);
    expect(list.body[0].fromBranch.kode).toBe('TST001');
    expect(list.body[0].toBranch.kode).toBe('TST002');
    expect(list.body[0].reason).toBe('pemerataan beban');
  });

  it('PATCH without branchId change does not insert transfer row', async () => {
    await request(app)
      .patch(`/api/petugas/${s.petugasAId}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ wilayah: 'Wilayah A baru' });

    const count = await prisma.petugasTransfer.count({ where: { petugasId: s.petugasAId } });
    expect(count).toBe(0);
  });

  it('PETUGAS can view own transfers, not others', async () => {
    await prisma.petugasTransfer.create({
      data: { petugasId: s.petugasAId, fromBranchId: s.branchBId, toBranchId: s.branchAId, movedById: s.adminId },
    });
    const own = await request(app)
      .get(`/api/petugas/${s.petugasAId}/transfers`)
      .set('Authorization', `Bearer ${petTok}`);
    expect(own.status).toBe(200);
    expect(own.body.length).toBe(1);

    const other = await request(app)
      .get(`/api/petugas/${s.otherPetugasAId}/transfers`)
      .set('Authorization', `Bearer ${petTok}`);
    expect(other.status).toBe(403);
  });

  // --- CY ---------------------------------------------------------------

  it('SUPERVISOR fetches petugas scorecard; returns 5 axes', async () => {
    const r = await request(app)
      .get(`/api/analytics/petugas-scorecard/${s.petugasAId}`)
      .set('Authorization', `Bearer ${supATok}`);
    expect(r.status).toBe(200);
    expect(r.body.metrics).toHaveProperty('collectionRate');
    expect(r.body.metrics).toHaveProperty('visitConsistency');
    expect(r.body.metrics).toHaveProperty('approvalRate');
    expect(r.body.metrics).toHaveProperty('nasabahHealth');
    expect(r.body.metrics).toHaveProperty('followupSpeed');
    expect(r.body.raw).toBeDefined();
  });

  it('PETUGAS forbidden from scorecard endpoint', async () => {
    const r = await request(app)
      .get(`/api/analytics/petugas-scorecard/${s.petugasAId}`)
      .set('Authorization', `Bearer ${petTok}`);
    expect(r.status).toBe(403);
  });

  it('unknown petugas → 404', async () => {
    const r = await request(app)
      .get('/api/analytics/petugas-scorecard/nonexistent-id')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(404);
  });
});
