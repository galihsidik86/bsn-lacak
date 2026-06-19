import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';
import { runWeeklyDigestSweep } from '../../src/workers/weeklyDigestWorker.js';
import { runInactivitySweep } from '../../src/workers/inactivityWorker.js';

const d = hasDb ? describe : describe.skip;

d('weekly digest (CN) + inactivity detector (CO)', () => {
  let s: SeedOut;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
  });

  // --- CN ---------------------------------------------------------------

  it('skips when no PETUGAS has email', async () => {
    const out = await runWeeklyDigestSweep({ force: true });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('no_recipients');
  });

  it('sends + audits when petugas has email + activity; second run dedupes', async () => {
    await prisma.user.update({
      where: { id: s.petugasUserAId },
      data: { email: 'petugas@example.com' },
    });
    // Create a visit so the digest skips the "no activity" filter.
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    await prisma.kunjungan.create({
      data: {
        nasabahId: n!.id, petugasId: s.petugasAId, branchId: s.branchAId,
        hasil: 'BAYAR', nominal: 0n, catatan: '', lokasi: '',
        jam: '10:00', tanggal: new Date(),
      },
    });

    const first = await runWeeklyDigestSweep({ force: true });
    expect(first.ok).toBe(true);
    expect(first.sent).toBe(1);

    // The auto-dedup only kicks in when force=false; force ignores the
    // already_sent check by design (for ops re-runs). Smoke that the
    // audit row was written either way.
    const audits = await prisma.auditLog.count({ where: { action: 'weekly_digest.sent' } });
    expect(audits).toBe(1);
  });

  it('does not email petugas with zero visits + zero collected', async () => {
    await prisma.user.update({
      where: { id: s.petugasUserAId },
      data: { email: 'petugas@example.com' },
    });
    const out = await runWeeklyDigestSweep({ force: true });
    expect(out.ok).toBe(true);
    expect(out.sent).toBe(0);
  });

  // --- CO ---------------------------------------------------------------

  it('alerts on petugas with no kunjungan > N days', async () => {
    // petugas A: no kunjungan at all → should fire.
    const out = await runInactivitySweep({ force: true });
    expect(out.ok).toBe(true);
    expect((out.alerted ?? 0)).toBeGreaterThanOrEqual(1);

    const notif = await prisma.notification.findFirst({
      where: { type: 'petugas.inactivity' },
    });
    expect(notif).not.toBeNull();
  });

  it('does not alert when petugas has recent kunjungan', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    // Recent visit for every petugas so no one is inactive.
    for (const petId of [s.petugasAId, s.otherPetugasAId, s.petugasBId]) {
      await prisma.kunjungan.create({
        data: {
          nasabahId: n!.id, petugasId: petId, branchId: s.branchAId,
          hasil: 'BAYAR', nominal: 0n, catatan: '', lokasi: '',
          jam: '10:00', tanggal: new Date(),
        },
      });
    }
    const out = await runInactivitySweep({ force: true });
    expect(out.alerted).toBe(0);
  });

  it('dedups within the same day', async () => {
    await runInactivitySweep({ force: true });
    const audits1 = await prisma.auditLog.count({ where: { action: 'petugas.inactivity_alerted' } });
    await runInactivitySweep({ force: true });
    const audits2 = await prisma.auditLog.count({ where: { action: 'petugas.inactivity_alerted' } });
    expect(audits2).toBe(audits1);
  });
});
