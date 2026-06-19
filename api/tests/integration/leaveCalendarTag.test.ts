import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('leave calendar (CW) + nasabah tag (CX)', () => {
  const app = buildApp();
  let s: SeedOut;
  let adminTok: string;
  let supATok: string;
  let supBTok: string;
  let petTok: string;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
    adminTok = await login(app, s.adminUsername, s.password);
    supATok = await login(app, s.supervisorAUsername, s.password);
    supBTok = await login(app, s.supervisorBUsername, s.password);
    petTok = await login(app, s.petugasAUsername, s.password);
  });

  // --- CW ---------------------------------------------------------------

  it('ADMIN sees approved leaves across both branches; SUPERVISOR scoped', async () => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const inThree = new Date(today.getTime() + 3 * 86400_000);
    await prisma.petugasLeave.createMany({
      data: [
        { petugasId: s.petugasAId, startDate: today, endDate: inThree, type: 'sakit', status: 'approved' },
        { petugasId: s.petugasBId, startDate: today, endDate: inThree, type: 'sakit', status: 'approved' },
      ],
    });
    const r = await request(app).get('/api/leaves/calendar?days=14')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(200);
    expect(r.body.rows.length).toBe(2);

    const supA = await request(app).get('/api/leaves/calendar?days=14')
      .set('Authorization', `Bearer ${supATok}`);
    expect(supA.body.rows.length).toBe(1);
    expect(supA.body.rows[0].petugas.id).toBe(s.petugasAId);
  });

  it('pending leave hidden by default, surfaced with includePending=1', async () => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    await prisma.petugasLeave.create({
      data: { petugasId: s.petugasAId, startDate: today,
        endDate: new Date(today.getTime() + 86400_000), type: 'sakit', status: 'pending' },
    });
    const def = await request(app).get('/api/leaves/calendar?days=7')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(def.body.rows.length).toBe(0);
    const incl = await request(app).get('/api/leaves/calendar?days=7&includePending=1')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(incl.body.rows.length).toBe(1);
    expect(incl.body.rows[0].status).toBe('pending');
  });

  it('substitute coverage flag reflects assignment', async () => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    await prisma.petugasLeave.create({
      data: {
        petugasId: s.petugasAId,
        substitutePetugasId: s.otherPetugasAId,
        startDate: today,
        endDate: new Date(today.getTime() + 86400_000),
        type: 'sakit', status: 'approved',
      },
    });
    const r = await request(app).get('/api/leaves/calendar?days=7')
      .set('Authorization', `Bearer ${supATok}`);
    expect(r.body.rows[0].covered).toBe(true);
    expect(r.body.rows[0].substitute?.id).toBe(s.otherPetugasAId);
  });

  it('PETUGAS forbidden from calendar', async () => {
    const r = await request(app).get('/api/leaves/calendar')
      .set('Authorization', `Bearer ${petTok}`);
    expect(r.status).toBe(403);
  });

  // --- CX ---------------------------------------------------------------

  it('SUPERVISOR creates tag scoped to own branch; cross-branch supervisor cannot see it', async () => {
    const create = await request(app).post('/api/tags')
      .set('Authorization', `Bearer ${supATok}`)
      .send({ name: 'VIP', color: '#0ea5e9' });
    expect(create.status).toBe(201);
    expect(create.body.branchId).toBe(s.branchAId);

    const supBList = await request(app).get('/api/tags')
      .set('Authorization', `Bearer ${supBTok}`);
    // Sup B is scoped to branch B — should not see branch A's tag.
    expect(supBList.body.find((t: any) => t.id === create.body.id)).toBeUndefined();
  });

  it('ADMIN can create global tag visible to everyone', async () => {
    const create = await request(app).post('/api/tags')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: 'Bermasalah', color: '#dc2626' });
    expect(create.status).toBe(201);
    expect(create.body.branchId).toBeNull();

    const supA = await request(app).get('/api/tags').set('Authorization', `Bearer ${supATok}`);
    expect(supA.body.find((t: any) => t.id === create.body.id)).toBeDefined();
  });

  it('duplicate tag name within branch → 409', async () => {
    await request(app).post('/api/tags').set('Authorization', `Bearer ${supATok}`)
      .send({ name: 'Restruktur' });
    const dup = await request(app).post('/api/tags').set('Authorization', `Bearer ${supATok}`)
      .send({ name: 'Restruktur' });
    expect(dup.status).toBe(409);
  });

  it('assign + remove tag on nasabah; tag chip surfaces in list response', async () => {
    const tag = (await request(app).post('/api/tags').set('Authorization', `Bearer ${supATok}`)
      .send({ name: 'Janji rutin' })).body;

    // Need a real nasabah — pull the first one in branch A's seed.
    const nasabah = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    expect(nasabah).toBeTruthy();

    const apply = await request(app).post(`/api/nasabah/${nasabah!.id}/tags`)
      .set('Authorization', `Bearer ${supATok}`)
      .send({ tagId: tag.id });
    expect(apply.status).toBe(201);

    const list = await request(app).get(`/api/nasabah?tagId=${tag.id}`)
      .set('Authorization', `Bearer ${supATok}`);
    expect(list.body.find((n: any) => n.id === nasabah!.id)?.tags).toEqual([
      expect.objectContaining({ id: tag.id, name: 'Janji rutin' }),
    ]);

    const detail = await request(app).get(`/api/nasabah/${nasabah!.id}`)
      .set('Authorization', `Bearer ${supATok}`);
    expect(detail.body.tags.length).toBe(1);

    const rm = await request(app).delete(`/api/nasabah/${nasabah!.id}/tags/${tag.id}`)
      .set('Authorization', `Bearer ${supATok}`);
    expect(rm.status).toBe(200);

    const after = await request(app).get(`/api/nasabah/${nasabah!.id}`)
      .set('Authorization', `Bearer ${supATok}`);
    expect(after.body.tags.length).toBe(0);
  });

  it('cannot apply other-branch tag onto nasabah', async () => {
    // Tag belongs to branch B.
    const tag = (await request(app).post('/api/tags').set('Authorization', `Bearer ${supBTok}`)
      .send({ name: 'B-only' })).body;
    // Nasabah belongs to branch A.
    const nasabah = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    const r = await request(app).post(`/api/nasabah/${nasabah!.id}/tags`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ tagId: tag.id });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('tag_branch_mismatch');
  });

  it('PETUGAS cannot mutate tags', async () => {
    const r = await request(app).post('/api/tags').set('Authorization', `Bearer ${petTok}`)
      .send({ name: 'X' });
    expect(r.status).toBe(403);
  });
});
