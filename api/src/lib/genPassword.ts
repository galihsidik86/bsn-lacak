import { randomBytes } from 'node:crypto';

// Same recipe as the seed: meets policy by construction (one of each class)
// so we never hand a freshly-created user an invalid temp password.
const LOWER = 'abcdefghjkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const NUM = '23456789';
const SYM = '!@#$%^&*-_=+';

export function generatePassword(len = 16): string {
  const all = LOWER + UPPER + NUM + SYM;
  const bytes = randomBytes(len);
  const chars: string[] = [
    LOWER[bytes[0] % LOWER.length],
    UPPER[bytes[1] % UPPER.length],
    NUM[bytes[2] % NUM.length],
    SYM[bytes[3] % SYM.length],
  ];
  for (let i = 4; i < len; i++) chars.push(all[bytes[i] % all.length]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
