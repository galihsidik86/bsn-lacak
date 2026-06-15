import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, username: string, password: string): Promise<string> {
  return (await request(app).post('/api/auth/login').send({ username, password })).body.token as string;
}

d('Nasabah CRUD', () => {
  const app = buildApp();
  let s: SeedOut;
  let supTok: string;
  let petTok: string;
  let supBTok: string;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
    supTok = await login(app, s.supervisorAUsername, s.password);
    petTok = await login(app, s.petugasAUsername, s.password);
    supBTok = await login(app, s.supervisorBUsername, s.password);
  });

  it('SUPERVISOR creates a new nasabah within own branch', async () => {
    const r = await request(app).post('/api/nasabah')
      .set('Authorization', `Bearer ${supTok}`)
      .send({
        kode: 'N9001', nama: 'Test Baru', alamat: 'Jl. Baru', hp: '08111000111',
        kol: 'K1', akad: 'MURABAHAH', plafon: 5_000_000, tenor: 12,
        angsuran: 500_000, sisa: 5_000_000, petugasId: s.petugasAId,
      });
    expect(r.status).toBe(201);
    expect(r.body.kode).toBe('N9001');
    expect(r.body.active).toBe(true);
    expect(r.body.branchId).toBe(s.branchAId);
  });

  it('PETUGAS cannot create nasabah (403)', async () => {
    const r = await request(app).post('/api/nasabah')
      .set('Authorization', `Bearer ${petTok}`)
      .send({
        kode: 'N9002', nama: 'X', alamat: 'X', hp: '08',
        plafon: 1, tenor: 12, angsuran: 1, sisa: 1, petugasId: s.petugasAId,
      });
    expect(r.status).toBe(403);
  });

  it('SUPERVISOR cannot create nasabah for petugas in another branch', async () => {
    const r = await request(app).post('/api/nasabah')
      .set('Authorization', `Bearer ${supTok}`)
      .send({
        kode: 'N9003', nama: 'X', alamat: 'X', hp: '08',
        plafon: 1, tenor: 12, angsuran: 1, sisa: 1, petugasId: s.petugasBId,
      });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('cross_branch_forbidden');
  });

  it('rejects duplicate kode with 409', async () => {
    const payload = {
      kode: 'N9010', nama: 'A', alamat: 'A', hp: '0',
      plafon: 1, tenor: 12, angsuran: 1, sisa: 1, petugasId: s.petugasAId,
    };
    await request(app).post('/api/nasabah').set('Authorization', `Bearer ${supTok}`).send(payload);
    const r = await request(app).post('/api/nasabah').set('Authorization', `Bearer ${supTok}`).send(payload);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('kode_taken');
  });

  it('PATCH updates fields but ignores kode change', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const r = await request(app).patch(`/api/nasabah/${n!.id}`)
      .set('Authorization', `Bearer ${supTok}`)
      .send({ alamat: 'Jl. Baru', kode: 'NEWKODE' });
    expect(r.status).toBe(200);
    expect(r.body.alamat).toBe('Jl. Baru');
    expect(r.body.kode).toBe('N0001'); // immutable
  });

  it('DELETE soft-deactivates (active=false)', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const r = await request(app).delete(`/api/nasabah/${n!.id}`)
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.status).toBe(200);
    const after = await prisma.nasabah.findUnique({ where: { id: n!.id } });
    expect(after!.active).toBe(false);
  });

  it('GET excludes inactive by default, includes when includeInactive=1', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    await prisma.nasabah.update({ where: { id: n!.id }, data: { active: false } });
    const r1 = await request(app).get('/api/nasabah').set('Authorization', `Bearer ${supTok}`);
    expect(r1.body.find((x: any) => x.id === n!.id)).toBeUndefined();
    const r2 = await request(app).get('/api/nasabah?includeInactive=1').set('Authorization', `Bearer ${supTok}`);
    expect(r2.body.find((x: any) => x.id === n!.id)).toBeDefined();
  });

  it('cross-branch SUPERVISOR sees 404 on patch outside scope', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } }); // branch A
    const r = await request(app).patch(`/api/nasabah/${n!.id}`)
      .set('Authorization', `Bearer ${supBTok}`)
      .send({ alamat: 'X' });
    expect(r.status).toBe(404);
  });
});

d('Petugas deactivate', () => {
  const app = buildApp();
  let s: SeedOut;
  let supTok: string;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
    supTok = await login(app, s.supervisorAUsername, s.password);
  });

  it('DELETE marks petugas inactive', async () => {
    const r = await request(app).delete(`/api/petugas/${s.petugasAId}`)
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.status).toBe(200);
    const after = await prisma.petugas.findUnique({ where: { id: s.petugasAId } });
    expect(after!.active).toBe(false);
  });

  it('inactive petugas hidden from GET by default', async () => {
    await prisma.petugas.update({ where: { id: s.petugasAId }, data: { active: false } });
    const r = await request(app).get('/api/petugas').set('Authorization', `Bearer ${supTok}`);
    expect(r.body.find((p: any) => p.id === s.petugasAId)).toBeUndefined();
  });

  it('SUPERVISOR cannot deactivate petugas in another branch', async () => {
    const r = await request(app).delete(`/api/petugas/${s.petugasBId}`)
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.status).toBe(404);
  });
});

d('Blast cancel', () => {
  const app = buildApp();
  let s: SeedOut;
  let supTok: string;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
    supTok = await login(app, s.supervisorAUsername, s.password);
  });

  async function makeBlast(status: 'TERJADWAL' | 'BERJALAN' = 'TERJADWAL'): Promise<string> {
    const b = await prisma.blast.create({
      data: {
        judul: 'Test', kanal: 'WA', template: 'halo', status,
        target: 1, branchId: s.branchAId, scheduledAt: new Date(Date.now() + 60_000),
      },
    });
    return b.id;
  }

  it('cancels a TERJADWAL blast', async () => {
    const id = await makeBlast('TERJADWAL');
    const r = await request(app).patch(`/api/blast/${id}/cancel`)
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('DIBATALKAN');
  });

  it('refuses to cancel a BERJALAN blast with 409', async () => {
    const id = await makeBlast('BERJALAN');
    const r = await request(app).patch(`/api/blast/${id}/cancel`)
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('not_cancellable');
  });
});
