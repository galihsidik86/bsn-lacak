import { prisma } from '../db.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { audit } from '../lib/audit.js';
import { enqueueNotification } from '../routes/notifications.js';
import { pushToUsers } from '../lib/webPush.js';

// Real-time inactivity sweep — beda dari inactivityWorker (yang scan
// kunjungan harian). Worker ini cek tiap N menit: petugas yang
// CURRENTLY clocked-in tapi last GPS ping > threshold = mungkin tab
// background / GPS off / device mati.
//
// Dedup: audit row `petugas.live_inactivity_alerted` target =
// attendance.id (per session). Petugas dapat 1 alert per sesi; reset
// otomatis di sesi berikutnya karena attendance.id berubah.

const ACTION = 'petugas.live_inactivity_alerted';

let timer: NodeJS.Timeout | null = null;

export async function runLiveInactivitySweep(opts?: { now?: Date }):
  Promise<{ ok: boolean; checked: number; alerted: number }>
{
  const now = opts?.now ?? new Date();
  const thresholdMs = env.LIVE_INACTIVITY_THRESHOLD_MIN * 60_000;
  const cutoff = new Date(now.getTime() - thresholdMs);

  // Sesi aktif: clock-out null, clock-in > thresholdMs lalu (kalau baru
  // clock-in <thresholdMs, tidak perlu cek — belum ada ekspektasi ping).
  const sessions = await prisma.attendance.findMany({
    where: { clockOutAt: null, clockInAt: { lte: cutoff } },
    select: {
      id: true, branchId: true, clockInAt: true, petugasId: true,
      petugas: { select: { id: true, kode: true, nama: true } },
    },
  });
  if (sessions.length === 0) return { ok: true, checked: 0, alerted: 0 };

  // Sudah dialerted di sesi ini? Skip.
  const alreadyAlerted = new Set(
    (await prisma.auditLog.findMany({
      where: { action: ACTION, target: { in: sessions.map(s => s.id) } },
      select: { target: true },
    })).map(r => r.target!).filter(Boolean),
  );

  // Group target sessions by branch supaya supervisor 1 cabang dapat
  // 1 notif batch kalau ada banyak petugas inactive sekaligus.
  type Inactive = typeof sessions[number] & { lastPingMs: number | null };
  const inactivePerBranch = new Map<string, Inactive[]>();

  for (const s of sessions) {
    if (alreadyAlerted.has(s.id)) continue;
    const lastPing = await prisma.petugasPosition.findFirst({
      where: { petugasId: s.petugasId },
      orderBy: { recordedAt: 'desc' },
      select: { recordedAt: true },
    });
    const lastMs = lastPing?.recordedAt.getTime() ?? null;
    // Inactive kalau: belum pernah ping setelah clock-in, ATAU last
    // ping > threshold lalu.
    const isInactive = !lastMs || lastMs < now.getTime() - thresholdMs;
    if (!isInactive) continue;
    const arr = inactivePerBranch.get(s.branchId) ?? [];
    arr.push({ ...s, lastPingMs: lastMs });
    inactivePerBranch.set(s.branchId, arr);
  }

  let alerted = 0;
  for (const [branchId, batch] of inactivePerBranch) {
    const supervisors = await prisma.user.findMany({
      where: { role: 'SUPERVISOR', branchId, active: true },
      select: { id: true },
    });
    const userIds = supervisors.map(u => u.id);

    for (const inactive of batch) {
      const ageMin = inactive.lastPingMs
        ? Math.round((now.getTime() - inactive.lastPingMs) / 60_000)
        : Math.round((now.getTime() - inactive.clockInAt.getTime()) / 60_000);
      const title = `Petugas tidak aktif > ${env.LIVE_INACTIVITY_THRESHOLD_MIN} mnt`;
      const body = inactive.lastPingMs
        ? `${inactive.petugas.nama} (${inactive.petugas.kode}) terakhir ping ${ageMin} menit lalu — kemungkinan tab background / GPS off.`
        : `${inactive.petugas.nama} (${inactive.petugas.kode}) clock-in ${ageMin} menit lalu tapi belum ada ping GPS sama sekali.`;

      if (userIds.length > 0) {
        await enqueueNotification({
          userIds, type: 'petugas.live_inactivity',
          title, body, severity: 'WARN', link: 'tracking',
        }).catch(() => undefined);
        void pushToUsers(userIds, {
          title, body, link: '/#tracking', tag: `live-inact-${inactive.id}`,
        });
      }

      await audit({
        action: ACTION, target: inactive.id,
        actor: null, actorId: null, ip: null, userAgent: null,
        meta: { petugasId: inactive.petugasId, ageMin, branchId },
      });
      alerted++;
    }
  }

  logger.info({ checked: sessions.length, alerted }, 'live_inactivity_sweep_completed');
  return { ok: true, checked: sessions.length, alerted };
}

export function startLiveInactivityWorker(): void {
  if (env.NODE_ENV === 'test') return;
  if (timer) return;
  const everyMs = env.LIVE_INACTIVITY_CHECK_INTERVAL_MIN * 60_000;
  logger.info(
    { thresholdMin: env.LIVE_INACTIVITY_THRESHOLD_MIN, everyMin: env.LIVE_INACTIVITY_CHECK_INTERVAL_MIN },
    'live_inactivity_worker_started',
  );
  timer = setTimeout(function loop() {
    runLiveInactivitySweep().catch(e =>
      logger.warn({ err: String(e) }, 'live_inactivity_sweep_failed'));
    timer = setTimeout(loop, everyMs);
  }, 60_000); // delay 60s setelah boot supaya seluruh stack ready
}

export function stopLiveInactivityWorker(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
