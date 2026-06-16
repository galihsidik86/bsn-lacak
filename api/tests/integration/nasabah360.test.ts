import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('Nasabah 360 endpoint', () => {
  const app = buildApp();
  let s: SeedOut;
  let supTok: string;
  let supBTok: string;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
    supTok = await login(app, s.supervisorAUsername, s.password);
    supBTok = await login(app, s.supervisorBUsername, s.password);
  });

  it('returns nasabah profile with aggregated stats', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const r = await request(app).get(`/api/nasabah/${n!.id}/360`)
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.status).toBe(200);
    expect(r.body.nasabah.id).toBe(n!.id);
    expect(r.body.nasabah.petugas).toBeTruthy();
    expect(r.body.stats).toBeTruthy();
    expect(Array.isArray(r.body.kunjungan)).toBe(true);
    expect(Array.isArray(r.body.pembayaran)).toBe(true);
    expect(Array.isArray(r.body.feedback)).toBe(true);
  });

  it('cross-branch SUPERVISOR cannot read nasabah 360', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } }); // branch A
    const r = await request(app).get(`/api/nasabah/${n!.id}/360`)
      .set('Authorization', `Bearer ${supBTok}`);
    expect(r.status).toBe(404);
  });

  it('aggregates totalCollected from successful pembayaran', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    await prisma.pembayaran.createMany({
      data: [
        { nasabahId: n!.id, branchId: s.branchAId, nominal: 100_000n, metode: 'tunai', status: 'berhasil', jam: '10:00' },
        { nasabahId: n!.id, branchId: s.branchAId, nominal: 50_000n, metode: 'tunai', status: 'gagal', jam: '11:00' },
        { nasabahId: n!.id, branchId: s.branchAId, nominal: 200_000n, metode: 'tunai', status: 'berhasil', jam: '12:00' },
      ],
    });
    const r = await request(app).get(`/api/nasabah/${n!.id}/360`)
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.body.stats.totalCollected).toBe(300_000);
    expect(r.body.stats.paymentCount).toBe(3);
  });
});

d('Kunjungan bulk-review', () => {
  const app = buildApp();
  let s: SeedOut;
  let supTok: string;
  let petTok: string;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
    supTok = await login(app, s.supervisorAUsername, s.password);
    petTok = await login(app, s.petugasAUsername, s.password);
  });

  async function makePending(): Promise<string> {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const k = await prisma.kunjungan.create({
      data: {
        nasabahId: n!.id, petugasId: s.petugasAId, branchId: s.branchAId,
        hasil: 'BAYAR', nominal: 0n, catatan: 'x', lokasi: 'x', jam: '10:00',
        reviewStatus: 'PENDING', riskScore: 5, riskFlags: ['gps_far'],
      },
    });
    return k.id;
  }

  it('bulk approves multiple PENDING kunjungan in one call', async () => {
    const a = await makePending();
    const b = await makePending();
    const r = await request(app).post('/api/kunjungan/bulk-review')
      .set('Authorization', `Bearer ${supTok}`)
      .send({ ids: [a, b], status: 'APPROVED', note: 'batch ok' });
    expect(r.status).toBe(200);
    expect(r.body.reviewed).toBe(2);
    expect(r.body.total).toBe(2);
    const after = await prisma.kunjungan.findMany({ where: { id: { in: [a, b] } } });
    expect(after.every(k => k.reviewStatus === 'APPROVED')).toBe(true);
    expect(after.every(k => k.reviewNote === 'batch ok')).toBe(true);
  });

  it('reports not_pending for already-reviewed rows', async () => {
    const a = await makePending();
    await prisma.kunjungan.update({ where: { id: a }, data: { reviewStatus: 'APPROVED' } });
    const b = await makePending();
    const r = await request(app).post('/api/kunjungan/bulk-review')
      .set('Authorization', `Bearer ${supTok}`)
      .send({ ids: [a, b], status: 'REJECTED' });
    expect(r.body.reviewed).toBe(1);
    const aOutcome = r.body.outcomes.find((o: any) => o.id === a);
    expect(aOutcome.status).toBe('not_pending');
    const bOutcome = r.body.outcomes.find((o: any) => o.id === b);
    expect(bOutcome.status).toBe('reviewed');
  });

  it('PETUGAS cannot bulk-review (403)', async () => {
    const a = await makePending();
    const r = await request(app).post('/api/kunjungan/bulk-review')
      .set('Authorization', `Bearer ${petTok}`)
      .send({ ids: [a], status: 'APPROVED' });
    expect(r.status).toBe(403);
  });

  it('400 on empty ids', async () => {
    const r = await request(app).post('/api/kunjungan/bulk-review')
      .set('Authorization', `Bearer ${supTok}`)
      .send({ ids: [], status: 'APPROVED' });
    expect(r.status).toBe(400);
  });
});
