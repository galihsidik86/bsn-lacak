import exifr from 'exifr';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point as turfPoint, polygon as turfPolygon } from '@turf/helpers';
import { logger } from './logger.js';

// Anti-fraud scoring for petugas reports. Each rule that fires adds a string
// flag + score; the kunjungan route stores them on the row and inverts
// `valid` when score > 0. Supervisors see "perlu review" badge + the flag
// list in the laporan detail.

export interface RiskEval {
  flags: string[];
  score: number;
}

export const RISK_FLAG_META: Record<string, { label: string; severity: number; hint: string }> = {
  gps_far: { label: 'GPS jauh dari nasabah', severity: 10, hint: 'Lokasi laporan > 200m dari alamat nasabah.' },
  gps_missing: { label: 'GPS tidak dikirim', severity: 5, hint: 'Klien tidak melampirkan koordinat saat submit.' },
  photo_no_exif: { label: 'Foto tanpa metadata', severity: 3, hint: 'Foto tidak punya EXIF — mungkin dari galeri / di-edit.' },
  photo_stale: { label: 'Foto lama', severity: 8, hint: 'Foto diambil > 1 jam sebelum laporan dikirim.' },
  speed_jump: { label: 'Lonjakan kecepatan', severity: 7, hint: 'Petugas berpindah > 150 km/h antara dua ping GPS.' },
  outside_wilayah: { label: 'Di luar wilayah binaan', severity: 9, hint: 'Posisi laporan berada di luar polygon wilayah petugas.' },
  // BV — pola mencurigakan berdasarkan riwayat:
  duplicate_visit: { label: 'Visit dobel hari ini', severity: 6, hint: 'Petugas sudah BAYAR dari nasabah yang sama hari ini.' },
  nominal_spike: { label: 'Nominal di atas wajar', severity: 8, hint: 'Nominal bayar lebih dari 3× angsuran bulanan.' },
  volume_anomaly: { label: 'Volume kunjungan ekstrem', severity: 4, hint: 'Petugas sudah > 20 kunjungan dalam 24 jam.' },
};

// Equirectangular approximation — accurate enough at metro-scale (~50m).
export function distMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371_000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const x = dLng * Math.cos(lat);
  return Math.hypot(dLat, x) * R;
}

interface GpsCheckInput {
  reportedLat: number | null | undefined;
  reportedLng: number | null | undefined;
  nasabahLat: number | null | undefined;
  nasabahLng: number | null | undefined;
  maxMeters?: number;
}

export function evalGps({
  reportedLat, reportedLng, nasabahLat, nasabahLng, maxMeters = 200,
}: GpsCheckInput): RiskEval {
  const flags: string[] = [];
  let score = 0;
  if (typeof reportedLat !== 'number' || typeof reportedLng !== 'number') {
    flags.push('gps_missing');
    score += RISK_FLAG_META.gps_missing.severity;
    return { flags, score };
  }
  if (typeof nasabahLat !== 'number' || typeof nasabahLng !== 'number') {
    // Nasabah belum punya koordinat — tidak bisa cek; jangan flag.
    return { flags, score };
  }
  const d = distMeters(
    { lat: reportedLat, lng: reportedLng },
    { lat: nasabahLat, lng: nasabahLng },
  );
  if (d > maxMeters) {
    flags.push('gps_far');
    score += RISK_FLAG_META.gps_far.severity;
  }
  return { flags, score };
}

// EXIF DateTimeOriginal check. Modern HEIC/JPEG photos from camera contain
// this tag. Reject if missing or > 1 hour old at upload time. Accept
// silently if EXIF parsing throws (corrupt header — separate magic-byte
// check upstream catches non-images).
export async function evalPhotoExif(buf: Buffer, now = Date.now()): Promise<RiskEval> {
  const flags: string[] = [];
  let score = 0;
  let parsed: { DateTimeOriginal?: Date } | undefined;
  try {
    parsed = await exifr.parse(buf, { pick: ['DateTimeOriginal', 'CreateDate'] });
  } catch (e) {
    logger.debug({ err: String(e) }, 'exif_parse_threw');
  }
  const taken = (parsed?.DateTimeOriginal as Date | undefined)
    ?? ((parsed as any)?.CreateDate as Date | undefined);
  if (!taken || Number.isNaN(taken.getTime())) {
    flags.push('photo_no_exif');
    score += RISK_FLAG_META.photo_no_exif.severity;
    return { flags, score };
  }
  const ageMs = now - taken.getTime();
  // Allow a 5-minute future window for clock skew.
  if (ageMs > 60 * 60 * 1000 || ageMs < -5 * 60 * 1000) {
    flags.push('photo_stale');
    score += RISK_FLAG_META.photo_stale.severity;
  }
  return { flags, score };
}

