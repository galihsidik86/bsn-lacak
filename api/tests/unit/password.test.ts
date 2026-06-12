import { describe, expect, it } from 'vitest';
import { checkPasswordPolicy, MIN_PASSWORD_LEN } from '../../src/lib/password.js';

describe('checkPasswordPolicy', () => {
  it('accepts a strong password', () => {
    expect(checkPasswordPolicy('Tr0ub4dor&3Marin!')).toEqual({ ok: true });
  });

  it('rejects too-short input', () => {
    const r = checkPasswordPolicy('Aa1!');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reasons.join(' ')).toMatch(new RegExp(String(MIN_PASSWORD_LEN)));
    }
  });

  it('requires lowercase letter', () => {
    const r = checkPasswordPolicy('AAAAAAAA1234!');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.some(x => /huruf kecil/i.test(x))).toBe(true);
  });

  it('requires uppercase letter', () => {
    const r = checkPasswordPolicy('aaaaaaaa1234!');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.some(x => /huruf besar/i.test(x))).toBe(true);
  });

  it('requires a digit', () => {
    const r = checkPasswordPolicy('Abcdefghij!@');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.some(x => /angka/i.test(x))).toBe(true);
  });

  it('requires a symbol', () => {
    const r = checkPasswordPolicy('Abcdefghij12');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.some(x => /simbol/i.test(x))).toBe(true);
  });

  it('rejects common substrings', () => {
    const r = checkPasswordPolicy('Password1234!');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.some(x => /umum|mudah/i.test(x))).toBe(true);
  });

  it('returns multiple reasons at once', () => {
    const r = checkPasswordPolicy('abc');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.length).toBeGreaterThan(1);
  });
});
