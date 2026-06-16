import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('Global search', () => {
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

  it('matches nasabah by name (case-insensitive)', async () => {
    const r = await request(app).get('/api/search?q=nasabah a')
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.status).toBe(200);
    expect(r.body.nasabah.length).toBeGreaterThan(0);
    expect(r.body.totalHits).toBeGreaterThan(0);
  });

  it('matches petugas by kode', async () => {
    const r = await request(app).get('/api/search?q=PT1')
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.body.petugas.length).toBeGreaterThan(0);
  });

  it('PETUGAS gets 403', async () => {
    const r = await request(app).get('/api/search?q=x')
      .set('Authorization', `Bearer ${petTok}`);
    expect(r.status).toBe(403);
  });

  it('SUPERVISOR cannot see cross-branch hits', async () => {
    const r = await request(app).get('/api/search?q=Cabang')
      .set('Authorization', `Bearer ${supBTok}`);
    expect(r.body.nasabah.every((n: any) => n.kode.startsWith('N00') && n.kode === 'N0004')).toBe(true);
  });

  it('400 on empty query', async () => {
    const r = await request(app).get('/api/search?q=')
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.status).toBe(400);
  });
});
