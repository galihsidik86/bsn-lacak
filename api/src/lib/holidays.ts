// Indonesian national holidays. Hard-coded per year; SKB 3 Menteri normally
// drops in October so the next year's entry needs a manual refresh once a
// year. Kept in code rather than DB so the morning reminder worker doesn't
// need a network round-trip on every poll.
//
// Date format: YYYY-MM-DD (local). `cuti_bersama` flagged separately from
// `nasional` so an org that runs ops on cuti bersama can opt-in.

export interface Holiday {
  date: string;          // YYYY-MM-DD
  name: string;
  type: 'nasional' | 'cuti_bersama';
}

// 2026 calendar (SKB 3 Menteri 2026). 2025 + 2024 retained so backfilled
// reports + audit views render correctly for older data.
const HOLIDAYS_BY_YEAR: Record<number, Holiday[]> = {
  2024: [
    { date: '2024-01-01', name: 'Tahun Baru Masehi', type: 'nasional' },
    { date: '2024-02-08', name: 'Isra Miraj Nabi Muhammad SAW', type: 'nasional' },
    { date: '2024-02-10', name: 'Tahun Baru Imlek 2575 Kongzili', type: 'nasional' },
    { date: '2024-03-11', name: 'Hari Suci Nyepi (Tahun Baru Saka 1946)', type: 'nasional' },
    { date: '2024-03-29', name: 'Wafat Isa Almasih', type: 'nasional' },
    { date: '2024-03-31', name: 'Hari Paskah', type: 'nasional' },
    { date: '2024-04-10', name: 'Idul Fitri 1445 H', type: 'nasional' },
    { date: '2024-04-11', name: 'Idul Fitri 1445 H', type: 'nasional' },
    { date: '2024-05-01', name: 'Hari Buruh Internasional', type: 'nasional' },
    { date: '2024-05-09', name: 'Kenaikan Isa Almasih', type: 'nasional' },
    { date: '2024-05-23', name: 'Hari Raya Waisak 2568 BE', type: 'nasional' },
    { date: '2024-06-01', name: 'Hari Lahir Pancasila', type: 'nasional' },
    { date: '2024-06-17', name: 'Idul Adha 1445 H', type: 'nasional' },
    { date: '2024-07-07', name: 'Tahun Baru Islam 1446 H', type: 'nasional' },
    { date: '2024-08-17', name: 'Hari Kemerdekaan RI', type: 'nasional' },
    { date: '2024-09-16', name: 'Maulid Nabi Muhammad SAW', type: 'nasional' },
    { date: '2024-12-25', name: 'Hari Raya Natal', type: 'nasional' },
  ],
  2025: [
    { date: '2025-01-01', name: 'Tahun Baru Masehi', type: 'nasional' },
    { date: '2025-01-27', name: 'Isra Miraj Nabi Muhammad SAW', type: 'nasional' },
    { date: '2025-01-29', name: 'Tahun Baru Imlek 2576 Kongzili', type: 'nasional' },
    { date: '2025-03-29', name: 'Hari Suci Nyepi (Tahun Baru Saka 1947)', type: 'nasional' },
    { date: '2025-03-31', name: 'Idul Fitri 1446 H', type: 'nasional' },
    { date: '2025-04-01', name: 'Idul Fitri 1446 H', type: 'nasional' },
    { date: '2025-04-18', name: 'Wafat Isa Almasih', type: 'nasional' },
    { date: '2025-04-20', name: 'Hari Paskah', type: 'nasional' },
    { date: '2025-05-01', name: 'Hari Buruh Internasional', type: 'nasional' },
    { date: '2025-05-12', name: 'Hari Raya Waisak 2569 BE', type: 'nasional' },
    { date: '2025-05-29', name: 'Kenaikan Isa Almasih', type: 'nasional' },
    { date: '2025-06-01', name: 'Hari Lahir Pancasila', type: 'nasional' },
    { date: '2025-06-06', name: 'Idul Adha 1446 H', type: 'nasional' },
    { date: '2025-06-27', name: 'Tahun Baru Islam 1447 H', type: 'nasional' },
    { date: '2025-08-17', name: 'Hari Kemerdekaan RI', type: 'nasional' },
    { date: '2025-09-05', name: 'Maulid Nabi Muhammad SAW', type: 'nasional' },
    { date: '2025-12-25', name: 'Hari Raya Natal', type: 'nasional' },
  ],
  2026: [
    { date: '2026-01-01', name: 'Tahun Baru Masehi', type: 'nasional' },
    { date: '2026-01-17', name: 'Isra Miraj Nabi Muhammad SAW', type: 'nasional' },
    { date: '2026-02-17', name: 'Tahun Baru Imlek 2577 Kongzili', type: 'nasional' },
    { date: '2026-03-19', name: 'Hari Suci Nyepi (Tahun Baru Saka 1948)', type: 'nasional' },
    { date: '2026-03-20', name: 'Idul Fitri 1447 H', type: 'nasional' },
    { date: '2026-03-21', name: 'Idul Fitri 1447 H', type: 'nasional' },
    { date: '2026-04-03', name: 'Wafat Isa Almasih', type: 'nasional' },
    { date: '2026-04-05', name: 'Hari Paskah', type: 'nasional' },
    { date: '2026-05-01', name: 'Hari Buruh Internasional', type: 'nasional' },
    { date: '2026-05-14', name: 'Kenaikan Isa Almasih', type: 'nasional' },
    { date: '2026-05-26', name: 'Idul Adha 1447 H', type: 'nasional' },
    { date: '2026-06-01', name: 'Hari Lahir Pancasila', type: 'nasional' },
    { date: '2026-06-02', name: 'Hari Raya Waisak 2570 BE', type: 'nasional' },
    { date: '2026-06-16', name: 'Tahun Baru Islam 1448 H', type: 'nasional' },
    { date: '2026-08-17', name: 'Hari Kemerdekaan RI', type: 'nasional' },
    { date: '2026-08-25', name: 'Maulid Nabi Muhammad SAW', type: 'nasional' },
    { date: '2026-12-25', name: 'Hari Raya Natal', type: 'nasional' },
  ],
};

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getHolidayOn(d: Date): Holiday | null {
  const key = localDateKey(d);
  const year = d.getFullYear();
  const list = HOLIDAYS_BY_YEAR[year] ?? [];
  return list.find(h => h.date === key) ?? null;
}

export function isWeekend(d: Date): boolean {
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

// True iff `d` is a working day for ops — i.e. Mon-Fri AND not a national
// holiday (cuti bersama opted out by default; pass includeCutiBersama=true
// when the worker should skip those too).
export function isWorkingDay(d: Date, opts?: { includeCutiBersama?: boolean }): boolean {
  if (isWeekend(d)) return false;
  const h = getHolidayOn(d);
  if (!h) return true;
  if (h.type === 'nasional') return false;
  if (h.type === 'cuti_bersama' && opts?.includeCutiBersama) return false;
  return true;
}

export function listHolidaysForYear(year: number): Holiday[] {
  return HOLIDAYS_BY_YEAR[year] ?? [];
}

export function getAvailableHolidayYears(): number[] {
  return Object.keys(HOLIDAYS_BY_YEAR).map(Number).sort((a, b) => a - b);
}
