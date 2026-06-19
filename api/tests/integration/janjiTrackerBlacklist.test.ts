import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('janji tracker (DJ) + nasabah blacklist (DK)', () => {
  const app = buildApp();
  let s: SeedOut;
  let adminTok: string;
  let supATok: string;
  let petTok: string;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
    adminTok = await login(app, s.adminUsername, s.password);
    supATok = await login(app, s.supervisorAUsername, s.password);
    petTok = await login(app, s.petugasAUsername, s.password);
  });

  // --- DJ ---------------------------------------------------------------

  it('JANJI followed up within 72h → kept; older + no follow-up → missed', async () => {
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    const now = new Date();
    const fiveDaysAgo = new Date(now.getTime() - 5 * 86400_000);
    const fourDaysAgo = new Date(now.getTime() - 4 * 86400_000);
    const tenDaysAgo  = new Date(now.getTime() - 10 * 86400_000);

    // Kept: JANJI 5d ago + follow-up 4d ago (24h after).
    await prisma.kunjungan.create({
      data: {
        nasabahId: target!.id, petugasId: target!.petugasId, branchId: target!.branchId,
        tanggal: fiveDaysAgo, jam: '10:00', hasil: 'JANJI',
        catatan: 'janji-1', lokasi: 'x', valid: true,
      },
    });
    await prisma.kunjungan.create({
      data: {
        nasabahId: target!.id, petugasId: target!.petugasId, branchId: target!.branchId,
        tanggal: fourDaysAgo, jam: '10:00', hasil: 'BAYAR',
        catatan: 'bayar', lokasi: 'x', valid: true, nominal: 1000n,
      },
    });
    // Missed: JANJI 10d ago, no follow-up (and we'll do nothing after).
    await prisma.kunjungan.create({
      data: {
        nasabahId: target!.id, petugasId: target!.petugasId, branchId: target!.branchId,
        tanggal: tenDaysAgo, jam: '10:00', hasil: 'JANJI',
        catatan: 'janji-old', lokasi: 'x', valid: true,
      },
    });

    const r = await request(app).get('/api/analytics/janji-tracker?days=30')
      .set('Authorization', `Bearer ${supATok}`);
    expect(r.status).toBe(200);
    expect(r.body.totals.kept).toBe(1);
    expect(r.body.totals.missed).toBe(1);
    expect(r.body.totals.pending).toBe(0);
  });

  it('pending status when JANJI is within FOLLOWUP_HOURS window', async () => {
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    const oneHourAgo = new Date(Date.now() - 60 * 60_000);
    await prisma.kunjungan.create({
      data: {
        nasabahId: target!.id, petugasId: target!.petugasId, branchId: target!.branchId,
        tanggal: oneHourAgo, jam: '10:00', hasil: 'JANJI',
        catatan: 'janji-fresh', lokasi: 'x', valid: true,
      },
    });
    const r = await request(app).get('/api/analytics/janji-tracker?days=30')
      .set('Authorization', `Bearer ${supATok}`);
    expect(r.body.totals.pending).toBe(1);
  });

  it('PETUGAS forbidden from tracker', async () => {
    const r = await request(app).get('/api/analytics/janji-tracker')
      .set('Authorization', `Bearer ${petTok}`);
    expect(r.status).toBe(403);
  });

  // --- DK ---------------------------------------------------------------

  it('SUPERVISOR blacklists nasabah with reason; list includes flag + filter', async () => {
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    const r = await request(app).patch(`/api/nasabah/${target!.id}/blacklist`)
      .set('Authorization', `Bearer ${supATok}`)
      .send({ blacklisted: true, reason: 'KTP palsu terdeteksi' });
    expect(r.status).toBe(200);
    expect(r.body.blacklisted).toBe(true);
    expect(r.body.blacklistReason).toBe('KTP palsu terdeteksi');
    expect(r.body.blacklistedAt).toBeTruthy();

    const detail = await request(app).get(`/api/nasabah/${target!.id}`)
      .set('Authorization', `Bearer ${supATok}`);
    expect(detail.body.blacklisted).toBe(true);

    const all = await request(app).get('/api/nasabah')
      .set('Authorization', `Bearer ${supATok}`);
    expect(all.body.find((n: any) => n.id === target!.id)?.blacklisted).toBe(true);

    const filtered = await request(app).get('/api/nasabah?blacklistOnly=1')
      .set('Authorization', `Bearer ${supATok}`);
    expect(filtered.body.length).toBe(1);
    expect(filtered.body[0].id).toBe(target!.id);
  });

  it('reason required when blacklisting; clearing nukes reason + timestamp', async () => {
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });

    const noReason = await request(app).patch(`/api/nasabah/${target!.id}/blacklist`)
      .set('Authorization', `Bearer ${supATok}`)
      .send({ blacklisted: true });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error).toBe('reason_required');

    await request(app).patch(`/api/nasabah/${target!.id}/blacklist`)
      .set('Authorization', `Bearer ${supATok}`)
      .send({ blacklisted: true, reason: 'r' });

    const clear = await request(app).patch(`/api/nasabah/${target!.id}/blacklist`)
      .set('Authorization', `Bearer ${supATok}`)
      .send({ blacklisted: false });
    expect(clear.status).toBe(200);
    expect(clear.body.blacklisted).toBe(false);
    expect(clear.body.blacklistReason).toBeNull();
    expect(clear.body.blacklistedAt).toBeNull();
  });

  it('PETUGAS forbidden to blacklist', async () => {
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    const r = await request(app).patch(`/api/nasabah/${target!.id}/blacklist`)
      .set('Authorization', `Bearer ${petTok}`)
      .send({ blacklisted: true, reason: 'r' });
    expect(r.status).toBe(403);
  });

  it('cross-branch SUPERVISOR cannot blacklist', async () => {
    const branchBNas = await prisma.nasabah.findFirst({ where: { branchId: s.branchBId } });
    const r = await request(app).patch(`/api/nasabah/${branchBNas!.id}/blacklist`)
      .set('Authorization', `Bearer ${supATok}`)
      .send({ blacklisted: true, reason: 'r' });
    expect(r.status).toBe(404);
  });

  it('ADMIN can blacklist across branches', async () => {
    const branchBNas = await prisma.nasabah.findFirst({ where: { branchId: s.branchBId } });
    const r = await request(app).patch(`/api/nasabah/${branchBNas!.id}/blacklist`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ blacklisted: true, reason: 'fraud cross-branch' });
    expect(r.status).toBe(200);
  });
});
