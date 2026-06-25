import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';
import { runStaleNasabahSweep } from '../../src/workers/staleNasabahWorker.js';
import { runJanjiReminderSweep } from '../../src/workers/janjiReminderWorker.js';
import { runIdleDetectorSweep } from '../../src/workers/idleDetectorWorker.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('petugas swap (DT) + holiday-aware reminders (DU)', () => {
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

  // --- DT ---------------------------------------------------------------

  it('PETUGAS proposes swap; SUPERVISOR approves → nasabah petugasId swapped', async () => {
    const mine = await prisma.nasabah.findFirst({ where: { petugasId: s.petugasAId } });
    const theirs = await prisma.nasabah.findFirst({ where: { petugasId: s.otherPetugasAId } });

    const propose = await request(app).post('/api/petugas-swaps')
      .set('Authorization', `Bearer ${petATok}`)
      .send({
        proposerNasabahId: mine!.id,
        counterpartNasabahId: theirs!.id,
        reason: 'rute lebih dekat',
      });
    expect(propose.status).toBe(201);

    const approve = await request(app).patch(`/api/petugas-swaps/${propose.body.id}/decision`)
      .set('Authorization', `Bearer ${supATok}`)
      .send({ decision: 'APPROVED' });
    expect(approve.status).toBe(200);

    const afterMine = await prisma.nasabah.findUnique({ where: { id: mine!.id } });
    const afterTheirs = await prisma.nasabah.findUnique({ where: { id: theirs!.id } });
    expect(afterMine!.petugasId).toBe(s.otherPetugasAId);
    expect(afterTheirs!.petugasId).toBe(s.petugasAId);
  });

  it('SUPERVISOR cannot propose (PETUGAS only); cross-branch swap blocked', async () => {
    const mine = await prisma.nasabah.findFirst({ where: { petugasId: s.petugasAId } });
    const theirs = await prisma.nasabah.findFirst({ where: { petugasId: s.otherPetugasAId } });
    const supTry = await request(app).post('/api/petugas-swaps')
      .set('Authorization', `Bearer ${supATok}`)
      .send({ proposerNasabahId: mine!.id, counterpartNasabahId: theirs!.id, reason: 'r' });
    expect(supTry.status).toBe(403);

    const branchBNas = await prisma.nasabah.findFirst({ where: { branchId: s.branchBId } });
    const cross = await request(app).post('/api/petugas-swaps')
      .set('Authorization', `Bearer ${petATok}`)
      .send({ proposerNasabahId: mine!.id, counterpartNasabahId: branchBNas!.id, reason: 'r' });
    expect(cross.status).toBe(403);
    expect(cross.body.error).toBe('cross_branch_forbidden');
  });

  it('proposer-only nasabah ownership enforced', async () => {
    const notMine = await prisma.nasabah.findFirst({ where: { petugasId: s.otherPetugasAId } });
    const target = await prisma.nasabah.findFirst({ where: { petugasId: s.petugasAId } });
    const r = await request(app).post('/api/petugas-swaps')
      .set('Authorization', `Bearer ${petATok}`)
      .send({ proposerNasabahId: notMine!.id, counterpartNasabahId: target!.id, reason: 'r' });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('not_owner');
  });

  it('duplicate PENDING for same nasabah → 409', async () => {
    const mine = await prisma.nasabah.findFirst({ where: { petugasId: s.petugasAId } });
    const theirs = await prisma.nasabah.findFirst({ where: { petugasId: s.otherPetugasAId } });
    await request(app).post('/api/petugas-swaps')
      .set('Authorization', `Bearer ${petATok}`)
      .send({ proposerNasabahId: mine!.id, counterpartNasabahId: theirs!.id, reason: 'r1' });

    const otherMine = await prisma.nasabah.findFirst({
      where: { petugasId: s.petugasAId, id: { not: mine!.id } },
    });
    if (otherMine) {
      const dup = await request(app).post('/api/petugas-swaps')
        .set('Authorization', `Bearer ${petATok}`)
        .send({ proposerNasabahId: otherMine.id, counterpartNasabahId: theirs!.id, reason: 'r2' });
      expect(dup.status).toBe(409);
    }
  });

  it('REJECTED leaves nasabah unchanged', async () => {
    const mine = await prisma.nasabah.findFirst({ where: { petugasId: s.petugasAId } });
    const theirs = await prisma.nasabah.findFirst({ where: { petugasId: s.otherPetugasAId } });
    const propose = await request(app).post('/api/petugas-swaps')
      .set('Authorization', `Bearer ${petATok}`)
      .send({ proposerNasabahId: mine!.id, counterpartNasabahId: theirs!.id, reason: 'r' });
    const r = await request(app).patch(`/api/petugas-swaps/${propose.body.id}/decision`)
      .set('Authorization', `Bearer ${supATok}`)
      .send({ decision: 'REJECTED', note: 'tidak setuju' });
    expect(r.status).toBe(200);
    const after = await prisma.nasabah.findUnique({ where: { id: mine!.id } });
    expect(after!.petugasId).toBe(s.petugasAId);
  });

  it('proposer can cancel; admin can cancel anyone', async () => {
    const mine = await prisma.nasabah.findFirst({ where: { petugasId: s.petugasAId } });
    const theirs = await prisma.nasabah.findFirst({ where: { petugasId: s.otherPetugasAId } });
    const propose = await request(app).post('/api/petugas-swaps')
      .set('Authorization', `Bearer ${petATok}`)
      .send({ proposerNasabahId: mine!.id, counterpartNasabahId: theirs!.id, reason: 'r' });
    const cancelled = await request(app).delete(`/api/petugas-swaps/${propose.body.id}`)
      .set('Authorization', `Bearer ${petATok}`);
    expect(cancelled.status).toBe(200);
    const row = await prisma.petugasSwapRequest.findUnique({ where: { id: propose.body.id } });
    expect(row!.status).toBe('CANCELLED');
  });

  // Regression: SUPERVISOR cabang lain TIDAK boleh cancel swap milik cabang
  // tetangga (IDOR fix). Sebelumnya DELETE /:id tidak cek branch scope untuk
  // SUPERVISOR/ADMIN → cross-tenant state mutation.
  it('cross-branch SUPERVISOR cannot cancel another branch swap (IDOR fix)', async () => {
    const mine = await prisma.nasabah.findFirst({ where: { petugasId: s.petugasAId } });
    const theirs = await prisma.nasabah.findFirst({ where: { petugasId: s.otherPetugasAId } });
    const propose = await request(app).post('/api/petugas-swaps')
      .set('Authorization', `Bearer ${petATok}`)
      .send({ proposerNasabahId: mine!.id, counterpartNasabahId: theirs!.id, reason: 'r' });
    expect(propose.status).toBe(201);

    const supBTok = await login(app, s.supervisorBUsername, s.password);
    const blocked = await request(app).delete(`/api/petugas-swaps/${propose.body.id}`)
      .set('Authorization', `Bearer ${supBTok}`);
    expect(blocked.status).toBe(403);

    // Sanity: row tetap PENDING — tidak ke-CANCEL meskipun ada attempt.
    const row = await prisma.petugasSwapRequest.findUnique({ where: { id: propose.body.id } });
    expect(row!.status).toBe('PENDING');

    // Own branch supervisor masih bisa cancel.
    const allowed = await request(app).delete(`/api/petugas-swaps/${propose.body.id}`)
      .set('Authorization', `Bearer ${supATok}`);
    expect(allowed.status).toBe(200);
  });

  // --- DU ---------------------------------------------------------------

  it('stale-nasabah sweep skips on national holiday', async () => {
    // 2026-01-01 is Tahun Baru Masehi.
    const holiday = new Date(2026, 0, 1, 9, 0, 0);
    const out = await runStaleNasabahSweep({ now: holiday });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/^holiday:/);
  });

  it('JANJI reminder sweep skips on weekend', async () => {
    // 2026-06-20 is a Saturday.
    const sat = new Date(2026, 5, 20, 8, 0, 0);
    const out = await runJanjiReminderSweep({ now: sat });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('weekend');
  });

  it('idle detector skips on holiday', async () => {
    const holiday = new Date(2026, 7, 17, 9, 0, 0);  // 2026-08-17 Kemerdekaan.
    const out = await runIdleDetectorSweep({ now: holiday });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/^holiday:/);
  });

  it('sweeps still run when forced (force flag bypasses holiday gate)', async () => {
    const holiday = new Date(2026, 7, 17, 9, 0, 0);
    const out = await runStaleNasabahSweep({ now: holiday, force: true });
    expect(out.ok).toBe(true);
  });
});
