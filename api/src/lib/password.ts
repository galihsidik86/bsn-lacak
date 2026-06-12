// Centralized password policy. Used by login, change-password, and seeding.

export const MIN_PASSWORD_LEN = 12;

export interface PolicyFailure { ok: false; reasons: string[] }
export interface PolicyOk { ok: true }
export type PolicyResult = PolicyOk | PolicyFailure;

export function checkPasswordPolicy(pw: string): PolicyResult {
  const reasons: string[] = [];
  if (pw.length < MIN_PASSWORD_LEN) reasons.push(`Minimal ${MIN_PASSWORD_LEN} karakter.`);
  if (!/[a-z]/.test(pw)) reasons.push('Harus mengandung huruf kecil.');
  if (!/[A-Z]/.test(pw)) reasons.push('Harus mengandung huruf besar.');
  if (!/\d/.test(pw)) reasons.push('Harus mengandung angka.');
  if (!/[^A-Za-z0-9]/.test(pw)) reasons.push('Harus mengandung simbol.');
  // Cheap dictionary check — keep it small to avoid bundling a wordlist here.
  const COMMON = ['password', 'qwerty', '12345678', 'admin1234', 'changeme', 'bsn'];
  if (COMMON.some(c => pw.toLowerCase().includes(c))) reasons.push('Mengandung kata yang umum/mudah ditebak.');
  return reasons.length ? { ok: false, reasons } : { ok: true };
}
