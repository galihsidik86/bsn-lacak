import { prisma } from '../db.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { audit } from '../lib/audit.js';

// DG — auto-reassign on cuti. Two transitions:
//
//   start  : leave.status='approved' AND startDate ≤ now() AND endDate ≥ now()
//            AND substitutePetugasId IS NOT NULL AND reassigned=false
//            → move every nasabah of `petugasId` to `substitutePetugasId`,
//              audit `leave.assignment_start` per nasabah with the original,
//              flip reassigned=true.
//
//   end    : leave.reassigned=true AND endDate < now()
//            → for each nasabah currently pointing at the substitute that
//              originally belonged to `petugasId` (per audit log), restore
//              to the original, audit `leave.assignment_end`, flip
//              reassigned=false.
//
// Branch follows the petugas owner so a cross-branch substitute is allowed
// for ADMIN-created leaves (rare but legal).

let timer: NodeJS.Timeout | null = null;

async function applyStarts(now: Date): Promise<number> {
  const starts = await prisma.petugasLeave.findMany({
    where: {
      status: 'approved',
      reassigned: false,
      startDate: { lte: now },
      endDate: { gte: now },
      substitutePetugasId: { not: null },
    },
    select: { id: true, petugasId: true, substitutePetugasId: true },
  });
  if (starts.length === 0) return 0;
  let count = 0;
  for (const l of starts) {
    const subId = l.substitutePetugasId!;
    const sub = await prisma.petugas.findUnique({ where: { id: subId } });
    if (!sub) continue;
    const nasabah = await prisma.nasabah.findMany({
      where: { petugasId: l.petugasId, active: true },
      select: { id: true },
    });
    if (nasabah.length === 0) {
      await prisma.petugasLeave.update({ where: { id: l.id }, data: { reassigned: true } });
      continue;
    }
    await prisma.nasabah.updateMany({
      where: { id: { in: nasabah.map(n => n.id) } },
      data: { petugasId: sub.id, branchId: sub.branchId },
    });
    await prisma.petugasLeave.update({ where: { id: l.id }, data: { reassigned: true } });
    // One audit row per nasabah so the restore step can read it back
    // without storing the mapping anywhere else.
    for (const n of nasabah) {
      await audit({
        action: 'leave.assignment_start', target: n.id,
        meta: { leaveId: l.id, originalPetugasId: l.petugasId, substitutePetugasId: sub.id },
      });
      count++;
    }
    logger.info({ leaveId: l.id, count: nasabah.length }, 'leave_assignment_start');
  }
  return count;
}

async function applyEnds(now: Date): Promise<number> {
  const ends = await prisma.petugasLeave.findMany({
    where: {
      reassigned: true,
      endDate: { lt: now },
    },
    select: { id: true, petugasId: true, substitutePetugasId: true },
  });
  if (ends.length === 0) return 0;
  let restored = 0;
  for (const l of ends) {
    // Pull the audit log entries we wrote at start; that's the source of
    // truth for which nasabah were swapped.
    const events = await prisma.auditLog.findMany({
      where: {
        action: 'leave.assignment_start',
        meta: { path: ['leaveId'], equals: l.id },
      },
      select: { target: true, meta: true },
    });
    if (events.length > 0) {
      const original = await prisma.petugas.findUnique({ where: { id: l.petugasId } });
      if (original) {
        await prisma.nasabah.updateMany({
          where: { id: { in: events.map(e => e.target!).filter(Boolean) } },
          data: { petugasId: l.petugasId, branchId: original.branchId },
        });
        for (const e of events) {
          await audit({
            action: 'leave.assignment_end', target: e.target!,
            meta: { leaveId: l.id, restoredTo: l.petugasId },
          });
          restored++;
        }
      }
    }
    await prisma.petugasLeave.update({ where: { id: l.id }, data: { reassigned: false } });
    logger.info({ leaveId: l.id, restored: events.length }, 'leave_assignment_end');
  }
  return restored;
}

export async function runLeaveAssignmentSweep(opts?: { now?: Date }): Promise<{ started: number; restored: number }> {
  const now = opts?.now ?? new Date();
  const started = await applyStarts(now);
  const restored = await applyEnds(now);
  return { started, restored };
}

export function startLeaveAssignmentWorker(): void {
  if (env.NODE_ENV === 'test') return;
  if (timer) return;
  logger.info({ pollMs: env.LEAVE_REASSIGN_POLL_MS }, 'leave_assignment_worker_started');
  timer = setTimeout(function loop() {
    runLeaveAssignmentSweep().catch(e =>
      logger.warn({ err: String(e) }, 'leave_assignment_sweep_failed'));
    timer = setTimeout(loop, env.LEAVE_REASSIGN_POLL_MS);
  }, 2 * 60 * 1000);
}

export function stopLeaveAssignmentWorker(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
