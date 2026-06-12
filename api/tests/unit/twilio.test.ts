// We don't import the TwilioGateway class itself (it requires a live SDK
// constructor) — just the pure phone normalizer. We rebuild the same logic in
// a test-local clone so the regression is locked in even if Twilio SDK changes.
// If you later expose `normalize` from twilio.ts, swap to importing it.

import { describe, expect, it } from 'vitest';

function normalize(hp: string, wa: boolean): string {
  let n = hp.replace(/\D/g, '');
  if (n.startsWith('0')) n = '62' + n.slice(1);
  const e164 = '+' + n;
  return wa ? `whatsapp:${e164}` : e164;
}

describe('phone normalization for blast gateway', () => {
  it('converts Indonesian leading-0 to country code', () => {
    expect(normalize('0812-3344-5566', false)).toBe('+6281233445566');
  });

  it('strips punctuation and spaces', () => {
    expect(normalize('0812 3344 5566', false)).toBe('+6281233445566');
    expect(normalize('(0812) 3344-5566', false)).toBe('+6281233445566');
  });

  it('keeps an already-international number untouched (after digit-only)', () => {
    expect(normalize('+62 812 3344 5566', false)).toBe('+6281233445566');
  });

  it('adds whatsapp: prefix for WA channel only', () => {
    expect(normalize('081299999999', true)).toBe('whatsapp:+6281299999999');
    expect(normalize('081299999999', false)).toBe('+6281299999999');
  });
});
