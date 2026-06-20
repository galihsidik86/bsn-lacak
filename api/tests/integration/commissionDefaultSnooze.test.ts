import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';
import { runStaleNasabahSweep } from '../../src/workers/staleNasabahWorker.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('branch commission default (DP) + nasabah snooze (DQ)', () => {
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

  // --- DP ---------------------------------------------------------------

  it('petugas create without commissionBps falls back to branch default', async () => {
    await prisma.branch.update({
      where: { id: s.branchAId }, data: { defaultCommissionBps: 300 },
    });
    const r = await request(app).post('/api/petugas')
      .set('Authorization', `Bearer ${supATok}`)
      .send({
        kode: 'PNEW', nama: 'P New', inisial: 'PN',
        wilayah: 'W', hp: '0812345', branchId: s.branchAId,
      });
    expect(r.status).toBe(201);
    expect(r.body.commissionBps).toBe(300);
  });

  it('petugas create explicit commissionBps wins over branch default', async () => {
    await prisma.branch.update({
      where: { id: s.branchAId }, data: { defaultCommissionBps: 300 },
    });
    const r = await request(app).post('/api/petugas')
      .set('Authorization', `Bearer ${supATok}`)
      .send({
        kode: 'PNEW2', nama: 'P New 2', inisial: 'P2',
        wilayah: 'W', hp: '0812345', branchId: s.branchAId,
        commissionBps: 75,
      });
    expect(r.status).toBe(201);
    expect(r.body.commissionBps).toBe(75);
  });

  it('petugas create with no branch default falls back to system 150', async () => {
    const r = await request(app).post('/api/petugas')
      .set('Authorization', `Bearer ${supATok}`)
      .send({
        kode: 'PNEW3', nama: 'P New 3', inisial: 'P3',
        wilayah: 'W', hp: '0812345', branchId: s.branchAId,
      });
    expect(r.status).toBe(201);
    expect(r.body.commissionBps).toBe(150);
  });

  it('ADMIN can patch defaultCommissionBps via branch endpoint', async () => {
    const r = await request(app).patch(`/api/branches/${s.branchAId}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({
        nama: 'Test Cabang A', kode: 'TST001',
        defaultCommissionBps: 250,
      });
    expect(r.status).toBe(200);
    expect(r.body.defaultCommissionBps).toBe(250);
  });

  // --- DQ ---------------------------------------------------------------

  it('SUPERVISOR snoozes nasabah with reason; list filter shows it', async () => {
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    const until = new Date(Date.now() + 5 * 86400_000);
    const r = await request(app).patch(`/api/nasabah/${target!.id}/snooze`)
      .set('Authorization', `Bearer ${supATok}`)
      .send({ snoozedUntil: until.toISOString(), reason: 'libur idul fitri' });
    expect(r.status).toBe(200);
    expect(new Date(r.body.snoozedUntil).getTime()).toBe(until.getTime());
    expect(r.body.snoozeReason).toBe('libur idul fitri');

    const filtered = await request(app).get('/api/nasabah?snoozedOnly=1')
      .set('Authorization', `Bearer ${supATok}`);
    expect(filtered.body.length).toBe(1);
    expect(filtered.body[0].id).toBe(target!.id);
  });

  it('past snooze date rejected', async () => {
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    const r = await request(app).patch(`/api/nasabah/${target!.id}/snooze`)
      .set('Authorization', `Bearer ${supATok}`)
      .send({ snoozedUntil: new Date(Date.now() - 86400_000).toISOString(), reason: 'r' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('snooze_must_be_future');
  });

  it('reason required when setting; cleared on snoozedUntil=null', async () => {
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    const noReason = await request(app).patch(`/api/nasabah/${target!.id}/snooze`)
      .set('Authorization', `Bearer ${supATok}`)
      .send({ snoozedUntil: new Date(Date.now() + 86400_000).toISOString() });
    expect(noReason.status).toBe(400);

    await request(app).patch(`/api/nasabah/${target!.id}/snooze`)
      .set('Authorization', `Bearer ${supATok}`)
      .send({ snoozedUntil: new Date(Date.now() + 86400_000).toISOString(), reason: 'r' });

    const clear = await request(app).patch(`/api/nasabah/${target!.id}/snooze`)
      .set('Authorization', `Bearer ${supATok}`)
      .send({ snoozedUntil: null });
    expect(clear.status).toBe(200);
    expect(clear.body.snoozedUntil).toBeNull();
    expect(clear.body.snoozeReason).toBeNull();
  });

  it('PETUGAS forbidden to snooze', async () => {
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    const r = await request(app).patch(`/api/nasabah/${target!.id}/snooze`)
      .set('Authorization', `Bearer ${petTok}`)
      .send({ snoozedUntil: new Date(Date.now() + 86400_000).toISOString(), reason: 'r' });
    expect(r.status).toBe(403);
  });

  it('stale-nasabah sweep skips snoozed', async () => {
    // Snooze all of petugas A's nasabah.
    await prisma.nasabah.updateMany({
      where: { petugasId: s.petugasAId },
      data: {
        snoozedUntil: new Date(Date.now() + 3 * 86400_000),
        snoozeReason: 'libur',
      },
    });
    // Give petugas A an email so they're an eligible alert target.
    await prisma.user.update({ where: { id: s.petugasUserAId }, data: { email: 'p@x.io' } });
    const out = await runStaleNasabahSweep({ force: true });
    expect(out.alerted).toBe(0);
  });

  it('due-soon excludes snoozed nasabah', async () => {
    const tomorrow = new Date(Date.now() + 86400_000);
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    // Make it due soon AND snoozed.
    await prisma.nasabah.update({
      where: { id: target!.id },
      data: {
        nextVisitAt: tomorrow,
        snoozedUntil: new Date(Date.now() + 7 * 86400_000),
        snoozeReason: 'libur',
      },
    });
    const r = await request(app).get('/api/nasabah/due-soon?days=14')
      .set('Authorization', `Bearer ${supATok}`);
    expect(r.body.rows.find((row: any) => row.id === target!.id)).toBeUndefined();
  });
});
