import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';
import { __sweepForTests } from '../../src/workers/slaWorker.js';

const d = hasDb ? describe : describe.skip;

d('SLA worker', () => {
  buildApp();
  let s: SeedOut;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
  });

  async function makePending(daysAgo: number) {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    return prisma.kunjungan.create({
      data: {
        nasabahId: n!.id, petugasId: s.petugasAId, branchId: s.branchAId,
        hasil: 'BAYAR', nominal: 0n, catatan: 'x', lokasi: 'x',
        jam: '10:00',
        tanggal: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
        reviewStatus: 'PENDING', riskScore: 5, riskFlags: ['gps_far'],
      },
    });
  }

  it('alerts supervisor + stamps slaAlertedAt on old PENDING kunjungan', async () => {
    const k = await makePending(2);
    await __sweepForTests();

    const after = await prisma.kunjungan.findUnique({ where: { id: k.id } });
    expect(after!.slaAlertedAt).not.toBeNull();

    const notif = await prisma.notification.findFirst({
      where: { userId: s.supervisorAId, type: 'sla.pending_breach' },
    });
    expect(notif).not.toBeNull();
  });

  it('does not re-alert kunjungan that already has slaAlertedAt set', async () => {
    const k = await makePending(2);
    await prisma.kunjungan.update({ where: { id: k.id }, data: { slaAlertedAt: new Date() } });
    await __sweepForTests();
    const count = await prisma.notification.count({
      where: { userId: s.supervisorAId, type: 'sla.pending_breach' },
    });
    expect(count).toBe(0);
  });

  it('ignores fresh PENDING within SLA window', async () => {
    await makePending(0);   // today
    await __sweepForTests();
    const count = await prisma.notification.count({ where: { type: 'sla.pending_breach' } });
    expect(count).toBe(0);
  });
});
