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
