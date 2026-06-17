import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../env.js';

// HMAC-SHA256 short-lived token for public receipt access. Encoding is
// `<kunjunganId>.<expSeconds>.<sig>` (base64url). Verifying re-runs HMAC
// using JWT_SECRET so rotating it invalidates every outstanding link.

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Buffer {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

function sign(payload: string): string {
  return b64url(createHmac('sha256', env.JWT_SECRET).update(payload).digest());
}

export function makeReceiptToken(kunjunganId: string, ttlDays = env.RECEIPT_TOKEN_TTL_DAYS): string {
  const exp = Math.floor(Date.now() / 1000) + ttlDays * 24 * 60 * 60;
  const payload = `${kunjunganId}.${exp}`;
  return `${b64url(Buffer.from(payload, 'utf-8'))}.${sign(payload)}`;
}

export interface VerifiedReceipt {
  kunjunganId: string;
  expSeconds: number;
}

export function verifyReceiptToken(token: string): VerifiedReceipt | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  const payload = fromB64url(payloadB64).toString('utf-8');
  const [kunjunganId, expStr] = payload.split('.');
  if (!kunjunganId || !expStr) return null;
  const expSeconds = Number.parseInt(expStr, 10);
  if (!Number.isFinite(expSeconds)) return null;
  if (Date.now() / 1000 > expSeconds) return null;

  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  return { kunjunganId, expSeconds };
}

export function receiptShareUrl(kunjunganId: string): string {
  const base = env.PUBLIC_BASE_URL ?? env.WEB_ORIGIN;
  const tok = makeReceiptToken(kunjunganId);
  // Web app routes the hash to a public receipt viewer page; the page in
  // turn requests the PDF from the API using the same token.
  return `${base.replace(/\/$/, '')}/#bukti/${tok}`;
}
