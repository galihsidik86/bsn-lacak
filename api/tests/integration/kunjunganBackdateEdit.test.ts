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

async function makeKunjungan(s: SeedOut, overrides: Partial<{ createdAt: Date; reviewStatus: 'PENDING' | 'APPROVED' | 'REJECTED' }> = {}): Promise<string> {
  const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
  const k = await prisma.kunjungan.create({
    data: {
      nasabahId: n!.id, petugasId: s.petugasAId, branchId: s.branchAId,
      hasil: 'BAYAR', nominal: 100_000n, catatan: 'first', lokasi: 'rumah',
      jam: '10:00', tanggal: new Date(),
      reviewStatus: overrides.reviewStatus ?? 'PENDING',
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
    },
  });
  return k.id;
}

d('kunjungan backdate + edit/delete window', () => {
  const app = buildApp();
  let s: SeedOut;
  let petTok: string;
  let supTok: string;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
    petTok = await login(app, s.petugasAUsername, s.password);
    supTok = await login(app, s.supervisorAUsername, s.password);
  });

  it('accepts a backdated tanggal within 7 days', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const r = await request(app).post('/api/kunjungan')
      .set('Authorization', `Bearer ${petTok}`)
      .field('nasabahId', n!.id)
      .field('petugasId', s.petugasAId)
      .field('hasil', 'BAYAR')
      .field('nominal', '100000')
      .field('catatan', 'kunjungan kemarin')
      .field('lokasi', 'rumah')
      .field('lat', '-6.4825').field('lng', '106.8595')
      .field('tanggal', yesterday.toISOString());
    expect(r.status).toBe(201);
    const row = await prisma.kunjungan.findUnique({ where: { id: r.body.id } });
    expect(row!.tanggal.toISOString().slice(0, 10)).toBe(yesterday.toISOString().slice(0, 10));
  });

  it('rejects a future tanggal', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const r = await request(app).post('/api/kunjungan')
      .set('Authorization', `Bearer ${petTok}`)
      .field('nasabahId', n!.id).field('petugasId', s.petugasAId)
      .field('hasil', 'BAYAR').field('nominal', '0')
      .field('catatan', 'x').field('lokasi', 'x')
      .field('lat', '-6.4825').field('lng', '106.8595')
      .field('tanggal', tomorrow.toISOString());
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('tanggal_in_future');
  });

  it('rejects backdate older than 7 days for PETUGAS', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const r = await request(app).post('/api/kunjungan')
      .set('Authorization', `Bearer ${petTok}`)
      .field('nasabahId', n!.id).field('petugasId', s.petugasAId)
      .field('hasil', 'BAYAR').field('nominal', '0')
      .field('catatan', 'x').field('lokasi', 'x')
      .field('lat', '-6.4825').field('lng', '106.8595')
      .field('tanggal', old.toISOString());
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('tanggal_too_old');
  });

  it('PETUGAS can edit own kunjungan within 30 min', async () => {
    const id = await makeKunjungan(s);
    const r = await request(app).patch(`/api/kunjungan/${id}`)
      .set('Authorization', `Bearer ${petTok}`)
      .send({ catatan: 'edited', nominal: '200000' });
    expect(r.status).toBe(200);
    expect(r.body.catatan).toBe('edited');
    expect(String(r.body.nominal)).toBe('200000');
  });

  it('PETUGAS cannot edit after 30 min', async () => {
    const old = new Date(Date.now() - 35 * 60_000);
    const id = await makeKunjungan(s, { createdAt: old });
    const r = await request(app).patch(`/api/kunjungan/${id}`)
      .set('Authorization', `Bearer ${petTok}`)
      .send({ catatan: 'too late' });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('edit_window_expired');
  });

  it('SUPERVISOR can edit any time within their branch', async () => {
    const old = new Date(Date.now() - 5 * 60 * 60_000);
    const id = await makeKunjungan(s, { createdAt: old });
    const r = await request(app).patch(`/api/kunjungan/${id}`)
      .set('Authorization', `Bearer ${supTok}`)
      .send({ catatan: 'supervisor patch' });
    expect(r.status).toBe(200);
    expect(r.body.catatan).toBe('supervisor patch');
  });

  it('PETUGAS can delete own PENDING kunjungan within 30 min', async () => {
    const id = await makeKunjungan(s);
    const r = await request(app).delete(`/api/kunjungan/${id}`)
      .set('Authorization', `Bearer ${petTok}`);
    expect(r.status).toBe(200);
    const after = await prisma.kunjungan.findUnique({ where: { id } });
    expect(after).toBeNull();
  });

  it('PETUGAS cannot delete after review', async () => {
    const id = await makeKunjungan(s, { reviewStatus: 'APPROVED' });
    const r = await request(app).delete(`/api/kunjungan/${id}`)
      .set('Authorization', `Bearer ${petTok}`);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('already_reviewed');
  });

  it('PETUGAS cannot delete after 30 min window', async () => {
    const old = new Date(Date.now() - 35 * 60_000);
    const id = await makeKunjungan(s, { createdAt: old });
    const r = await request(app).delete(`/api/kunjungan/${id}`)
      .set('Authorization', `Bearer ${petTok}`);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('delete_window_expired');
  });

  it('SUPERVISOR of another branch cannot edit cross-branch', async () => {
    const id = await makeKunjungan(s);
    const supBTok = await login(app, s.supervisorBUsername, s.password);
    const r = await request(app).patch(`/api/kunjungan/${id}`)
      .set('Authorization', `Bearer ${supBTok}`)
      .send({ catatan: 'cross-branch' });
    expect(r.status).toBe(404);
  });
});
