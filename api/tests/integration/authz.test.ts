import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function loginAs(app: any, username: string, password: string) {
  const r = await request(app).post('/api/auth/login').send({ username, password });
  return { token: r.body.token as string, cookie: r.headers['set-cookie'] };
}

d('role-based authorization', () => {
  const app = buildApp();
  let s: SeedOut;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
  });

  it('petugas sees only their own nasabah', async () => {
    const { token } = await loginAs(app, s.petugasUsername, s.password);
    const r = await request(app).get('/api/nasabah').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    // pet1 owns N0001 + N0002 in the fixture (2 rows), not N0003.
    expect(r.body).toHaveLength(2);
    for (const n of r.body) expect(n.petugasId).toBe(s.petugasId);
  });

  it('supervisor sees all nasabah', async () => {
    const { token } = await loginAs(app, s.supervisorUsername, s.password);
    const r = await request(app).get('/api/nasabah').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(3);
  });

  it('petugas cannot reassign a nasabah (supervisor-only)', async () => {
    const { token } = await loginAs(app, s.petugasUsername, s.password);
    const n = await prisma.nasabah.findFirst({ where: { petugasId: s.petugasId } });
    const r = await request(app).patch(`/api/nasabah/${n!.id}/petugas`)
      .set('Authorization', `Bearer ${token}`)
      .send({ petugasId: s.otherPetugasId });
    expect(r.status).toBe(403);
  });

  it('supervisor can reassign a nasabah', async () => {
    const { token } = await loginAs(app, s.supervisorUsername, s.password);
    const n = await prisma.nasabah.findFirst({ where: { petugasId: s.petugasId } });
    const r = await request(app).patch(`/api/nasabah/${n!.id}/petugas`)
      .set('Authorization', `Bearer ${token}`)
      .send({ petugasId: s.otherPetugasId });
    expect(r.status).toBe(200);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'nasabah.reassign' }, orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
  });

  it('petugas cannot create a blast', async () => {
    const { token } = await loginAs(app, s.petugasUsername, s.password);
    const target = await prisma.nasabah.findMany({ take: 1 });
    const r = await request(app).post('/api/blast')
      .set('Authorization', `Bearer ${token}`)
      .send({ judul: 'test', kanal: 'WA', template: 'hi {nama}', recipientIds: [target[0]!.id] });
    expect(r.status).toBe(403);
  });

  it('supervisor can create a blast', async () => {
    const { token } = await loginAs(app, s.supervisorUsername, s.password);
    const target = await prisma.nasabah.findMany({ take: 2 });
    const r = await request(app).post('/api/blast')
      .set('Authorization', `Bearer ${token}`)
      .send({ judul: 'reminder', kanal: 'WA', template: 'Halo {nama}', recipientIds: target.map(n => n.id) });
    expect(r.status).toBe(201);
    expect(r.body.jobId).toBeTruthy();
  });

  it('refuses unauthenticated requests', async () => {
    const r = await request(app).get('/api/nasabah');
    expect(r.status).toBe(401);
  });
});
