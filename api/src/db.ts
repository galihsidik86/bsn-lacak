import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
});

// BigInt is not JSON-serializable by default. Emit a *number* when the value
// fits in Number.MAX_SAFE_INTEGER (2^53), and a string only as a fallback for
// genuinely huge values. Rupiah balances on individual nasabah are nowhere
// near 9 quadrillion, so the frontend (which types these fields as `number`)
// receives correct shapes by default.
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
declare global {
  interface BigInt { toJSON(): number | string }
}
(BigInt.prototype as any).toJSON = function () {
  return this <= MAX_SAFE && this >= -MAX_SAFE ? Number(this) : this.toString();
};
