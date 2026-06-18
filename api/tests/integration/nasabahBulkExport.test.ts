import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('nasabah bulk reassign + per-nasabah export', () => {
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

  it('bulk-reassign moves N nasabah to target petugas', async () => {
    const all = await prisma.nasabah.findMany({
      where: { branchId: s.branchAId },
      select: { id: true, kode: true, petugasId: true },
    });
    // Move all branch-A nasabah to petugasB (same branch A, kode PT2).
    const ids = all.map(n => n.id);
    const r = await request(app).post('/api/nasabah/bulk-reassign')
      .set('Authorization', `Bearer ${supTok}`)
      .send({ ids, petugasId: s.otherPetugasAId });
    expect(r.status).toBe(200);
    expect(r.body.reassigned).toBeGreaterThanOrEqual(1);

    const after = await prisma.nasabah.findMany({ where: { id: { in: ids } }, select: { petugasId: true } });
    expect(after.every(n => n.petugasId === s.otherPetugasAId)).toBe(true);
  });

  it('marks noop for nasabah already on target petugas', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const r = await request(app).post('/api/nasabah/bulk-reassign')
      .set('Authorization', `Bearer ${supTok}`)
      .send({ ids: [n!.id], petugasId: s.petugasAId });
    expect(r.status).toBe(200);
    expect(r.body.outcomes[0].status).toBe('noop');
  });

  it('SUPERVISOR cannot reassign to petugas outside their branch', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const r = await request(app).post('/api/nasabah/bulk-reassign')
      .set('Authorization', `Bearer ${supTok}`)
      .send({ ids: [n!.id], petugasId: s.petugasBId });
    expect(r.body.outcomes[0].status).toBe('cross_branch');
    expect(r.body.reassigned).toBe(0);
  });

  it('SUPERVISOR cannot bulk-reassign other branch nasabah (scope filter)', async () => {
    const branchBNasabah = await prisma.nasabah.findFirst({ where: { kode: 'N0004' } });
    const r = await request(app).post('/api/nasabah/bulk-reassign')
      .set('Authorization', `Bearer ${supTok}`)
      .send({ ids: [branchBNasabah!.id], petugasId: s.petugasAId });
    expect(r.body.outcomes[0].status).toBe('not_found');
  });

  it('PETUGAS forbidden', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const r = await request(app).post('/api/nasabah/bulk-reassign')
      .set('Authorization', `Bearer ${petTok}`)
      .send({ ids: [n!.id], petugasId: s.petugasAId });
    expect(r.status).toBe(403);
  });

  // --- export.json / export.pdf -------------------------------------

  it('export.json returns profile + serialized BigInts as strings', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const r = await request(app).get(`/api/nasabah/${n!.id}/export.json`)
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(200);
    expect(r.body.nasabah.kode).toBe('N0001');
    expect(typeof r.body.nasabah.plafon).toBe('string');
    expect(Array.isArray(r.body.pembayaran)).toBe(true);
    expect(Array.isArray(r.body.kunjungan)).toBe(true);
  });

  it('export.pdf serves a real PDF stream', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const r = await request(app)
      .get(`/api/nasabah/${n!.id}/export.pdf`)
      .set('Authorization', `Bearer ${adminTok}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/pdf/);
    const buf = r.body as Buffer;
    expect(buf.subarray(0, 4).toString('utf-8')).toBe('%PDF');
  });

  it('SUPERVISOR cross-branch export → 404', async () => {
    const branchBNasabah = await prisma.nasabah.findFirst({ where: { kode: 'N0004' } });
    const r = await request(app).get(`/api/nasabah/${branchBNasabah!.id}/export.json`)
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.status).toBe(404);
  });

  it('PETUGAS forbidden on export.json', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const r = await request(app).get(`/api/nasabah/${n!.id}/export.json`)
      .set('Authorization', `Bearer ${petTok}`);
    expect(r.status).toBe(403);
  });

  it('export writes audit log', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    await request(app).get(`/api/nasabah/${n!.id}/export.json`)
      .set('Authorization', `Bearer ${adminTok}`);
    const a = await prisma.auditLog.findFirst({ where: { action: 'nasabah.export.json', target: n!.id } });
    expect(a).not.toBeNull();
  });
});
