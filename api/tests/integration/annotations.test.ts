import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('Photo annotations', () => {
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

  async function makeKunjunganWithFoto(): Promise<string> {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const k = await prisma.kunjungan.create({
      data: {
        nasabahId: n!.id, petugasId: s.petugasAId, branchId: s.branchAId,
        hasil: 'BAYAR', nominal: 0n, catatan: 'x', lokasi: 'x', jam: '10:00',
      },
    });
    const f = await prisma.foto.create({
      data: { kunjunganId: k.id, path: 'test.jpg' },
    });
    return f.id;
  }

  it('SUPERVISOR saves annotations on own-branch foto', async () => {
    const fotoId = await makeKunjunganWithFoto();
    const r = await request(app).patch(`/api/foto/${fotoId}/annotations`)
      .set('Authorization', `Bearer ${supTok}`)
      .send({
        annotations: [
          { type: 'circle', x: 0.5, y: 0.5, r: 0.1, color: '#ef4444' },
          { type: 'note', x: 0.3, y: 0.3, text: 'Foto buram' },
        ],
      });
    expect(r.status).toBe(200);

    const get = await request(app).get(`/api/foto/${fotoId}/annotations`)
      .set('Authorization', `Bearer ${supTok}`);
    expect(get.body.annotations).toHaveLength(2);
  });

  it('cross-branch SUPERVISOR cannot annotate', async () => {
    const fotoId = await makeKunjunganWithFoto();
    const r = await request(app).patch(`/api/foto/${fotoId}/annotations`)
      .set('Authorization', `Bearer ${supBTok}`)
      .send({ annotations: [{ type: 'circle', x: 0.5, y: 0.5, r: 0.1 }] });
    expect(r.status).toBe(404);
  });

  it('PETUGAS cannot annotate (403)', async () => {
    const fotoId = await makeKunjunganWithFoto();
    const r = await request(app).patch(`/api/foto/${fotoId}/annotations`)
      .set('Authorization', `Bearer ${petTok}`)
      .send({ annotations: [] });
    expect(r.status).toBe(403);
  });

  it('rejects out-of-range coordinates', async () => {
    const fotoId = await makeKunjunganWithFoto();
    const r = await request(app).patch(`/api/foto/${fotoId}/annotations`)
      .set('Authorization', `Bearer ${supTok}`)
      .send({ annotations: [{ type: 'circle', x: 1.5, y: 0.5, r: 0.1 }] });
    expect(r.status).toBe(400);
  });
});
