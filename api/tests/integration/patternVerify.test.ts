import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';
import { evalSuspiciousPattern } from '../../src/lib/antiFraud.js';
import { makeReceiptToken } from '../../src/lib/receiptToken.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

describe('evalSuspiciousPattern (BV)', () => {
  it('clean state → no flags', () => {
    const r = evalSuspiciousPattern({
      hasil: 'BAYAR', nominal: 100_000n, angsuranBulanan: 100_000n,
      sameDayBayarCount: 0, petugasVisitsLast24h: 5,
    });
    expect(r.flags).toEqual([]);
    expect(r.score).toBe(0);
  });

  it('duplicate BAYAR same day fires duplicate_visit', () => {
    const r = evalSuspiciousPattern({
      hasil: 'BAYAR', nominal: 100_000n, angsuranBulanan: 100_000n,
      sameDayBayarCount: 1, petugasVisitsLast24h: 5,
    });
    expect(r.flags).toContain('duplicate_visit');
    expect(r.score).toBeGreaterThan(0);
  });

  it('nominal > 3× angsuran fires nominal_spike', () => {
    const r = evalSuspiciousPattern({
      hasil: 'BAYAR', nominal: 500_000n, angsuranBulanan: 100_000n,
      sameDayBayarCount: 0, petugasVisitsLast24h: 5,
    });
    expect(r.flags).toContain('nominal_spike');
  });

  it('> 20 visits in 24h fires volume_anomaly', () => {
    const r = evalSuspiciousPattern({
      hasil: 'JANJI', nominal: 0n, angsuranBulanan: 100_000n,
      sameDayBayarCount: 0, petugasVisitsLast24h: 25,
    });
    expect(r.flags).toContain('volume_anomaly');
  });

  it('non-BAYAR result skips duplicate_visit + nominal_spike', () => {
    const r = evalSuspiciousPattern({
      hasil: 'TIDAKADA', nominal: 0n, angsuranBulanan: 100_000n,
      sameDayBayarCount: 3, petugasVisitsLast24h: 5,
    });
    expect(r.flags).not.toContain('duplicate_visit');
    expect(r.flags).not.toContain('nominal_spike');
  });
});

d('pattern flags fire on real kunjungan create', () => {
  const app = buildApp();
  let s: SeedOut;
  let petTok: string;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
    petTok = await login(app, s.petugasAUsername, s.password);
  });

  it('second BAYAR on same nasabah same day → duplicate_visit', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    // First create — clean.
    await request(app).post('/api/kunjungan')
      .set('Authorization', `Bearer ${petTok}`)
      .field('nasabahId', n!.id).field('petugasId', s.petugasAId)
      .field('hasil', 'BAYAR').field('nominal', '50000')
      .field('catatan', 'first').field('lokasi', 'a')
      .field('lat', '-6.4825').field('lng', '106.8595');
    // Second create — should flag duplicate_visit.
    const r = await request(app).post('/api/kunjungan')
      .set('Authorization', `Bearer ${petTok}`)
      .field('nasabahId', n!.id).field('petugasId', s.petugasAId)
      .field('hasil', 'BAYAR').field('nominal', '50000')
      .field('catatan', 'second').field('lokasi', 'a')
      .field('lat', '-6.4825').field('lng', '106.8595');
    expect(r.status).toBe(201);
    expect(r.body.riskFlags).toContain('duplicate_visit');
  });
});

d('verify endpoint (BW)', () => {
  const app = buildApp();
  let s: SeedOut;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
  });

  it('returns masked metadata for a valid token', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const k = await prisma.kunjungan.create({
      data: {
        nasabahId: n!.id, petugasId: s.petugasAId, branchId: s.branchAId,
        hasil: 'BAYAR', nominal: 250_000n, catatan: '', lokasi: '',
        jam: '10:00', tanggal: new Date(), reviewStatus: 'APPROVED',
      },
    });
    const token = makeReceiptToken(k.id);
    const r = await request(app).get(`/api/verify/${token}`);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.document.kunjunganId).toBe(k.id);
    expect(r.body.document.hasil).toBe('BAYAR');
    // Name should be masked (last name → initial).
    expect(r.body.document.nasabah.namaInisial).not.toMatch(/Nasabah A1/);
    expect(r.body.document.nasabah.namaInisial).toMatch(/Nasabah/);
  });

  it('404 on tampered token', async () => {
    const r = await request(app).get('/api/verify/garbage.token');
    expect(r.status).toBe(404);
    expect(r.body.ok).toBe(false);
  });

  it('404 when token references a deleted kunjungan', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const k = await prisma.kunjungan.create({
      data: {
        nasabahId: n!.id, petugasId: s.petugasAId, branchId: s.branchAId,
        hasil: 'BAYAR', nominal: 0n, catatan: '', lokasi: '',
        jam: '10:00', tanggal: new Date(),
      },
    });
    const token = makeReceiptToken(k.id);
    await prisma.kunjungan.delete({ where: { id: k.id } });
    const r = await request(app).get(`/api/verify/${token}`);
    expect(r.status).toBe(404);
  });
});
