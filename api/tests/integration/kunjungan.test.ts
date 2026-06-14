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

d('kunjungan create + review', () => {
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

  async function nasabahA1Id(): Promise<string> {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    if (!n) throw new Error('seed missing');
    return n.id;
  }

  it('auto-approves a kunjungan with GPS on top of nasabah and no photo EXIF', async () => {
    const nasabahId = await nasabahA1Id();
    // Nasabah A1 sits at (-6.4825, 106.8595) per fixtures; submit identical coords.
    const r = await request(app).post('/api/kunjungan')
      .set('Authorization', `Bearer ${petTok}`)
      .field('nasabahId', nasabahId)
      .field('petugasId', s.petugasAId)
      .field('hasil', 'BAYAR')
      .field('nominal', '100000')
      .field('catatan', 'ok')
      .field('lokasi', 'Jl. A')
      .field('lat', '-6.4825')
      .field('lng', '106.8595');
    expect(r.status).toBe(201);
    // No photos → no EXIF flag fired; GPS check passes → score 0 → APPROVED.
    expect(r.body.reviewStatus).toBe('APPROVED');
    expect(r.body.riskScore).toBe(0);
    expect(r.body.valid).toBe(true);
  });

  it('flags + PENDINGs a kunjungan whose GPS is > 200m from nasabah', async () => {
    const nasabahId = await nasabahA1Id();
    const r = await request(app).post('/api/kunjungan')
      .set('Authorization', `Bearer ${petTok}`)
      .field('nasabahId', nasabahId)
      .field('petugasId', s.petugasAId)
      .field('hasil', 'BAYAR')
      .field('nominal', '100000')
      .field('catatan', 'ok')
      .field('lokasi', 'Jl. A')
      // ~1 km off → triggers gps_far.
      .field('lat', '-6.49')
      .field('lng', '106.86');
    expect(r.status).toBe(201);
    expect(r.body.reviewStatus).toBe('PENDING');
    expect(r.body.riskFlags).toContain('gps_far');
    expect(r.body.valid).toBe(false);
  });

  it('PETUGAS cannot impersonate another petugas', async () => {
    const nasabahId = await nasabahA1Id();
    const r = await request(app).post('/api/kunjungan')
      .set('Authorization', `Bearer ${petTok}`)
      .field('nasabahId', nasabahId)
      .field('petugasId', s.otherPetugasAId) // different petugas
      .field('hasil', 'BAYAR')
      .field('nominal', '100000')
      .field('catatan', 'ok')
      .field('lokasi', 'Jl. A');
    expect(r.status).toBe(403);
  });

  it('SUPERVISOR can approve a PENDING kunjungan with a note', async () => {
    const nasabahId = await nasabahA1Id();
    const create = await request(app).post('/api/kunjungan')
      .set('Authorization', `Bearer ${petTok}`)
      .field('nasabahId', nasabahId)
      .field('petugasId', s.petugasAId)
      .field('hasil', 'BAYAR')
      .field('nominal', '100000')
      .field('catatan', 'ok')
      .field('lokasi', 'Jl. A')
      .field('lat', '-6.49')
      .field('lng', '106.86');
    expect(create.body.reviewStatus).toBe('PENDING');

    const review = await request(app)
      .patch(`/api/kunjungan/${create.body.id}/review`)
      .set('Authorization', `Bearer ${supTok}`)
      .send({ status: 'APPROVED', note: 'ok' });
    expect(review.status).toBe(200);
    expect(review.body.reviewStatus).toBe('APPROVED');
    expect(review.body.reviewNote).toBe('ok');
    expect(review.body.reviewerId).toBe(s.supervisorAId);
  });

  it('SUPERVISOR can reject a PENDING kunjungan', async () => {
    const nasabahId = await nasabahA1Id();
    const create = await request(app).post('/api/kunjungan')
      .set('Authorization', `Bearer ${petTok}`)
      .field('nasabahId', nasabahId)
      .field('petugasId', s.petugasAId)
      .field('hasil', 'BAYAR')
      .field('nominal', '100000')
      .field('catatan', 'ok')
      .field('lokasi', 'Jl. A')
      .field('lat', '-6.49')
      .field('lng', '106.86');

    const review = await request(app)
      .patch(`/api/kunjungan/${create.body.id}/review`)
      .set('Authorization', `Bearer ${supTok}`)
      .send({ status: 'REJECTED', note: 'foto tidak jelas' });
    expect(review.status).toBe(200);
    expect(review.body.reviewStatus).toBe('REJECTED');
  });

  it('rejects double-review with 409', async () => {
    const nasabahId = await nasabahA1Id();
    const create = await request(app).post('/api/kunjungan')
      .set('Authorization', `Bearer ${petTok}`)
      .field('nasabahId', nasabahId)
      .field('petugasId', s.petugasAId)
      .field('hasil', 'BAYAR')
      .field('nominal', '100000')
      .field('catatan', 'ok')
      .field('lokasi', 'Jl. A')
      .field('lat', '-6.49')
      .field('lng', '106.86');

    await request(app).patch(`/api/kunjungan/${create.body.id}/review`)
      .set('Authorization', `Bearer ${supTok}`)
      .send({ status: 'APPROVED' });
    const again = await request(app).patch(`/api/kunjungan/${create.body.id}/review`)
      .set('Authorization', `Bearer ${supTok}`)
      .send({ status: 'REJECTED' });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('already_reviewed');
  });

  it('PETUGAS cannot review their own kunjungan', async () => {
    const nasabahId = await nasabahA1Id();
    const create = await request(app).post('/api/kunjungan')
      .set('Authorization', `Bearer ${petTok}`)
      .field('nasabahId', nasabahId)
      .field('petugasId', s.petugasAId)
      .field('hasil', 'BAYAR')
      .field('nominal', '100000')
      .field('catatan', 'ok')
      .field('lokasi', 'Jl. A')
      .field('lat', '-6.49')
      .field('lng', '106.86');

    const r = await request(app).patch(`/api/kunjungan/${create.body.id}/review`)
      .set('Authorization', `Bearer ${petTok}`)
      .send({ status: 'APPROVED' });
    expect(r.status).toBe(403);
  });

  it('SUPERVISOR of another branch cannot review cross-branch', async () => {
    const nasabahId = await nasabahA1Id();
    const create = await request(app).post('/api/kunjungan')
      .set('Authorization', `Bearer ${petTok}`)
      .field('nasabahId', nasabahId)
      .field('petugasId', s.petugasAId)
      .field('hasil', 'BAYAR')
      .field('nominal', '100000')
      .field('catatan', 'ok')
      .field('lokasi', 'Jl. A')
      .field('lat', '-6.49')
      .field('lng', '106.86');

    const supBTok = await login(app, s.supervisorBUsername, s.password);
    const r = await request(app).patch(`/api/kunjungan/${create.body.id}/review`)
      .set('Authorization', `Bearer ${supBTok}`)
      .send({ status: 'APPROVED' });
    expect(r.status).toBe(404); // out of scope
  });
});
