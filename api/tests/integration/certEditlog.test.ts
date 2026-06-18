import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('petugas certifications (AV) + kunjungan edit log (BT)', () => {
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

  // --- AV: cert CRUD --------------------------------------------------

  it('SUPERVISOR creates + lists cert; PETUGAS sees own', async () => {
    const create = await request(app).post('/api/certifications')
      .set('Authorization', `Bearer ${supTok}`)
      .send({
        petugasId: s.petugasAId, nama: 'OJK Collector Cert',
        penerbit: 'OJK', noSertifikat: 'OJK-2026-001',
        issuedAt: '2026-01-15', validUntil: '2027-01-15',
      });
    expect(create.status).toBe(201);

    const list = await request(app).get(`/api/certifications?petugasId=${s.petugasAId}`)
      .set('Authorization', `Bearer ${petTok}`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(1);
    expect(list.body[0].nama).toBe('OJK Collector Cert');
  });

  it('PETUGAS cannot list other petugas certs', async () => {
    const list = await request(app).get(`/api/certifications?petugasId=${s.otherPetugasAId}`)
      .set('Authorization', `Bearer ${petTok}`);
    expect(list.status).toBe(403);
  });

  it('SUPERVISOR cross-branch create → 404', async () => {
    const r = await request(app).post('/api/certifications')
      .set('Authorization', `Bearer ${supTok}`)
      .send({
        petugasId: s.petugasBId, nama: 'X',
        issuedAt: '2026-01-01',
      });
    expect(r.status).toBe(404);
  });

  it('PATCH updates the cert', async () => {
    const c = await prisma.petugasCertification.create({
      data: {
        petugasId: s.petugasAId, nama: 'AAJI', issuedAt: new Date('2026-01-01'),
      },
    });
    const r = await request(app).patch(`/api/certifications/${c.id}`)
      .set('Authorization', `Bearer ${supTok}`)
      .send({ status: 'dicabut', catatan: 'sanksi internal' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('dicabut');
    expect(r.body.catatan).toBe('sanksi internal');
  });

  it('expiring summary buckets correctly', async () => {
    const days = (d: number) => new Date(Date.now() + d * 86400000);
    await prisma.petugasCertification.createMany({
      data: [
        { petugasId: s.petugasAId, nama: 'expired', issuedAt: new Date('2025-01-01'), validUntil: days(-3) },
        { petugasId: s.petugasAId, nama: 'd30', issuedAt: new Date('2025-01-01'), validUntil: days(20) },
        { petugasId: s.petugasAId, nama: 'd60', issuedAt: new Date('2025-01-01'), validUntil: days(50) },
      ],
    });
    const r = await request(app).get('/api/certifications/expiring')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.body.summary.expired).toBe(1);
    expect(r.body.summary.days30).toBe(1);
    expect(r.body.summary.days60).toBe(1);
  });

  it('DELETE removes the cert', async () => {
    const c = await prisma.petugasCertification.create({
      data: { petugasId: s.petugasAId, nama: 'temp', issuedAt: new Date() },
    });
    const r = await request(app).delete(`/api/certifications/${c.id}`)
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.status).toBe(200);
    const after = await prisma.petugasCertification.findUnique({ where: { id: c.id } });
    expect(after).toBeNull();
  });

  // --- BT: edit log ---------------------------------------------------

  it('PATCH /kunjungan/:id writes a KunjunganEditLog row', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const k = await prisma.kunjungan.create({
      data: {
        nasabahId: n!.id, petugasId: s.petugasAId, branchId: s.branchAId,
        hasil: 'BAYAR', nominal: 100_000n, catatan: 'orig', lokasi: 'a',
        jam: '10:00', tanggal: new Date(), reviewStatus: 'PENDING',
      },
    });
    await request(app).patch(`/api/kunjungan/${k.id}`)
      .set('Authorization', `Bearer ${petTok}`)
      .send({ catatan: 'updated', nominal: '200000' });

    const logs = await prisma.kunjunganEditLog.findMany({ where: { kunjunganId: k.id } });
    expect(logs.length).toBe(1);
    const changes = logs[0].changes as Record<string, { from: unknown; to: unknown }>;
    expect(changes.catatan.from).toBe('orig');
    expect(changes.catatan.to).toBe('updated');
    expect(changes.nominal.from).toBe('100000');
  });

  it('GET /kunjungan/:id/edit-log returns the log', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const k = await prisma.kunjungan.create({
      data: {
        nasabahId: n!.id, petugasId: s.petugasAId, branchId: s.branchAId,
        hasil: 'BAYAR', nominal: 0n, catatan: 'a', lokasi: 'a',
        jam: '10:00', tanggal: new Date(), reviewStatus: 'PENDING',
      },
    });
    await request(app).patch(`/api/kunjungan/${k.id}`)
      .set('Authorization', `Bearer ${petTok}`)
      .send({ catatan: 'b' });

    const r = await request(app).get(`/api/kunjungan/${k.id}/edit-log`)
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.status).toBe(200);
    expect(r.body.length).toBe(1);
    expect(r.body[0].editor.username).toBe('petA');
  });

  it('no-op PATCH does NOT create an edit log row', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const k = await prisma.kunjungan.create({
      data: {
        nasabahId: n!.id, petugasId: s.petugasAId, branchId: s.branchAId,
        hasil: 'BAYAR', nominal: 0n, catatan: 'same', lokasi: 'same',
        jam: '10:00', tanggal: new Date(), reviewStatus: 'PENDING',
      },
    });
    await request(app).patch(`/api/kunjungan/${k.id}`)
      .set('Authorization', `Bearer ${petTok}`)
      .send({ catatan: 'same', lokasi: 'same' });
    const logs = await prisma.kunjunganEditLog.count({ where: { kunjunganId: k.id } });
    expect(logs).toBe(0);
  });
});
