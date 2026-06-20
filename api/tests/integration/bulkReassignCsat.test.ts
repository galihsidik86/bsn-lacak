import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('long-leave bulk reassign (DX) + auto CSAT (DY)', () => {
  const app = buildApp();
  let s: SeedOut;
  let adminTok: string;
  let supATok: string;
  let petATok: string;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
    adminTok = await login(app, s.adminUsername, s.password);
    supATok = await login(app, s.supervisorAUsername, s.password);
    petATok = await login(app, s.petugasAUsername, s.password);
  });

  // --- DX ---------------------------------------------------------------

  it('SUPERVISOR triggers bulk reassign on approved leave with substitute → all nasabah moved', async () => {
    const leave = await prisma.petugasLeave.create({
      data: {
        petugasId: s.petugasAId,
        substitutePetugasId: s.otherPetugasAId,
        startDate: new Date(Date.now() - 86400_000),
        endDate: new Date(Date.now() + 30 * 86400_000),
        type: 'cuti_tahunan', status: 'approved',
      },
    });
    const before = await prisma.nasabah.count({ where: { petugasId: s.petugasAId } });
    expect(before).toBeGreaterThan(0);

    const r = await request(app).post(`/api/leaves/${leave.id}/bulk-reassign`)
      .set('Authorization', `Bearer ${supATok}`);
    expect(r.status).toBe(200);
    expect(r.body.moved).toBe(before);

    const stillOwn = await prisma.nasabah.count({ where: { petugasId: s.petugasAId } });
    expect(stillOwn).toBe(0);
  });

  it('not_approved error when leave is pending', async () => {
    const leave = await prisma.petugasLeave.create({
      data: {
        petugasId: s.petugasAId,
        substitutePetugasId: s.otherPetugasAId,
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400_000),
        type: 'sakit', status: 'pending',
      },
    });
    const r = await request(app).post(`/api/leaves/${leave.id}/bulk-reassign`)
      .set('Authorization', `Bearer ${supATok}`);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('not_approved');
  });

  it('no_substitute error when leave has no substitute', async () => {
    const leave = await prisma.petugasLeave.create({
      data: {
        petugasId: s.petugasAId,
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400_000),
        type: 'sakit', status: 'approved',
      },
    });
    const r = await request(app).post(`/api/leaves/${leave.id}/bulk-reassign`)
      .set('Authorization', `Bearer ${supATok}`);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('no_substitute');
  });

  it('PETUGAS forbidden', async () => {
    const leave = await prisma.petugasLeave.create({
      data: {
        petugasId: s.petugasAId,
        substitutePetugasId: s.otherPetugasAId,
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400_000),
        type: 'sakit', status: 'approved',
      },
    });
    const r = await request(app).post(`/api/leaves/${leave.id}/bulk-reassign`)
      .set('Authorization', `Bearer ${petATok}`);
    expect(r.status).toBe(403);
  });

  // --- DY ---------------------------------------------------------------

  it('CSAT NOT sent when branch.csatEnabled is false (default)', async () => {
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    const r = await request(app).post('/api/kunjungan')
      .set('Authorization', `Bearer ${petATok}`)
      .field('nasabahId', target!.id)
      .field('petugasId', s.petugasAId)
      .field('hasil', 'BAYAR')
      .field('nominal', '50000')
      .field('catatan', 'bayar lunas')
      .field('lokasi', '-6.2,106.8');
    expect(r.status).toBe(201);

    // Brief pause not needed — enqueueFeedbackRequest is sync until the
    // gateway call, which we don't await. The feedback row is created
    // inline though, so check it.
    await new Promise(res => setTimeout(res, 100));
    const fb = await prisma.customerFeedback.findUnique({ where: { kunjunganId: r.body.id } });
    expect(fb).toBeNull();
  });

  it('CSAT sent when branch.csatEnabled is true AND hasil=BAYAR', async () => {
    await prisma.branch.update({ where: { id: s.branchAId }, data: { csatEnabled: true } });
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    const r = await request(app).post('/api/kunjungan')
      .set('Authorization', `Bearer ${petATok}`)
      .field('nasabahId', target!.id)
      .field('petugasId', s.petugasAId)
      .field('hasil', 'BAYAR')
      .field('nominal', '50000')
      .field('catatan', '')
      .field('lokasi', '-6.2,106.8');
    expect(r.status).toBe(201);
    await new Promise(res => setTimeout(res, 100));
    const fb = await prisma.customerFeedback.findUnique({ where: { kunjunganId: r.body.id } });
    expect(fb).not.toBeNull();
  });

  it('CSAT NOT sent for non-BAYAR hasil even with csatEnabled', async () => {
    await prisma.branch.update({ where: { id: s.branchAId }, data: { csatEnabled: true } });
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    const r = await request(app).post('/api/kunjungan')
      .set('Authorization', `Bearer ${petATok}`)
      .field('nasabahId', target!.id)
      .field('petugasId', s.petugasAId)
      .field('hasil', 'JANJI')
      .field('nominal', '0')
      .field('catatan', '')
      .field('lokasi', '-6.2,106.8');
    expect(r.status).toBe(201);
    await new Promise(res => setTimeout(res, 100));
    const fb = await prisma.customerFeedback.findUnique({ where: { kunjunganId: r.body.id } });
    expect(fb).toBeNull();
  });

  it('CSAT cooldown skips second BAYAR within window', async () => {
    await prisma.branch.update({ where: { id: s.branchAId }, data: { csatEnabled: true } });
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    // First BAYAR triggers CSAT.
    const first = await request(app).post('/api/kunjungan')
      .set('Authorization', `Bearer ${petATok}`)
      .field('nasabahId', target!.id)
      .field('petugasId', s.petugasAId)
      .field('hasil', 'BAYAR')
      .field('nominal', '50000')
      .field('catatan', '')
      .field('lokasi', '-6.2,106.8');
    await new Promise(res => setTimeout(res, 100));
    expect(await prisma.customerFeedback.findUnique({ where: { kunjunganId: first.body.id } })).not.toBeNull();

    // Second BAYAR same day → cooldown skips.
    const second = await request(app).post('/api/kunjungan')
      .set('Authorization', `Bearer ${petATok}`)
      .field('nasabahId', target!.id)
      .field('petugasId', s.petugasAId)
      .field('hasil', 'BAYAR')
      .field('nominal', '25000')
      .field('catatan', '')
      .field('lokasi', '-6.2,106.8');
    await new Promise(res => setTimeout(res, 100));
    const fb2 = await prisma.customerFeedback.findUnique({ where: { kunjunganId: second.body.id } });
    expect(fb2).toBeNull();
  });
});
