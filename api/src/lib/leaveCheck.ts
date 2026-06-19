import { prisma } from '../db.js';

// Returns the set of petugasIds currently on approved leave (startDate ≤
// `at` ≤ endDate). The reminder + inactivity workers use this to skip
// people who shouldn't be expected to log activity.
export async function petugasOnLeaveOn(at: Date): Promise<Set<string>> {
  const rows = await prisma.petugasLeave.findMany({
    where: {
      status: 'approved',
      startDate: { lte: at },
      endDate: { gte: at },
    },
    select: { petugasId: true },
  });
  return new Set(rows.map(r => r.petugasId));
}
