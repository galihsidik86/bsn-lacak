import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth, requireRole, scopedBranchId } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';
import { gateway } from '../lib/gateway/index.js';
import { logger } from '../lib/logger.js';
import { renderReceiptPdf } from '../lib/pdfReceipt.js';
import { makeVerifyArtifacts } from '../lib/pdfWatermark.js';
import { receiptShareUrl, verifyReceiptToken } from '../lib/receiptToken.js';

const router = Router();

// Public PDF view via signed token. Token carries kunjunganId + exp; verified
// HMAC means we don't need a DB row for the link itself.
router.get('/:token/pdf', async (req, res) => {
  const verified = verifyReceiptToken(String(req.params.token));
  if (!verified) return res.status(404).json({ error: 'not_found' });

  const k = await prisma.kunjungan.findUnique({
    where: { id: verified.kunjunganId },
    include: {
      petugas: { select: { kode: true, nama: true } },
      nasabah: { select: { kode: true, nama: true, alamat: true, sisa: true } },
      branch: { select: { kode: true, nama: true, alamat: true } },
    },
  });
  if (!k || k.hasil !== 'BAYAR' || k.nominal <= 0n) {
    return res.status(404).json({ error: 'not_found' });
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="bukti-bayar-${k.nasabah.kode}-${k.id}.pdf"`);
  res.setHeader('Cache-Control', 'private, max-age=86400');

  const qr = await makeVerifyArtifacts(k.id).catch(() => null);
  const pdf = renderReceiptPdf({
    kunjunganId: k.id,
    tanggal: k.tanggal,
    jam: k.jam,
    nominal: k.nominal,
    catatan: k.catatan,
    petugas: k.petugas,
    nasabah: k.nasabah,
    branch: k.branch,
    sisaSetelahBayar: k.nasabah.sisa,
    verifyQr: qr?.pngBuffer ?? null,
  });
  pdf.pipe(res);
});

// Manual re-send. SUPERVISOR + ADMIN — useful when WA failed first time or
// the nasabah lost the link.
router.post('/:id/resend', requireAuth, requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const id = String(req.params.id);
  const branchId = scopedBranchId(req);
  const k = await prisma.kunjungan.findFirst({
    where: { id, ...(branchId ? { branchId } : {}) },
    include: { nasabah: { select: { hp: true } }, petugas: { select: { nama: true } } },
  });
  if (!k) return res.status(404).json({ error: 'not_found' });
  if (k.hasil !== 'BAYAR' || k.nominal <= 0n) {
    return res.status(409).json({ error: 'no_payment' });
  }

  const result = await sendReceiptWa(id);
  await audit({
    action: 'receipt.resend', target: id, ...fromReq(req),
    meta: { ok: result.ok, error: result.ok ? undefined : result.error },
  });
  res.json(result);
});

// --- Helper for kunjungan route ------------------------------------------
//
// Called from POST /api/kunjungan after a BAYAR with nominal>0 lands.
// Sends a short WA/SMS containing the public receipt link. Soft-fails so a
// dead gateway doesn't block submission.

export async function sendReceiptWa(kunjunganId: string): Promise<{ ok: boolean; error?: string; url?: string }> {
  try {
    const k = await prisma.kunjungan.findUnique({
      where: { id: kunjunganId },
      include: {
        nasabah: { select: { nama: true, hp: true } },
        petugas: { select: { nama: true } },
        branch: { select: { nama: true } },
      },
    });
    if (!k) return { ok: false, error: 'not_found' };
    if (k.hasil !== 'BAYAR' || k.nominal <= 0n) return { ok: false, error: 'no_payment' };
    if (!k.nasabah.hp) return { ok: false, error: 'no_hp' };

    const url = receiptShareUrl(kunjunganId);
    const rp = Number(k.nominal).toLocaleString('id-ID');
    const body =
      `BSN Lacak: Terima kasih ${k.nasabah.nama}, pembayaran Rp ${rp} telah diterima oleh ${k.petugas.nama}. ` +
      `Bukti: ${url}`;

    const r = await gateway.send({ channel: 'WA', to: k.nasabah.hp, body });
    if (!r.ok) {
      logger.warn({ kunjunganId, err: r.error }, 'receipt_wa_failed');
      return { ok: false, error: r.error };
    }
    return { ok: true, url };
  } catch (e) {
    logger.warn({ err: String(e), kunjunganId }, 'sendReceiptWa_threw');
    return { ok: false, error: 'exception' };
  }
}

export default router;
