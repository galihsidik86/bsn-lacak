import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';
import { runArchiveSweep } from '../../src/workers/archiveWorker.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

async function makeReviewed(s: SeedOut, opts: {
  hoursToReview: number; reviewerId: string;
}) {
  const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
  const created = new Date(Date.now() - opts.hoursToReview * 60 * 60_000);
  return prisma.kunjungan.create({
    data: {
      nasabahId: n!.id, petugasId: s.petugasAId, branchId: s.branchAId,
      hasil: 'BAYAR', nominal: 0n, catatan: '', lokasi: '',
      jam: '10:00', tanggal: created, createdAt: created,
      reviewStatus: 'APPROVED',
      reviewerId: opts.reviewerId,
      reviewedAt: new Date(),
    },
  });
}

d('SLA stats (BX) + archive sweep (BY)', () => {
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

  // --- BX ---------------------------------------------------------------

  it('SLA computes median/avg/p95 per supervisor', async () => {
    // Three reviews of varying age by supervisor A: 1h, 4h, 12h
    await makeReviewed(s, { hoursToReview: 1, reviewerId: s.supervisorAId });
    await makeReviewed(s, { hoursToReview: 4, reviewerId: s.supervisorAId });
    await makeReviewed(s, { hoursToReview: 12, reviewerId: s.supervisorAId });

    const r = await request(app).get('/api/analytics/sla-supervisor?days=30')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(200);
    const a = r.body.rows.find((x: any) => x.reviewerUsername === 'supA');
    expect(a).toBeTruthy();
    expect(a.reviewed).toBe(3);
    expect(a.medianMinutes).toBeGreaterThan(60);
    expect(a.medianMinutes).toBeLessThan(360);
    expect(a.p95Minutes).toBeGreaterThanOrEqual(a.medianMinutes);
  });

  it('SUPERVISOR sees only their branch SLA', async () => {
    await makeReviewed(s, { hoursToReview: 1, reviewerId: s.supervisorAId });
    const r = await request(app).get('/api/analytics/sla-supervisor')
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.body.rows.every((x: any) => x.branchKode === 'TST001')).toBe(true);
  });

  it('PETUGAS forbidden on SLA', async () => {
    const r = await request(app).get('/api/analytics/sla-supervisor')
      .set('Authorization', `Bearer ${petTok}`);
    expect(r.status).toBe(403);
  });

  // --- BY ---------------------------------------------------------------

  it('archive sweep stamps APPROVED/REJECTED rows older than cutoff', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    // Two rows: one ancient + APPROVED (should be archived), one fresh.
    await prisma.kunjungan.create({
      data: {
        nasabahId: n!.id, petugasId: s.petugasAId, branchId: s.branchAId,
        hasil: 'BAYAR', nominal: 0n, catatan: 'old', lokasi: '',
        jam: '10:00',
        tanggal: new Date(Date.now() - 200 * 24 * 60 * 60_000),
        reviewStatus: 'APPROVED',
      },
    });
    await prisma.kunjungan.create({
      data: {
        nasabahId: n!.id, petugasId: s.petugasAId, branchId: s.branchAId,
        hasil: 'BAYAR', nominal: 0n, catatan: 'fresh', lokasi: '',
        jam: '10:00', tanggal: new Date(),
        reviewStatus: 'APPROVED',
      },
    });

    const result = await runArchiveSweep();
    expect(result.archived).toBe(1);

    const archived = await prisma.kunjungan.findFirst({ where: { catatan: 'old' } });
    expect(archived?.archivedAt).not.toBeNull();
    const fresh = await prisma.kunjungan.findFirst({ where: { catatan: 'fresh' } });
    expect(fresh?.archivedAt).toBeNull();
  });

  it('archive sweep skips PENDING rows even when old', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    await prisma.kunjungan.create({
      data: {
        nasabahId: n!.id, petugasId: s.petugasAId, branchId: s.branchAId,
        hasil: 'BAYAR', nominal: 0n, catatan: 'pending-old', lokasi: '',
        jam: '10:00',
        tanggal: new Date(Date.now() - 200 * 24 * 60 * 60_000),
        reviewStatus: 'PENDING',
      },
    });
    const result = await runArchiveSweep();
    expect(result.archived).toBe(0);
  });

  it('default GET /kunjungan filters archived rows', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    await prisma.kunjungan.create({
      data: {
        nasabahId: n!.id, petugasId: s.petugasAId, branchId: s.branchAId,
        hasil: 'BAYAR', nominal: 0n, catatan: 'in-list', lokasi: '',
        jam: '10:00', tanggal: new Date(), reviewStatus: 'APPROVED',
      },
    });
    const archivedRow = await prisma.kunjungan.create({
      data: {
        nasabahId: n!.id, petugasId: s.petugasAId, branchId: s.branchAId,
        hasil: 'BAYAR', nominal: 0n, catatan: 'hidden', lokasi: '',
        jam: '10:00', tanggal: new Date(), reviewStatus: 'APPROVED',
        archivedAt: new Date(),
      },
    });

    const r = await request(app).get('/api/kunjungan')
      .set('Authorization', `Bearer ${adminTok}`);
    const ids = r.body.map((k: any) => k.id);
    expect(ids).not.toContain(archivedRow.id);

    const r2 = await request(app).get('/api/kunjungan?includeArchived=1')
      .set('Authorization', `Bearer ${adminTok}`);
    const ids2 = r2.body.map((k: any) => k.id);
    expect(ids2).toContain(archivedRow.id);
  });
});
