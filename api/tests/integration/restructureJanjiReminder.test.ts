import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';
import { runJanjiReminderSweep } from '../../src/workers/janjiReminderWorker.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('restructure workflow (DL) + JANJI reminder (DM)', () => {
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

  // --- DL ---------------------------------------------------------------

  it('PETUGAS proposes; SUPERVISOR approves → Nasabah sisa/angsuran/tenor updated', async () => {
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    const propose = await request(app).post('/api/restructures')
      .set('Authorization', `Bearer ${petTok}`)
      .send({
        nasabahId: target!.id,
        newSisa: 500_000,
        newAngsuran: 100_000,
        newTenor: 6,
        reason: 'pelunasan dipercepat',
      });
    expect(propose.status).toBe(201);
    expect(propose.body.status).toBe('PENDING');

    const approve = await request(app).patch(`/api/restructures/${propose.body.id}/decision`)
      .set('Authorization', `Bearer ${supATok}`)
      .send({ decision: 'APPROVED', note: 'ok' });
    expect(approve.status).toBe(200);

    const after = await prisma.nasabah.findUnique({ where: { id: target!.id } });
    expect(after!.sisa).toBe(BigInt(500_000));
    expect(after!.angsuran).toBe(BigInt(100_000));
    expect(after!.tenor).toBe(6);
  });

  it('REJECTED proposal leaves nasabah untouched', async () => {
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    const before = await prisma.nasabah.findUnique({ where: { id: target!.id } });

    const propose = await request(app).post('/api/restructures')
      .set('Authorization', `Bearer ${supATok}`)
      .send({
        nasabahId: target!.id,
        newSisa: 1,
        newAngsuran: 1,
        newTenor: 1,
        reason: 'restructure',
      });

    const reject = await request(app).patch(`/api/restructures/${propose.body.id}/decision`)
      .set('Authorization', `Bearer ${supATok}`)
      .send({ decision: 'REJECTED', note: 'tidak masuk akal' });
    expect(reject.status).toBe(200);

    const after = await prisma.nasabah.findUnique({ where: { id: target!.id } });
    expect(after!.sisa).toBe(before!.sisa);
    expect(after!.angsuran).toBe(before!.angsuran);
    expect(after!.tenor).toBe(before!.tenor);
  });

  it('duplicate PENDING blocked with 409; cancel allows a fresh one', async () => {
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    const first = await request(app).post('/api/restructures')
      .set('Authorization', `Bearer ${supATok}`)
      .send({ nasabahId: target!.id, newSisa: 1, newAngsuran: 1, newTenor: 1, reason: 'r1' });

    const dup = await request(app).post('/api/restructures')
      .set('Authorization', `Bearer ${supATok}`)
      .send({ nasabahId: target!.id, newSisa: 2, newAngsuran: 2, newTenor: 2, reason: 'r2' });
    expect(dup.status).toBe(409);

    await request(app).delete(`/api/restructures/${first.body.id}`)
      .set('Authorization', `Bearer ${supATok}`);

    const fresh = await request(app).post('/api/restructures')
      .set('Authorization', `Bearer ${supATok}`)
      .send({ nasabahId: target!.id, newSisa: 3, newAngsuran: 3, newTenor: 3, reason: 'r3' });
    expect(fresh.status).toBe(201);
  });

  it('cancel forbidden for non-proposer non-admin', async () => {
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    const propose = await request(app).post('/api/restructures')
      .set('Authorization', `Bearer ${petTok}`)
      .send({ nasabahId: target!.id, newSisa: 1, newAngsuran: 1, newTenor: 1, reason: 'r' });
    const otherPetTok = await login(app, s.petugasAUsername, s.password);
    // Same petugas user can cancel; we need a different non-admin user.
    const supDel = await request(app).delete(`/api/restructures/${propose.body.id}`)
      .set('Authorization', `Bearer ${supATok}`);
    expect(supDel.status).toBe(403);

    // Original proposer (petugas) can cancel.
    const ownDel = await request(app).delete(`/api/restructures/${propose.body.id}`)
      .set('Authorization', `Bearer ${otherPetTok}`);
    expect(ownDel.status).toBe(200);
  });

  it('cross-branch supervisor cannot decide', async () => {
    const branchBNas = await prisma.nasabah.findFirst({ where: { branchId: s.branchBId } });
    // Admin proposes for branch B
    const propose = await request(app).post('/api/restructures')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ nasabahId: branchBNas!.id, newSisa: 1, newAngsuran: 1, newTenor: 1, reason: 'r' });
    const r = await request(app).patch(`/api/restructures/${propose.body.id}/decision`)
      .set('Authorization', `Bearer ${supATok}`)
      .send({ decision: 'APPROVED' });
    expect([403, 404]).toContain(r.status);
  });

  // --- DM ---------------------------------------------------------------

  it('JANJI deadline reminder pushes notification to owning petugas user', async () => {
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    // JANJI 72h ago → deadline = now.
    await prisma.kunjungan.create({
      data: {
        nasabahId: target!.id, petugasId: target!.petugasId, branchId: target!.branchId,
        tanggal: new Date(Date.now() - 71 * 3600_000),
        jam: '10:00', hasil: 'JANJI', catatan: 'd', lokasi: 'x', valid: true,
      },
    });
    const out = await runJanjiReminderSweep({ force: true });
    expect(out.ok).toBe(true);
    expect(out.alerted).toBe(1);

    // Audit row dedups the per-petugas push.
    const audit = await prisma.auditLog.findFirst({ where: { action: 'janji.reminder_sent', target: target!.petugasId } });
    expect(audit).toBeTruthy();

    // Second sweep on the same day → no extra alert.
    const again = await runJanjiReminderSweep({ force: true });
    expect(again.alerted).toBe(0);
  });

  it('JANJI with follow-up kunjungan within window → no reminder', async () => {
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    const tanggal = new Date(Date.now() - 71 * 3600_000);
    await prisma.kunjungan.create({
      data: {
        nasabahId: target!.id, petugasId: target!.petugasId, branchId: target!.branchId,
        tanggal, jam: '10:00', hasil: 'JANJI', catatan: 'd', lokasi: 'x', valid: true,
      },
    });
    // follow-up kunjungan 1h after the JANJI.
    await prisma.kunjungan.create({
      data: {
        nasabahId: target!.id, petugasId: target!.petugasId, branchId: target!.branchId,
        tanggal: new Date(tanggal.getTime() + 60 * 60_000),
        jam: '11:00', hasil: 'BAYAR', catatan: 'd', lokasi: 'x', valid: true, nominal: 1000n,
      },
    });
    const out = await runJanjiReminderSweep({ force: true });
    expect(out.alerted).toBe(0);
  });
});
