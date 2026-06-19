import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';
import { runEscalationSweep } from '../../src/workers/escalationWorker.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('escalation (CK) + nasabah timeline (CL)', () => {
  const app = buildApp();
  let s: SeedOut;
  let adminTok: string;
  let supTok: string;
  let petTok: string;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
    adminTok = await login(app, s.adminUsername, s.password);
    supTok = await login(app, s.supervisorAUsername, s.password);
    petTok = await login(app, s.petugasAUsername, s.password);
  });

  // --- CK ---------------------------------------------------------------

  it('K5 nasabah without payment in 7d opens a critical ticket', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    await prisma.nasabah.update({ where: { id: n!.id }, data: { kol: 'K5' } });
    const r = await runEscalationSweep();
    expect(r.opened).toBeGreaterThanOrEqual(1);
    const ticket = await prisma.escalationTicket.findFirst({ where: { nasabahId: n!.id } });
    expect(ticket?.severity).toBe('critical');
    expect(ticket?.status).toBe('open');
  });

  it('sweep is idempotent — second pass opens no new tickets', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    await prisma.nasabah.update({ where: { id: n!.id }, data: { kol: 'K5' } });
    await runEscalationSweep();
    const r = await runEscalationSweep();
    expect(r.opened).toBe(0);
  });

  it('K3 with recent payment is NOT escalated', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    await prisma.nasabah.update({ where: { id: n!.id }, data: { kol: 'K3' } });
    await prisma.pembayaran.create({
      data: {
        nasabahId: n!.id, branchId: s.branchAId,
        nominal: 100_000n, metode: 'tunai', status: 'berhasil',
        jam: '10:00', tanggal: new Date(),
      },
    });
    const r = await runEscalationSweep();
    const ticket = await prisma.escalationTicket.findFirst({ where: { nasabahId: n!.id } });
    expect(ticket).toBeNull();
    expect(r.opened).toBe(0);
  });

  it('GET /escalation lists open tickets; SUPERVISOR scope works', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    await prisma.escalationTicket.create({
      data: {
        nasabahId: n!.id, branchId: s.branchAId,
        severity: 'critical', reason: 'manual', status: 'open',
      },
    });
    const nb = await prisma.nasabah.findFirst({ where: { kode: 'N0004' } });
    await prisma.escalationTicket.create({
      data: {
        nasabahId: nb!.id, branchId: s.branchBId,
        severity: 'high', reason: 'manual', status: 'open',
      },
    });
    const r = await request(app).get('/api/escalation')
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.status).toBe(200);
    expect(r.body.length).toBe(1);
    expect(r.body[0].nasabah.kode).toBe('N0001');
  });

  it('PATCH /escalation/:id can resolve with note', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const t = await prisma.escalationTicket.create({
      data: {
        nasabahId: n!.id, branchId: s.branchAId,
        severity: 'medium', reason: 'manual', status: 'open',
      },
    });
    const r = await request(app).patch(`/api/escalation/${t.id}`)
      .set('Authorization', `Bearer ${supTok}`)
      .send({ status: 'resolved', note: 'sudah ditelepon, janji bayar minggu depan' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('resolved');
    expect(r.body.resolvedAt).not.toBeNull();
  });

  it('PETUGAS forbidden on escalation', async () => {
    const r = await request(app).get('/api/escalation')
      .set('Authorization', `Bearer ${petTok}`);
    expect(r.status).toBe(403);
  });

  it('summary chip counts open + in_progress by severity', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    await prisma.escalationTicket.createMany({
      data: [
        { nasabahId: n!.id, branchId: s.branchAId, severity: 'critical', reason: 'a', status: 'open' },
        { nasabahId: n!.id, branchId: s.branchAId, severity: 'critical', reason: 'b', status: 'in_progress' },
        { nasabahId: n!.id, branchId: s.branchAId, severity: 'medium', reason: 'c', status: 'resolved' },
      ],
    });
    const r = await request(app).get('/api/escalation/summary')
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.body.critical).toBe(2);
    expect(r.body.medium).toBe(0); // resolved excluded
  });

  // --- CL ---------------------------------------------------------------

  it('timeline merges kunjungan + pembayaran into one sorted stream', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const now = new Date();
    const yesterday = new Date(now.getTime() - 86400_000);
    await prisma.kunjungan.create({
      data: {
        nasabahId: n!.id, petugasId: s.petugasAId, branchId: s.branchAId,
        hasil: 'BAYAR', nominal: 0n, catatan: 'visit', lokasi: 'a',
        jam: '10:00', tanggal: yesterday, reviewStatus: 'APPROVED',
      },
    });
    await prisma.pembayaran.create({
      data: {
        nasabahId: n!.id, branchId: s.branchAId,
        nominal: 100_000n, metode: 'tunai', status: 'berhasil',
        jam: '10:00', tanggal: now,
      },
    });

    const r = await request(app).get(`/api/nasabah/${n!.id}/timeline`)
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBe(2);
    // Newest first.
    expect(r.body.items[0].type).toBe('pembayaran');
    expect(r.body.items[1].type).toBe('kunjungan');
  });

  it('timeline cross-branch SUPERVISOR → 404', async () => {
    const branchB = await prisma.nasabah.findFirst({ where: { kode: 'N0004' } });
    const r = await request(app).get(`/api/nasabah/${branchB!.id}/timeline`)
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.status).toBe(404);
  });
});
