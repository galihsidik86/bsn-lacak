import { describe, it, expect } from 'vitest';
import { evalGps, evalSpeed, evalPhotoExif, merge, distMeters } from '../../src/lib/antiFraud.js';

describe('antiFraud.evalGps', () => {
  it('flags gps_missing when no coords', () => {
    const r = evalGps({ reportedLat: undefined, reportedLng: undefined, nasabahLat: -6.48, nasabahLng: 106.85 });
    expect(r.flags).toContain('gps_missing');
    expect(r.score).toBeGreaterThan(0);
  });

  it('no flags when reported is on top of nasabah', () => {
    const r = evalGps({ reportedLat: -6.48, reportedLng: 106.85, nasabahLat: -6.48, nasabahLng: 106.85 });
    expect(r.flags).toEqual([]);
    expect(r.score).toBe(0);
  });

  it('flags gps_far when reported > 200m away', () => {
    // ~1 km diff at the equator-ish — well beyond 200m.
    const r = evalGps({ reportedLat: -6.48, reportedLng: 106.85, nasabahLat: -6.49, nasabahLng: 106.86 });
    expect(r.flags).toContain('gps_far');
  });

  it('no flag when nasabah has no coords (cannot judge)', () => {
    const r = evalGps({ reportedLat: -6.48, reportedLng: 106.85, nasabahLat: null, nasabahLng: null });
    expect(r.flags).toEqual([]);
  });
});

describe('antiFraud.evalSpeed', () => {
  it('no flag when no prev fix', () => {
    const r = evalSpeed({ prev: null, next: { lat: -6.48, lng: 106.85, recordedAt: new Date() } });
    expect(r.flags).toEqual([]);
  });

  it('no flag when move is tiny noise', () => {
    const now = new Date();
    const prev = new Date(now.getTime() - 1000);
    const r = evalSpeed({
      prev: { lat: -6.48, lng: 106.85, recordedAt: prev },
      next: { lat: -6.480001, lng: 106.850001, recordedAt: now },
    });
    expect(r.flags).toEqual([]);
  });

  it('flags speed_jump on > 150 km/h transit', () => {
    const now = new Date();
    const prev = new Date(now.getTime() - 60 * 1000); // 60s ago
    // ~5 km gap in 60s => 300 km/h
    const r = evalSpeed({
      prev: { lat: -6.40, lng: 106.85, recordedAt: prev },
      next: { lat: -6.45, lng: 106.85, recordedAt: now },
    });
    expect(r.flags).toContain('speed_jump');
  });
});

describe('antiFraud.evalPhotoExif', () => {
  it('flags photo_no_exif on a buffer without EXIF metadata', async () => {
    // Tiny valid PNG bytes (1x1 transparent) — has no EXIF DateTimeOriginal.
    const png = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63000100000005000100' +
      '0d0a2db40000000049454e44ae426082', 'hex',
    );
    const r = await evalPhotoExif(png);
    expect(r.flags).toContain('photo_no_exif');
  });
});

describe('antiFraud.distMeters', () => {
  it('approximates ~111km per degree of latitude', () => {
    const d = distMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    // Equirectangular gives ~111 km; allow some slack.
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });
});

describe('antiFraud.merge', () => {
  it('dedupes flags and sums scores', () => {
    const m = merge(
      { flags: ['gps_far'], score: 10 },
      { flags: ['gps_far', 'photo_stale'], score: 8 },
    );
    expect(m.flags.sort()).toEqual(['gps_far', 'photo_stale']);
    expect(m.score).toBe(18);
  });
});
