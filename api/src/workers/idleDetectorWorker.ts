import { prisma } from '../db.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { audit } from '../lib/audit.js';
import { enqueueNotification } from '../routes/notifications.js';

// DS — idle / standby penalty detector. Two triggers, evaluated per
// active petugas:
//
//   (a) tidak ada kunjungan selama IDLE_KANTOR_DAYS hari berturut-turut
//       sampai dengan kemarin. "Tidak ada kunjungan" = 0 kunjungan.
//   (b) ratio TIDAKADA / total kunjungan dalam 14 hari > IDLE_TIDAKADA_RATIO_PCT
//       AND total kunjungan ≥ 4 (biar tidak men-flag petugas baru
//       dengan sample size mini).
//
// Per-petugas dedup harian via audit row, jadi re-run di hari yang sama
// no-op. Notifikasi ke supervisor cabang petugas (semua user role
// SUPERVISOR di branch tersebut).

const ACTION = 'idle.alert_sent';
const TIDAKADA_WINDOW_DAYS = 14;
const MIN_SAMPLE = 4;

let timer: NodeJS.Timeout | null = null;

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function runIdleDetectorSweep(opts?: { now?: Date; force?: boolean }):
  Promise<{ ok: boolean; reason?: string; alerted?: number; day?: string }>
{
  const now = opts?.now ?? new Date();
  const force = opts?.force ?? false;
  const day = dateKey(now);

  if (!force && now.getHours() !== env.IDLE_DETECTOR_HOUR) {
    return { ok: false, reason: 'not_hour' };
  }

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const idleCutoff = new Date(startOfToday.getTime() - env.IDLE_KANTOR_DAYS * 86400_000);
  const windowStart = new Date(startOfToday.getTime() - TIDAKADA_WINDOW_DAYS * 86400_000);

  const petugasList = await prisma.petugas.findMany({
    where: { active: true },
    select: { id: true, kode: true, nama: true, branchId: true },
  });
  if (petugasList.length === 0) return { ok: true, alerted: 0, day };

  // Pull recent kunjungan only once.
  const ids = petugasList.map(p => p.id);
  const recent = await prisma.kunjungan.findMany({
    where: { petugasId: { in: ids }, tanggal: { gte: windowStart } },
    select: { petugasId: true, tanggal: true, hasil: true },
  });
  const byPet = new Map<string, Array<{ tanggal: Date; hasil: string }>>();
  for (const r of recent) {
    const arr = byPet.get(r.petugasId) ?? [];
    arr.push(r);
    byPet.set(r.petugasId, arr);
  }

  const flagged: Array<{ petugas: typeof petugasList[number]; reason: string; sample: string }> = [];
  for (const p of petugasList) {
    const rows = byPet.get(p.id) ?? [];
    const inIdleWindow = rows.filter(r => r.tanggal >= idleCutoff);
    if (inIdleWindow.length === 0) {
      flagged.push({
        petugas: p,
        reason: 'no_visits',
        sample: `Tidak ada kunjungan ${env.IDLE_KANTOR_DAYS} hari terakhir`,
      });
      continue;
    }
    if (rows.length >= MIN_SAMPLE) {
      const tidakada = rows.filter(r => r.hasil === 'TIDAKADA').length;
      const pct = Math.round((tidakada / rows.length) * 100);
      if (pct > env.IDLE_TIDAKADA_RATIO_PCT) {
        flagged.push({
          petugas: p,
          reason: 'tidakada_high',
          sample: `${pct}% TIDAKADA dari ${rows.length} kunjungan (14h)`,
        });
      }
    }
  }
  if (flagged.length === 0) return { ok: true, alerted: 0, day };

  // Dedup against earlier alerts today.
  const recentAudit = await prisma.auditLog.findMany({
    where: {
      action: ACTION,
      createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) },
    },
    select: { target: true },
  });
  const already = new Set(recentAudit.map(r => r.target!).filter(Boolean));

  // Group flagged petugas per branch so we can fan-out to supervisor users.
  const perBranch = new Map<string, typeof flagged>();
  for (const f of flagged) {
    if (already.has(f.petugas.id)) continue;
    const arr = perBranch.get(f.petugas.branchId) ?? [];
    arr.push(f);
    perBranch.set(f.petugas.branchId, arr);
  }
  if (perBranch.size === 0) return { ok: true, alerted: 0, day };

  let alerted = 0;
  for (const [branchId, rows] of perBranch) {
    const supervisors = await prisma.user.findMany({
      where: { role: 'SUPERVISOR', branchId, active: true },
      select: { id: true },
    });
    if (supervisors.length === 0) continue;
    const userIds = supervisors.map(u => u.id);

    const sample = rows.slice(0, 5).map(r => `${r.petugas.kode} (${r.sample})`).join('; ');
    const title = rows.length === 1
      ? `Petugas idle: ${rows[0].petugas.kode}`
      : `${rows.length} petugas idle hari ini`;
    const body = rows.length === 1
      ? `${rows[0].petugas.nama} (${rows[0].petugas.kode}) — ${rows[0].sample}.`
      : `${sample}${rows.length > 5 ? '…' : ''}.`;

    await enqueueNotification({
      userIds, type: 'petugas.idle',
      title, body, severity: 'WARN', link: 'performa',
    }).catch(() => undefined);

    for (const f of rows) {
      await audit({ action: ACTION, target: f.petugas.id, meta: { day, reason: f.reason } });
      alerted++;
    }
  }

  if (alerted > 0) logger.info({ alerted, day }, 'idle_detector_sweep_completed');
  return { ok: true, day, alerted };
}

export function startIdleDetectorWorker(): void {
  if (env.NODE_ENV === 'test') return;
  if (timer) return;
  logger.info({ hour: env.IDLE_DETECTOR_HOUR, days: env.IDLE_KANTOR_DAYS, ratio: env.IDLE_TIDAKADA_RATIO_PCT },
    'idle_detector_worker_started');
  timer = setTimeout(function loop() {
    runIdleDetectorSweep().catch(e =>
      logger.warn({ err: String(e) }, 'idle_detector_sweep_failed'));
    timer = setTimeout(loop, 60 * 60 * 1000);
  }, 100 * 1000);
}

export function stopIdleDetectorWorker(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
