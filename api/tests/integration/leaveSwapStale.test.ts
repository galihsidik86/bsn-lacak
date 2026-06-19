import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';
import { runLeaveAssignmentSweep } from '../../src/workers/leaveAssignmentWorker.js';
import { runStaleNasabahSweep } from '../../src/workers/staleNasabahWorker.js';

const d = hasDb ? describe : describe.skip;

d('leave auto-reassign (DG) + stale nasabah alert (DF)', () => {
  let s: SeedOut;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
  });

  // --- DG ---------------------------------------------------------------

  it('start-of-leave moves nasabah to substitute', async () => {
    await prisma.petugasLeave.create({
      data: {
        petugasId: s.petugasAId,
        substitutePetugasId: s.otherPetugasAId,
        startDate: new Date(Date.now() - 86400_000),
        endDate: new Date(Date.now() + 3 * 86400_000),
        type: 'cuti_tahunan', status: 'approved',
      },
    });
    const before = await prisma.nasabah.count({ where: { petugasId: s.petugasAId } });
    expect(before).toBeGreaterThan(0);

    const out = await runLeaveAssignmentSweep();
    expect(out.started).toBe(before);

    const after = await prisma.nasabah.count({ where: { petugasId: s.petugasAId } });
    expect(after).toBe(0);
    const subAfter = await prisma.nasabah.count({ where: { petugasId: s.otherPetugasAId } });
    expect(subAfter).toBeGreaterThanOrEqual(before);
  });

  it('idempotent — second sweep is a no-op while leave is active', async () => {
    await prisma.petugasLeave.create({
      data: {
        petugasId: s.petugasAId,
        substitutePetugasId: s.otherPetugasAId,
        startDate: new Date(Date.now() - 86400_000),
        endDate: new Date(Date.now() + 3 * 86400_000),
        type: 'cuti_tahunan', status: 'approved',
      },
    });
    await runLeaveAssignmentSweep();
    const second = await runLeaveAssignmentSweep();
    expect(second.started).toBe(0);
  });

  it('end-of-leave restores nasabah to original petugas', async () => {
    const leave = await prisma.petugasLeave.create({
      data: {
        petugasId: s.petugasAId,
        substitutePetugasId: s.otherPetugasAId,
        startDate: new Date(Date.now() - 3 * 86400_000),
        endDate: new Date(Date.now() + 86400_000), // still active for now
        type: 'cuti_tahunan', status: 'approved',
      },
    });
    const before = await prisma.nasabah.count({ where: { petugasId: s.petugasAId } });
    await runLeaveAssignmentSweep();
    // Make the leave end yesterday.
    await prisma.petugasLeave.update({
      where: { id: leave.id },
      data: { endDate: new Date(Date.now() - 86400_000) },
    });
    const end = await runLeaveAssignmentSweep();
    expect(end.restored).toBe(before);
    const after = await prisma.nasabah.count({ where: { petugasId: s.petugasAId } });
    expect(after).toBe(before);
  });

  it('no substitute → no swap', async () => {
    await prisma.petugasLeave.create({
      data: {
        petugasId: s.petugasAId,
        startDate: new Date(Date.now() - 86400_000),
        endDate: new Date(Date.now() + 86400_000),
        type: 'cuti_tahunan', status: 'approved',
      },
    });
    const out = await runLeaveAssignmentSweep();
    expect(out.started).toBe(0);
  });

  // --- DF ---------------------------------------------------------------

  it('stale sweep alerts petugas with N0001 unvisited > N days', async () => {
    // No kunjungan in DB → every nasabah is "stale". Sweep should fire
    // for each owning petugas (A + B exist via seed).
    const out = await runStaleNasabahSweep({ force: true });
    expect(out.ok).toBe(true);
    expect((out.alerted ?? 0)).toBeGreaterThan(0);
  });

  it('stale sweep skips nasabah visited recently', async () => {
    // Visit every nasabah today.
    const all = await prisma.nasabah.findMany({ select: { id: true, petugasId: true, branchId: true } });
    for (const n of all) {
      await prisma.kunjungan.create({
        data: {
          nasabahId: n.id, petugasId: n.petugasId, branchId: n.branchId,
          hasil: 'BAYAR', nominal: 0n, catatan: '', lokasi: '',
          jam: '10:00', tanggal: new Date(),
        },
      });
    }
    const out = await runStaleNasabahSweep({ force: true });
    expect(out.alerted).toBe(0);
  });

  it('stale sweep skips petugas on approved leave today', async () => {
    // Put every petugas on leave today so none should be alerted.
    for (const petId of [s.petugasAId, s.otherPetugasAId, s.petugasBId]) {
      await prisma.petugasLeave.create({
        data: {
          petugasId: petId,
          startDate: new Date(Date.now() - 86400_000),
          endDate: new Date(Date.now() + 86400_000),
          type: 'sakit', status: 'approved',
        },
      });
    }
    const out = await runStaleNasabahSweep({ force: true });
    expect(out.alerted).toBe(0);
  });
});
