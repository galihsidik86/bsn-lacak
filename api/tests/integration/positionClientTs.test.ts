import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('POST /petugas/:id/position — clientTs honored for recordedAt', () => {
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

  it('uses clientTs (ms epoch) as recordedAt when within 24h window', async () => {
    // Capture 10 menit lalu — kasus drain queue setelah offline pendek.
    const captureMs = Date.now() - 10 * 60 * 1000;
    const res = await request(app).post(`/api/petugas/${s.petugasAId}/position`)
      .set('Authorization', `Bearer ${petTok}`)
      .send({ lat: -6.4, lng: 106.8, accuracy: 12, clientTs: captureMs });
    expect(res.status).toBe(201);

    const row = await prisma.petugasPosition.findFirst({
      where: { petugasId: s.petugasAId },
      orderBy: { recordedAt: 'desc' },
    });
    expect(row).toBeTruthy();
    // Selisih maksimum 1 detik untuk akomodir round-trip.
    expect(Math.abs(row!.recordedAt.getTime() - captureMs)).toBeLessThan(1000);
  });

  it('falls back to NOW() when clientTs is missing', async () => {
    const before = Date.now();
    const res = await request(app).post(`/api/petugas/${s.petugasAId}/position`)
      .set('Authorization', `Bearer ${petTok}`)
      .send({ lat: -6.4, lng: 106.8, accuracy: 12 });
    expect(res.status).toBe(201);

    const row = await prisma.petugasPosition.findFirst({
      where: { petugasId: s.petugasAId },
      orderBy: { recordedAt: 'desc' },
    });
    expect(row!.recordedAt.getTime()).toBeGreaterThanOrEqual(before - 100);
    expect(row!.recordedAt.getTime()).toBeLessThanOrEqual(Date.now() + 100);
  });

  it('falls back to NOW() when clientTs is older than 24h (stale)', async () => {
    const before = Date.now();
    const staleTs = Date.now() - 25 * 60 * 60 * 1000;
    const res = await request(app).post(`/api/petugas/${s.petugasAId}/position`)
      .set('Authorization', `Bearer ${petTok}`)
      .send({ lat: -6.4, lng: 106.8, accuracy: 12, clientTs: staleTs });
    // Tidak menolak request — server simpan dengan NOW() supaya drain
    // loop client tidak macet karena 1 ping basi.
    expect(res.status).toBe(201);

    const row = await prisma.petugasPosition.findFirst({
      where: { petugasId: s.petugasAId },
      orderBy: { recordedAt: 'desc' },
    });
    expect(row!.recordedAt.getTime()).toBeGreaterThanOrEqual(before - 100);
    expect(row!.recordedAt.getTime()).toBeGreaterThan(staleTs + 60 * 1000);
  });

  it('falls back to NOW() when clientTs is in the future beyond skew window', async () => {
    const before = Date.now();
    const futureTs = Date.now() + 10 * 60 * 1000; // 10 menit di depan
    const res = await request(app).post(`/api/petugas/${s.petugasAId}/position`)
      .set('Authorization', `Bearer ${petTok}`)
      .send({ lat: -6.4, lng: 106.8, accuracy: 12, clientTs: futureTs });
    expect(res.status).toBe(201);

    const row = await prisma.petugasPosition.findFirst({
      where: { petugasId: s.petugasAId },
      orderBy: { recordedAt: 'desc' },
    });
    expect(row!.recordedAt.getTime()).toBeLessThan(futureTs);
    expect(row!.recordedAt.getTime()).toBeGreaterThanOrEqual(before - 100);
  });

  it('accepts clientTs as ISO string', async () => {
    const captureMs = Date.now() - 5 * 60 * 1000;
    const iso = new Date(captureMs).toISOString();
    const res = await request(app).post(`/api/petugas/${s.petugasAId}/position`)
      .set('Authorization', `Bearer ${petTok}`)
      .send({ lat: -6.4, lng: 106.8, accuracy: 12, clientTs: iso });
    expect(res.status).toBe(201);

    const row = await prisma.petugasPosition.findFirst({
      where: { petugasId: s.petugasAId },
      orderBy: { recordedAt: 'desc' },
    });
    expect(Math.abs(row!.recordedAt.getTime() - captureMs)).toBeLessThan(1000);
  });
});
