import QRCode from 'qrcode';
import { env } from '../env.js';
import { makeReceiptToken } from './receiptToken.js';

// Generate a verify URL + QR PNG buffer for a kunjungan id. The URL points
// at the SPA hash route #verify/<token> which calls /api/verify/:token and
// renders the document metadata. Token is signed + time-boxed so a scraped
// QR can't be re-targeted to a different kunjungan.

export interface VerifyArtifacts {
  url: string;
  pngBuffer: Buffer;
}

export async function makeVerifyArtifacts(kunjunganId: string): Promise<VerifyArtifacts> {
  const base = (env.PUBLIC_BASE_URL ?? env.WEB_ORIGIN).replace(/\/$/, '');
  const token = makeReceiptToken(kunjunganId);
  const url = `${base}/#verify/${token}`;
  const pngBuffer = await QRCode.toBuffer(url, {
    type: 'png',
    margin: 1,
    width: 160,
    color: { dark: '#1d2924ff', light: '#ffffffff' },
  });
  return { url, pngBuffer };
}

// Stamps a diagonal "DOKUMEN RESMI · <branchKode>" string across the page
// in a low-opacity tone so it shows through if the PDF is screenshot or
// photographed. Caller supplies the document and the branchKode.
export function drawDiagonalWatermark(
  doc: any, branchKode: string,
): void {
  const text = `BSN LACAK · ${branchKode}`;
  doc.save();
  doc.fillColor('#1d2924').opacity(0.06);
  doc.font('Helvetica-Bold').fontSize(58);
  // Center + rotate -30° around page center.
  doc.translate(doc.page.width / 2, doc.page.height / 2);
  doc.rotate(-30);
  doc.text(text, -doc.page.width / 2, -20, {
    width: doc.page.width, align: 'center',
  });
  doc.restore();
}

// Draw a small QR with caption in the bottom-right of the current page.
export function drawVerifyQr(
  doc: any, pngBuffer: Buffer, opts?: { caption?: string },
): void {
  const size = 72;
  const x = doc.page.width - doc.page.margins.right - size;
  const y = doc.page.height - doc.page.margins.bottom - size - 14;
  doc.image(pngBuffer, x, y, { width: size, height: size });
  doc.fillColor('#586a62').opacity(1)
    .font('Helvetica').fontSize(7)
    .text(opts?.caption ?? 'Scan untuk verifikasi', x - 10, y + size + 2, {
      width: size + 20, align: 'center',
    });
}
