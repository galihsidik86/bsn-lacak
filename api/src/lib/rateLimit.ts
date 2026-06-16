import rateLimit from 'express-rate-limit';

// Strict limiter for auth endpoints — prevents brute force.
// Hits are counted per IP. Lockout also tracked at User level (see auth route).
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'too_many_attempts', detail: 'Coba lagi dalam 15 menit.' },
});

// General API limiter — broad protection against abuse.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'rate_limited' },
});

// POST /api/kunjungan is heavy: multipart up to 5×8MB, sharp re-encode +
// EXIF + watermark per photo. Per-user (token sub) bucket so an attacker
// with a stolen token can't spin a DoS, but a busy petugas still has
// plenty of headroom (45 reports per 10min ≈ one every 13s).
export const kunjunganLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 45,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'rate_limited', detail: 'Terlalu banyak laporan. Tunggu sebentar.' },
  keyGenerator: (req) => {
    // Prefer the authenticated user; fall back to IP if pre-auth (shouldn't
    // happen since requireAuth runs first, but safety net).
    const sub = (req as any).user?.sub;
    return typeof sub === 'string' && sub.length > 0 ? `u:${sub}` : `ip:${req.ip ?? 'unknown'}`;
  },
});
