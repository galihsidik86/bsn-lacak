import * as OTPAuth from 'otpauth';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../env.js';

// AES-256-GCM envelope around the TOTP shared secret. The key is HKDF-ish:
// SHA-256 of (TOTP_ENCRYPTION_KEY || "totp:v1"), falling back to JWT_SECRET
// when the dedicated key isn't set. This lets dev run without extra config
// but means rotating JWT_SECRET in that case rotates 2FA secrets too —
// production should always set TOTP_ENCRYPTION_KEY.

function key(): Buffer {
  const material = env.TOTP_ENCRYPTION_KEY ?? env.JWT_SECRET;
  return createHash('sha256').update(material + ':totp:v1').digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('hex');
}

export function decryptSecret(hex: string): string {
  const buf = Buffer.from(hex, 'hex');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export function generateSecret(): { base32: string; otpauth: (label: string, issuer: string) => string } {
  const secret = new OTPAuth.Secret({ size: 20 });
  const base32 = secret.base32;
  return {
    base32,
    otpauth: (label, issuer) => new OTPAuth.TOTP({
      issuer, label,
      algorithm: 'SHA1', digits: 6, period: 30,
      secret,
    }).toString(),
  };
}

// Allow ±1 step (=30s) drift to handle clock skew between server and the
// authenticator app. Anything wider opens replay-window risk.
export function verifyCode(base32Secret: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(base32Secret),
    algorithm: 'SHA1', digits: 6, period: 30,
  });
  const delta = totp.validate({ token: code, window: 1 });
  return delta !== null;
}
