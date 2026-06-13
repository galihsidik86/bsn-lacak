import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function loginAs(app: any, username: string, password: string) {
  const r = await request(app).post('/api/auth/login').send({ username, password });
  return r.body.token as string;
}

d('multi-branch tenant isolation', () => {
  const app = buildApp();
  let s: SeedOut;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
  });

  it("supervisor of branch A sees only branch A's nasabah", async () => {
    const tok = await loginAs(app, s.supervisorAUsername, s.password);
    const r = await request(app).get('/api/nasabah').set('Authorization', `Bearer ${tok}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(3);
    for (const n of r.body) expect(n.branchId).toBe(s.branchAId);
  });

  it("supervisor of branch B sees only branch B's nasabah", async () => {
    const tok = await loginAs(app, s.supervisorBUsername, s.password);
    const r = await request(app).get('/api/nasabah').set('Authorization', `Bearer ${tok}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
    expect(r.body[0].branchId).toBe(s.branchBId);
  });

  it('ADMIN without override sees all branches', async () => {
    const tok = await loginAs(app, s.adminUsername, s.password);
    const r = await request(app).get('/api/nasabah').set('Authorization', `Bearer ${tok}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(4);
  });

  it('ADMIN with x-branch-id header scopes to that branch', async () => {
    const tok = await loginAs(app, s.adminUsername, s.password);
    const r = await request(app)
      .get('/api/nasabah')
      .set('Authorization', `Bearer ${tok}`)
      .set('x-branch-id', s.branchBId);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
    expect(r.body[0].branchId).toBe(s.branchBId);
  });

  it('supervisor of A cannot reassign their nasabah to a petugas in branch B', async () => {
    const tok = await loginAs(app, s.supervisorAUsername, s.password);
    const n = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    const r = await request(app)
      .patch(`/api/nasabah/${n!.id}/petugas`)
      .set('Authorization', `Bearer ${tok}`)
      .send({ petugasId: s.petugasBId });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('cross_branch_forbidden');
  });

  it('supervisor of A can reassign within branch A', async () => {
    const tok = await loginAs(app, s.supervisorAUsername, s.password);
    const n = await prisma.nasabah.findFirst({ where: { petugasId: s.petugasAId } });
    const r = await request(app)
      .patch(`/api/nasabah/${n!.id}/petugas`)
      .set('Authorization', `Bearer ${tok}`)
      .send({ petugasId: s.otherPetugasAId });
    expect(r.status).toBe(200);
  });

  it('ADMIN can reassign across branches', async () => {
    const tok = await loginAs(app, s.adminUsername, s.password);
    const n = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    const r = await request(app)
      .patch(`/api/nasabah/${n!.id}/petugas`)
      .set('Authorization', `Bearer ${tok}`)
      .send({ petugasId: s.petugasBId });
    expect(r.status).toBe(200);
  });

  it('supervisor of A cannot blast to nasabah outside their branch', async () => {
    const tok = await loginAs(app, s.supervisorAUsername, s.password);
    const branchBNasabah = await prisma.nasabah.findFirst({ where: { branchId: s.branchBId } });
    const r = await request(app).post('/api/blast')
      .set('Authorization', `Bearer ${tok}`)
      .send({ judul: 'attack', kanal: 'WA', template: 'hi {nama}', recipientIds: [branchBNasabah!.id] });
    // Either no_recipients (filtered out) or cross_branch — both are valid refusals.
    expect([400, 403]).toContain(r.status);
    expect(['no_recipients', 'cross_branch_forbidden']).toContain(r.body.error);
  });

  it('petugas list scopes to branch', async () => {
    const aTok = await loginAs(app, s.supervisorAUsername, s.password);
    const aRes = await request(app).get('/api/petugas').set('Authorization', `Bearer ${aTok}`);
    expect(aRes.body).toHaveLength(2);
    for (const p of aRes.body) expect(p.branchId).toBe(s.branchAId);

    const bTok = await loginAs(app, s.supervisorBUsername, s.password);
    const bRes = await request(app).get('/api/petugas').set('Authorization', `Bearer ${bTok}`);
    expect(bRes.body).toHaveLength(1);
    expect(bRes.body[0].branchId).toBe(s.branchBId);
  });
});
