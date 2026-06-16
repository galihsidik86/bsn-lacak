import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('Nasabah bulk import', () => {
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

  it('imports all valid rows', async () => {
    const r = await request(app).post('/api/nasabah/bulk')
      .set('Authorization', `Bearer ${supTok}`)
      .send({
        rows: [
          { kode: 'NBULK1', nama: 'A', alamat: 'X', hp: '08', plafon: 1000, tenor: 12, angsuran: 100, sisa: 1000, petugasId: s.petugasAId },
          { kode: 'NBULK2', nama: 'B', alamat: 'Y', hp: '08', plafon: 2000, tenor: 12, angsuran: 200, sisa: 2000, petugasId: s.petugasAId },
        ],
      });
    expect(r.status).toBe(201);
    expect(r.body.imported).toBe(2);
    const count = await prisma.nasabah.count({ where: { kode: { startsWith: 'NBULK' } } });
    expect(count).toBe(2);
  });

  it('marks duplicates without inserting', async () => {
    await prisma.nasabah.create({
      data: { kode: 'NDUP', nama: 'pre', alamat: 'x', hp: '0', petugasId: s.petugasAId, branchId: s.branchAId, plafon: 1n, tenor: 12, angsuran: 1n, sisa: 1n },
    });
    const r = await request(app).post('/api/nasabah/bulk')
      .set('Authorization', `Bearer ${supTok}`)
      .send({
        rows: [
          { kode: 'NDUP', nama: 'X', alamat: 'X', hp: '0', plafon: 1, tenor: 12, angsuran: 1, sisa: 1, petugasId: s.petugasAId },
          { kode: 'NOK1', nama: 'Y', alamat: 'X', hp: '0', plafon: 1, tenor: 12, angsuran: 1, sisa: 1, petugasId: s.petugasAId },
        ],
      });
    expect(r.body.imported).toBe(1);
    expect(r.body.outcomes[0].status).toBe('duplicate');
    expect(r.body.outcomes[1].status).toBe('imported');
  });

  it('blocks cross-branch petugas for SUPERVISOR', async () => {
    const r = await request(app).post('/api/nasabah/bulk')
      .set('Authorization', `Bearer ${supTok}`)
      .send({
        rows: [
          { kode: 'NCB1', nama: 'X', alamat: 'X', hp: '0', plafon: 1, tenor: 12, angsuran: 1, sisa: 1, petugasId: s.petugasBId },
        ],
      });
    expect(r.body.imported).toBe(0);
    expect(r.body.outcomes[0].status).toBe('cross_branch');
  });

  it('rejects unknown petugas', async () => {
    const r = await request(app).post('/api/nasabah/bulk')
      .set('Authorization', `Bearer ${supTok}`)
      .send({
        rows: [
          { kode: 'NUP1', nama: 'X', alamat: 'X', hp: '0', plafon: 1, tenor: 12, angsuran: 1, sisa: 1, petugasId: 'does-not-exist' },
        ],
      });
    expect(r.body.outcomes[0].status).toBe('unknown_petugas');
  });

  it('returns 400 on empty rows', async () => {
    const r = await request(app).post('/api/nasabah/bulk')
      .set('Authorization', `Bearer ${supTok}`)
      .send({ rows: [] });
    expect(r.status).toBe(400);
  });
});
