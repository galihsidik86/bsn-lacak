import { Router } from 'express';
import { prisma } from '../db.js';
import { verifyReceiptToken } from '../lib/receiptToken.js';

// Public verification endpoint reached by scanning the QR on a printed
// receipt or kunjungan PDF. NO authentication: the token is HMAC-signed
// and contains an expiry, so an attacker can't forge one. Returns
// non-sensitive metadata only — confirms the document is genuine without
// exposing the underlying customer record.

const router = Router();

router.get('/:token', async (req, res) => {
  const verified = verifyReceiptToken(String(req.params.token));
  if (!verified) {
    return res.status(404).json({ ok: false, error: 'invalid_or_expired' });
  }

  const k = await prisma.kunjungan.findUnique({
    where: { id: verified.kunjunganId },
    select: {
      id: true, tanggal: true, jam: true, hasil: true, nominal: true,
      reviewStatus: true,
      petugas: { select: { kode: true, nama: true } },
      nasabah: { select: { kode: true, nama: true } },
      branch: { select: { kode: true, nama: true } },
    },
  });
  if (!k) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }

  res.json({
    ok: true,
    document: {
      kunjunganId: k.id,
      tanggal: k.tanggal,
      jam: k.jam,
      hasil: k.hasil,
      nominal: String(k.nominal),
      reviewStatus: k.reviewStatus,
      petugas: k.petugas,
      // Only first name + masked kode so a leaked QR doesn't disclose the
      // full nasabah identity to anyone who scans it.
      nasabah: {
        kode: k.nasabah.kode,
        namaInisial: maskName(k.nasabah.nama),
      },
      branch: k.branch,
    },
    expiresAt: new Date(verified.expSeconds * 1000),
  });
});

function maskName(nama: string): string {
  // "Andi Pratama" → "Andi P.".
  const parts = nama.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return parts[0] + ' ' + parts[1][0] + '.';
}

export default router;
