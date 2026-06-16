import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

// A simple square polygon centered roughly on the Depok area used in fixtures.
const SQUARE = {
  type: 'Polygon' as const,
  coordinates: [[
    [106.84, -6.49],
    [106.86, -6.49],
    [106.86, -6.47],
    [106.84, -6.47],
    [106.84, -6.49],
  ]],
};

d('Wilayah geofence CRUD + kunjungan integration', () => {
  const app = buildApp();
  let s: SeedOut;
  let supTok: string;
  let supBTok: string;
  let petTok: string;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
    supTok = await login(app, s.supervisorAUsername, s.password);
    supBTok = await login(app, s.supervisorBUsername, s.password);
    petTok = await login(app, s.petugasAUsername, s.password);
  });

  it('SUPERVISOR creates a wilayah and assigns petugas', async () => {
    const r = await request(app).post('/api/wilayah')
      .set('Authorization', `Bearer ${supTok}`)
      .send({ nama: 'Cibinong A', polygon: SQUARE, petugasIds: [s.petugasAId] });
    expect(r.status).toBe(201);
    const p = await prisma.petugas.findUnique({ where: { id: s.petugasAId } });
    expect(p?.wilayahZoneId).toBe(r.body.id);
  });

  it('rejects cross-branch petugas assignment', async () => {
    const r = await request(app).post('/api/wilayah')
      .set('Authorization', `Bearer ${supTok}`)
      .send({ nama: 'X', polygon: SQUARE, petugasIds: [s.petugasBId] });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('cross_branch_forbidden');
  });

  it('rejects unclosed polygon ring', async () => {
    const r = await request(app).post('/api/wilayah')
      .set('Authorization', `Bearer ${supTok}`)
      .send({
        nama: 'X',
        polygon: { type: 'Polygon', coordinates: [[
          [106.84, -6.49], [106.86, -6.49], [106.86, -6.47], [106.84, -6.47],
        ]] },  // missing closure
      });
    expect(r.status).toBe(400);
  });

  it('PETUGAS cannot create wilayah', async () => {
    const r = await request(app).post('/api/wilayah')
      .set('Authorization', `Bearer ${petTok}`)
      .send({ nama: 'X', polygon: SQUARE });
    expect(r.status).toBe(403);
  });

  it('GET /mine/zone returns the petugas zone', async () => {
    const c = await request(app).post('/api/wilayah')
      .set('Authorization', `Bearer ${supTok}`)
      .send({ nama: 'Cibinong A', polygon: SQUARE, petugasIds: [s.petugasAId] });
    const r = await request(app).get('/api/wilayah/mine/zone')
      .set('Authorization', `Bearer ${petTok}`);
    expect(r.status).toBe(200);
    expect(r.body.zone.id).toBe(c.body.id);
  });

  it('SUPERVISOR of another branch cannot see wilayah on branch A', async () => {
    await request(app).post('/api/wilayah').set('Authorization', `Bearer ${supTok}`)
      .send({ nama: 'A', polygon: SQUARE });
    const r = await request(app).get('/api/wilayah')
      .set('Authorization', `Bearer ${supBTok}`);
    expect(r.body).toEqual([]);
  });

  it('flags outside_wilayah on kunjungan submitted outside zone', async () => {
    await request(app).post('/api/wilayah').set('Authorization', `Bearer ${supTok}`)
      .send({ nama: 'A', polygon: SQUARE, petugasIds: [s.petugasAId] });

    const nasabah = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    // Coords well outside SQUARE (lat -6.5 is below the polygon).
    // GPS plausibility flag may also fire — that's fine, we just assert
    // outside_wilayah is among the flags.
    const r = await request(app).post('/api/kunjungan')
      .set('Authorization', `Bearer ${petTok}`)
      .field('nasabahId', nasabah!.id)
      .field('petugasId', s.petugasAId)
      .field('hasil', 'BAYAR')
      .field('nominal', '0')
      .field('catatan', 'test')
      .field('lokasi', 'X')
      .field('lat', '-6.5')
      .field('lng', '107.0');
    expect(r.body.riskFlags).toContain('outside_wilayah');
    expect(r.body.reviewStatus).toBe('PENDING');
  });

  it('no outside_wilayah flag when point is inside zone', async () => {
    await request(app).post('/api/wilayah').set('Authorization', `Bearer ${supTok}`)
      .send({ nama: 'A', polygon: SQUARE, petugasIds: [s.petugasAId] });
    // Update nasabah position so GPS check also passes inside square.
    await prisma.nasabah.updateMany({ where: { kode: 'N0001' }, data: { lat: -6.48, lng: 106.85 } });
    const nasabah = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const r = await request(app).post('/api/kunjungan')
      .set('Authorization', `Bearer ${petTok}`)
      .field('nasabahId', nasabah!.id)
      .field('petugasId', s.petugasAId)
      .field('hasil', 'BAYAR')
      .field('nominal', '0')
      .field('catatan', 'test')
      .field('lokasi', 'X')
      .field('lat', '-6.48')
      .field('lng', '106.85');
    expect(r.body.riskFlags).not.toContain('outside_wilayah');
  });

  it('soft-delete clears wilayahZoneId on petugas', async () => {
    const c = await request(app).post('/api/wilayah').set('Authorization', `Bearer ${supTok}`)
      .send({ nama: 'A', polygon: SQUARE, petugasIds: [s.petugasAId] });
    await request(app).delete(`/api/wilayah/${c.body.id}`)
      .set('Authorization', `Bearer ${supTok}`);
    const p = await prisma.petugas.findUnique({ where: { id: s.petugasAId } });
    expect(p?.wilayahZoneId).toBeNull();
  });
});
