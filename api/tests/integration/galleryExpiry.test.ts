import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';
import { runContractExpirySweep } from '../../src/workers/contractExpiryWorker.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('photo gallery (DV) + contract expiry alert (DW)', () => {
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

  // --- DV ---------------------------------------------------------------

  it('gallery returns all foto across nasabah kunjungan; PETUGAS sees only own nasabah', async () => {
    const target = await prisma.nasabah.findFirst({ where: { petugasId: s.petugasAId } });
    // Two kunjungan with one foto each.
    const k1 = await prisma.kunjungan.create({
      data: {
        nasabahId: target!.id, petugasId: s.petugasAId, branchId: s.branchAId,
        tanggal: new Date(Date.now() - 86400_000), jam: '10:00',
        hasil: 'BAYAR', catatan: '', lokasi: 'x', valid: true, nominal: 1000n,
        fotos: { create: [{ path: 'uploads/a.jpg' }] },
      },
      include: { fotos: true },
    });
    const k2 = await prisma.kunjungan.create({
      data: {
        nasabahId: target!.id, petugasId: s.petugasAId, branchId: s.branchAId,
        tanggal: new Date(), jam: '11:00',
        hasil: 'JANJI', catatan: '', lokasi: 'x', valid: true,
        fotos: { create: [{ path: 'uploads/b.jpg' }] },
      },
      include: { fotos: true },
    });

    const r = await request(app).get(`/api/foto/by-nasabah/${target!.id}`)
      .set('Authorization', `Bearer ${petATok}`);
    expect(r.status).toBe(200);
    expect(r.body.length).toBe(2);
    // Newest kunjungan first.
    expect(r.body[0].id).toBe(k2.fotos[0].id);
    expect(r.body[1].id).toBe(k1.fotos[0].id);

    // PETUGAS on another nasabah → forbidden.
    const other = await prisma.nasabah.findFirst({ where: { petugasId: s.otherPetugasAId } });
    const forbidden = await request(app).get(`/api/foto/by-nasabah/${other!.id}`)
      .set('Authorization', `Bearer ${petATok}`);
    expect(forbidden.status).toBe(403);
  });

  it('SUPERVISOR sees gallery for branch nasabah; cross-branch hidden', async () => {
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    await prisma.kunjungan.create({
      data: {
        nasabahId: target!.id, petugasId: target!.petugasId, branchId: target!.branchId,
        tanggal: new Date(), jam: '10:00', hasil: 'BAYAR',
        catatan: '', lokasi: 'x', valid: true, nominal: 1000n,
        fotos: { create: [{ path: 'uploads/x.jpg' }] },
      },
    });
    const ok = await request(app).get(`/api/foto/by-nasabah/${target!.id}`)
      .set('Authorization', `Bearer ${supATok}`);
    expect(ok.body.length).toBe(1);

    const branchBNas = await prisma.nasabah.findFirst({ where: { branchId: s.branchBId } });
    const forbidden = await request(app).get(`/api/foto/by-nasabah/${branchBNas!.id}`)
      .set('Authorization', `Bearer ${supATok}`);
    expect(forbidden.status).toBe(404);
  });

  it('empty gallery returns []', async () => {
    const target = await prisma.nasabah.findFirst({ where: { petugasId: s.petugasAId } });
    const r = await request(app).get(`/api/foto/by-nasabah/${target!.id}`)
      .set('Authorization', `Bearer ${petATok}`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });

  // --- DW ---------------------------------------------------------------

  it('nasabah whose contract ends inside window → alert sent to branch supervisors', async () => {
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    const now = new Date(2026, 6, 15, 8, 0, 0);   // Wed 15 Jul 2026, 08:00.
    // Tenor 12 months, kontrak started 11.5 months ago → ends in ~2 weeks.
    await prisma.nasabah.update({
      where: { id: target!.id },
      data: {
        tenor: 12,
        kontrakMulai: new Date(now.getFullYear(), now.getMonth() - 11, now.getDate() - 14),
      },
    });
    const out = await runContractExpirySweep({ now, force: true });
    expect(out.ok).toBe(true);
    expect((out.alerted ?? 0)).toBeGreaterThanOrEqual(1);

    const supA = await prisma.user.findUnique({ where: { id: s.supervisorAId }, select: { id: true } });
    const notif = await prisma.notification.findFirst({
      where: { userId: supA!.id, type: 'nasabah.contract_expiry' },
    });
    expect(notif).toBeTruthy();
  });

  it('expiry sweep dedups per-nasabah within day', async () => {
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    // Use real now so the audit-row recency check uses the same wall clock.
    const now = new Date();
    await prisma.nasabah.update({
      where: { id: target!.id },
      data: {
        tenor: 12,
        kontrakMulai: new Date(now.getFullYear(), now.getMonth() - 11, now.getDate() - 14),
      },
    });
    const first = await runContractExpirySweep({ now, force: true });
    expect((first.alerted ?? 0)).toBeGreaterThanOrEqual(1);
    const again = await runContractExpirySweep({ now, force: true });
    expect(again.alerted ?? 0).toBe(0);
  });

  it('expiry sweep skips on weekend without force', async () => {
    const sat = new Date(2026, 5, 20, 8, 0, 0);   // Sat 20 Jun 2026.
    const out = await runContractExpirySweep({ now: sat });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('weekend');
  });

  it('nasabah without kontrakMulai is not flagged', async () => {
    // Default seed nasabah have no kontrakMulai → expiry sweep finds nothing.
    const out = await runContractExpirySweep({ force: true });
    expect(out.alerted ?? 0).toBe(0);
  });
});
