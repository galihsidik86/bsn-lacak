import { prisma } from '../db.js';
import { Prisma } from '@prisma/client';

// Per-petugas performance roll-up for the supervisor scorecard. Aggregates
// kunjungan + review state over a window so the supervisor can spot trends
// (rejection rate, average risk, response time) without scrolling per row.

export interface PetugasPerformance {
  petugasId: string;
  nama: string;
  kode: string;
  inisial: string;
  hue: number;
  wilayah: string;
  total: number;             // # of kunjungan in window
  approved: number;
  pending: number;
  rejected: number;
  rejectionRate: number;     // 0..1 over reviewed (approved+rejected) total
  flagged: number;           // riskScore > 0
  flaggedRate: number;       // 0..1 over total
  avgRiskScore: number;
  avgResponseMinutes: number | null;  // tanggal → reviewedAt for reviewed ones
  lastKunjunganAt: string | null;
}

export interface PerformanceFilters {
  branchId?: string | null;
  petugasIds?: string[];
  since?: Date;
}

export async function computePetugasPerformance(f: PerformanceFilters): Promise<PetugasPerformance[]> {
  const since = f.since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Scope petugas list — by branch (supervisor) or full (admin).
  const petugasWhere: Prisma.PetugasWhereInput = {};
  if (f.branchId) petugasWhere.branchId = f.branchId;
  if (f.petugasIds?.length) petugasWhere.id = { in: f.petugasIds };

  const petugasList = await prisma.petugas.findMany({
    where: petugasWhere,
    select: { id: true, nama: true, kode: true, inisial: true, hue: true, wilayah: true },
    orderBy: { nama: 'asc' },
  });
  if (petugasList.length === 0) return [];

  const ids = petugasList.map(p => p.id);

  // Pull every kunjungan in window for the petugas set. Keep this query small
  // by selecting only the columns the aggregator uses.
  const kunjungan = await prisma.kunjungan.findMany({
    where: { petugasId: { in: ids }, tanggal: { gte: since } },
    select: {
      petugasId: true, tanggal: true, reviewStatus: true,
      reviewedAt: true, riskScore: true,
    },
  });

  const byPet = new Map<string, typeof kunjungan>();
  for (const k of kunjungan) {
    const a = byPet.get(k.petugasId) ?? [];
    a.push(k);
    byPet.set(k.petugasId, a);
  }

  return petugasList.map(p => {
    const rows = byPet.get(p.id) ?? [];
    const total = rows.length;
    let approved = 0, pending = 0, rejected = 0, flagged = 0;
    let riskSum = 0;
    let respSum = 0, respCount = 0;
    let lastAt: Date | null = null;
    for (const k of rows) {
      if (k.reviewStatus === 'APPROVED') approved++;
      else if (k.reviewStatus === 'PENDING') pending++;
      else if (k.reviewStatus === 'REJECTED') rejected++;
      if (k.riskScore > 0) flagged++;
      riskSum += k.riskScore;
      if (k.reviewedAt && k.tanggal) {
        respSum += (k.reviewedAt.getTime() - k.tanggal.getTime()) / 60_000;
        respCount++;
      }
      if (!lastAt || k.tanggal > lastAt) lastAt = k.tanggal;
    }
    const reviewed = approved + rejected;
    return {
      petugasId: p.id,
      nama: p.nama, kode: p.kode, inisial: p.inisial, hue: p.hue, wilayah: p.wilayah,
      total, approved, pending, rejected,
      rejectionRate: reviewed > 0 ? rejected / reviewed : 0,
      flagged,
      flaggedRate: total > 0 ? flagged / total : 0,
      avgRiskScore: total > 0 ? riskSum / total : 0,
      avgResponseMinutes: respCount > 0 ? respSum / respCount : null,
      lastKunjunganAt: lastAt ? lastAt.toISOString() : null,
    };
  });
}
