// Visit cadence rules (BN) — recommend the next visit date based on the
// nasabah's kolektabilitas and the most recent kunjungan outcome. Falls
// back to a sensible default when no result is known yet.
//
// The recommendation is the API surface used by the kunjungan.create
// handler to auto-populate Nasabah.nextVisitAt; supervisors can override
// via the PATCH endpoint.

import type { HasilKunjungan, KolKey } from '@prisma/client';

// Days from "now" by (kol × hasil). Lower kol = wider gap; higher kol
// (macet) = tight follow-up. TIDAKADA/TOLAK always pulls forward.
const CADENCE: Record<KolKey, Record<HasilKunjungan, number>> = {
  K1: { BAYAR: 30, JANJI: 7, TIDAKADA: 3, TOLAK: 3 },
  K2: { BAYAR: 21, JANJI: 5, TIDAKADA: 3, TOLAK: 2 },
  K3: { BAYAR: 14, JANJI: 4, TIDAKADA: 2, TOLAK: 2 },
  K4: { BAYAR: 7,  JANJI: 3, TIDAKADA: 2, TOLAK: 1 },
  K5: { BAYAR: 5,  JANJI: 2, TIDAKADA: 1, TOLAK: 1 },
};

// Compute the next visit date from cadence rules. `from` is the anchor
// (typically the kunjungan tanggal); `kol` and `hasil` pick the row.
export function nextVisitDate(from: Date, kol: KolKey, hasil: HasilKunjungan): Date {
  const days = CADENCE[kol]?.[hasil] ?? 7;
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d;
}

// When no kunjungan has happened yet, schedule based on kol only — use
// the TIDAKADA cell so we follow up sooner rather than later.
export function initialNextVisitDate(from: Date, kol: KolKey): Date {
  return nextVisitDate(from, kol, 'TIDAKADA');
}