interface SpeedCheckInput {
  prev: { lat: number; lng: number; recordedAt: Date } | null;
  next: { lat: number; lng: number; recordedAt: Date };
  maxKmh?: number;
}

export function evalSpeed({ prev, next, maxKmh = 150 }: SpeedCheckInput): RiskEval {
  const flags: string[] = [];
  let score = 0;
  if (!prev) return { flags, score };
  const dtSec = (next.recordedAt.getTime() - prev.recordedAt.getTime()) / 1000;
  if (dtSec <= 0) return { flags, score };
  const meters = distMeters(prev, next);
  // Ignore tiny moves to avoid noise from low-accuracy fixes.
  if (meters < 50) return { flags, score };
  const kmh = (meters / dtSec) * 3.6;
  if (kmh > maxKmh) {
    flags.push('speed_jump');
    score += RISK_FLAG_META.speed_jump.severity;
  }
  return { flags, score };
}

// Point-in-polygon check against a GeoJSON Polygon. Returns no flag if the
// polygon is absent (zone not yet drawn) or reported coords missing.
export function evalGeofence(
  reportedLat: number | null | undefined,
  reportedLng: number | null | undefined,
  polygon: { type: 'Polygon'; coordinates: number[][][] } | null,
): RiskEval {
  if (!polygon || typeof reportedLat !== 'number' || typeof reportedLng !== 'number') {
    return { flags: [], score: 0 };
  }
  const pt = turfPoint([reportedLng, reportedLat]);
  const pg = turfPolygon(polygon.coordinates);
  if (booleanPointInPolygon(pt, pg)) return { flags: [], score: 0 };
  return {
    flags: ['outside_wilayah'],
    score: RISK_FLAG_META.outside_wilayah.severity,
  };
}

// Merge two evaluations (dedupe flags, sum score).
// Pattern-based risk check (BV) — looks at recent activity to spot dobel
// laporan, nominal spike, dan volume tidak wajar. Pure function over a
// snapshot so the kunjungan route can call it with a single Prisma round
// trip rather than spreading queries across the eval chain.
export interface PatternInput {
  hasil: 'BAYAR' | 'JANJI' | 'TIDAKADA' | 'TOLAK';
  nominal: bigint | number;
  angsuranBulanan: bigint | number;
  // Submitted BAYAR rows for this (petugas × nasabah) today, excluding the
  // current one. Used by duplicate_visit.
  sameDayBayarCount: number;
  // Total kunjungan submitted by this petugas in the last 24h, excluding
  // the current one. Used by volume_anomaly.
  petugasVisitsLast24h: number;
}

export function evalSuspiciousPattern(i: PatternInput): RiskEval {
  const flags: string[] = [];
  let score = 0;

  if (i.hasil === 'BAYAR' && i.sameDayBayarCount >= 1) {
    flags.push('duplicate_visit');
    score += RISK_FLAG_META.duplicate_visit.severity;
  }
  if (i.hasil === 'BAYAR') {
    const n = Number(i.nominal);
    const a = Number(i.angsuranBulanan);
    if (a > 0 && n > 3 * a) {
      flags.push('nominal_spike');
      score += RISK_FLAG_META.nominal_spike.severity;
    }
  }
  if (i.petugasVisitsLast24h > 20) {
    flags.push('volume_anomaly');
    score += RISK_FLAG_META.volume_anomaly.severity;
  }
  return { flags, score };
}

export function merge(...evals: RiskEval[]): RiskEval {
  const flagSet = new Set<string>();
  let score = 0;
  for (const e of evals) {
    for (const f of e.flags) flagSet.add(f);
    score += e.score;
  }
  return { flags: [...flagSet], score };
}
