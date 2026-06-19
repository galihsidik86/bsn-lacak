import { prisma } from '../db.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { audit } from '../lib/audit.js';
import { emailGateway } from '../lib/emailGateway.js';

// CN — petugas weekly digest. Once a week (default Monday at 06:00 local),
// each active petugas with an email on file receives a 7-day rollup of
// their kunjungan + collected total. Skips the user when there's nothing
// to report (zero visits AND zero collected) so we don't inbox-noise.

const ACTION = 'weekly_digest.sent';

let timer: NodeJS.Timeout | null = null;

function isoWeekKey(d: Date): string {
  // ISO week (Monday-anchored). Year-week of the *Monday* of the current
  // week so a digest fired on Mon→ Sat all share the same dedup key.
  const tmp = new Date(d);
  tmp.setHours(0, 0, 0, 0);
  // Shift Monday=1 .. Sunday=7
  const dow = (tmp.getDay() + 6) % 7;
  tmp.setDate(tmp.getDate() - dow);
  return `${tmp.getFullYear()}-W${String(getISOWeekNumber(tmp)).padStart(2, '0')}`;
}

function getISOWeekNumber(d: Date): number {
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  }
  return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
}

async function alreadySent(weekKey: string): Promise<boolean> {
  const row = await prisma.auditLog.findFirst({
    where: { action: ACTION, meta: { path: ['week'], equals: weekKey } },
    select: { id: true },
  });
  return !!row;
}

export async function runWeeklyDigestSweep(opts?: { now?: Date; force?: boolean }):
  Promise<{ ok: boolean; reason?: string; sent?: number; week?: string }>
{
  const now = opts?.now ?? new Date();
  const force = opts?.force ?? false;
  const week = isoWeekKey(now);

  if (!force) {
    if (!env.WEEKLY_DIGEST_ENABLED) return { ok: false, reason: 'disabled' };
    // Mon = 1 .. Sun = 0; default day-of-week = 1 (Monday).
    if (now.getDay() !== env.WEEKLY_DIGEST_DAY_OF_WEEK) return { ok: false, reason: 'not_day' };
    if (now.getHours() !== env.WEEKLY_DIGEST_HOUR) return { ok: false, reason: 'not_hour' };
    if (await alreadySent(week)) return { ok: false, reason: 'already_sent', week };
  }

  const users = await prisma.user.findMany({
    where: { role: 'PETUGAS', active: true, email: { not: null }, petugasId: { not: null } },
    select: { id: true, email: true, nama: true, petugasId: true },
  });
  if (users.length === 0) return { ok: false, reason: 'no_recipients', week };

  const since = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
  const petugasIds = users.map(u => u.petugasId!).filter(Boolean);

  // Two cheap aggregations — visits per petugas and collected per
  // petugas — both joined back at the application layer.
  const [visitsByPetugas, paymentsByPetugas] = await Promise.all([
    prisma.kunjungan.groupBy({
      by: ['petugasId'],
      where: { petugasId: { in: petugasIds }, tanggal: { gte: since } },
      _count: { _all: true },
    }),
    prisma.pembayaran.groupBy({
      by: ['nasabahId'],
      where: { status: 'berhasil', tanggal: { gte: since } },
      _sum: { nominal: true },
    }),
  ]);
  // Petugas don't own pembayaran directly — they own nasabah. Join via the
  // nasabah table so the digest credits the right person.
  const nasabahPet = await prisma.nasabah.findMany({
    where: { petugasId: { in: petugasIds } },
    select: { id: true, petugasId: true },
  });
  const petByNasabah = new Map(nasabahPet.map(n => [n.id, n.petugasId]));
  const collectedByPet = new Map<string, number>();
  for (const p of paymentsByPetugas) {
    const pet = petByNasabah.get(p.nasabahId);
    if (!pet) continue;
    const sum = Number(p._sum.nominal ?? 0n);
    collectedByPet.set(pet, (collectedByPet.get(pet) ?? 0) + sum);
  }
  const visitsByPet = new Map(visitsByPetugas.map(v => [v.petugasId, v._count._all]));

  let sent = 0;
  for (const u of users) {
    const visits = visitsByPet.get(u.petugasId!) ?? 0;
    const collected = collectedByPet.get(u.petugasId!) ?? 0;
    if (visits === 0 && collected === 0) continue;
    const subject = `BSN Lacak — Rekap mingguan ${week}`;
    const text = [
      `Halo ${u.nama},`,
      '',
      `Rekap aktivitas Anda 7 hari terakhir:`,
      `• Kunjungan: ${visits}`,
      `• Total tertagih (sukses): Rp ${collected.toLocaleString('id-ID')}`,
      '',
      `Selamat memulai minggu — semoga lancar penagihannya 👋`,
      '',
      '— Sistem BSN Lacak',
    ].join('\n');
    const r = await emailGateway.send({ to: u.email!, subject, text }).catch(() => ({ ok: false }));
    if (r.ok) sent++;
  }

  await audit({ action: ACTION, meta: { week, sent, recipients: users.length } });
  logger.info({ week, sent, recipients: users.length }, 'weekly_digest_sent');
  return { ok: true, week, sent };
}

export function startWeeklyDigestWorker(): void {
  if (env.NODE_ENV === 'test') return;
  if (!env.WEEKLY_DIGEST_ENABLED) return;
  if (timer) return;
  logger.info({
    day: env.WEEKLY_DIGEST_DAY_OF_WEEK, hour: env.WEEKLY_DIGEST_HOUR,
  }, 'weekly_digest_worker_started');
  timer = setTimeout(function loop() {
    runWeeklyDigestSweep().catch(e =>
      logger.warn({ err: String(e) }, 'weekly_digest_sweep_failed'));
    timer = setTimeout(loop, 60 * 60 * 1000); // hourly
  }, 60 * 1000);
}

export function stopWeeklyDigestWorker(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
