// Bukti pembayaran — short A5 receipt. Designed to read well as a WA photo
// preview (most users won't open the actual PDF). Layout intentionally
// vertical so the amount stays in-frame on a phone thumbnail.

import PDFDocument from 'pdfkit';
import { drawDiagonalWatermark, drawVerifyQr } from './pdfWatermark.js';

const COLORS = {
  ink: '#1d2924',
  ink2: '#586a62',
  accent: '#1f8a5b',
  gold: '#b78b2a',
  rule: '#d2dad6',
  bg: '#f6f8f7',
};

const RP = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

interface ReceiptInput {
  kunjunganId: string;
  tanggal: Date;
  jam: string;
  nominal: bigint;
  metode?: string;
  catatan?: string;
  petugas: { kode: string; nama: string };
  nasabah: { kode: string; nama: string; alamat: string };
  branch: { kode: string; nama: string; alamat: string | null };
  sisaSetelahBayar?: bigint;
  verifyQr?: Buffer | null;
}

export function renderReceiptPdf(input: ReceiptInput): InstanceType<typeof PDFDocument> {
  const doc = new PDFDocument({
    size: 'A5', margin: 32,
    info: {
      Title: `Bukti Bayar ${input.kunjunganId}`,
      Author: 'Bank Syariah Nasional',
      Subject: 'Bukti Penerimaan Pembayaran',
    },
  });

  // BW — diagonal watermark first; new-page guard so multi-page PDFs stay
  // protected (very rare for a one-page A5 receipt, but cheap insurance).
  drawDiagonalWatermark(doc, input.branch.kode);
  doc.on('pageAdded', () => drawDiagonalWatermark(doc, input.branch.kode));

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;

  // Header strip
  doc.fillColor(COLORS.accent).rect(left, doc.page.margins.top, pageWidth, 56).fill();
  doc.fillColor('white').font('Helvetica-Bold').fontSize(14)
    .text('BANK SYARIAH NASIONAL', left + 14, doc.page.margins.top + 12);
  doc.fillColor('#dff0e7').font('Helvetica').fontSize(8.5)
    .text(input.branch.nama + (input.branch.alamat ? ` · ${input.branch.alamat}` : ''),
      left + 14, doc.page.margins.top + 30, { width: pageWidth - 28 });
  doc.fillColor('#e9b949').font('Helvetica-Bold').fontSize(10)
    .text('BUKTI PEMBAYARAN', left, doc.page.margins.top + 40, {
      width: pageWidth - 14, align: 'right',
    });

  let y = doc.page.margins.top + 72;
  doc.fillColor(COLORS.ink);

  // Reference + date
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.ink2)
    .text('NO. REFERENSI', left, y);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.ink)
    .text(input.kunjunganId, left, y + 11);

  const tanggalStr = input.tanggal.toLocaleString('id-ID', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.ink2)
    .text('TANGGAL', left + pageWidth / 2, y);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.ink)
    .text(`${tanggalStr} · ${input.jam}`, left + pageWidth / 2, y + 11);

  y += 36;
  doc.lineWidth(0.5).strokeColor(COLORS.rule).moveTo(left, y).lineTo(left + pageWidth, y).stroke();
  y += 14;

  // Big amount band
  doc.fillColor(COLORS.accent).font('Helvetica-Bold').fontSize(22)
    .text(RP(Number(input.nominal)), left, y, { width: pageWidth, align: 'center' });
  y += 28;
  doc.fillColor(COLORS.ink2).font('Helvetica').fontSize(9)
    .text(`Diterima secara ${input.metode ?? 'tunai'}`, left, y, {
      width: pageWidth, align: 'center',
    });
  y += 22;

  doc.lineWidth(0.5).strokeColor(COLORS.rule).moveTo(left, y).lineTo(left + pageWidth, y).stroke();
  y += 14;

  // Nasabah block
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.ink2).text('PEMBAYAR', left, y);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.ink)
    .text(input.nasabah.nama, left, y + 11);
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.ink2)
    .text(`${input.nasabah.kode} · ${input.nasabah.alamat}`, left, y + 26,
      { width: pageWidth });

  y = doc.y + 12;

  // Petugas block
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.ink2).text('DITERIMA OLEH', left, y);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.ink)
    .text(`${input.petugas.nama} (${input.petugas.kode})`, left, y + 11);
  y += 32;

  // Optional sisa
  if (input.sisaSetelahBayar !== undefined) {
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.ink2).text('SISA OUTSTANDING', left, y);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.gold)
      .text(RP(Number(input.sisaSetelahBayar)), left, y + 11);
    y += 32;
  }

  // Catatan
  if (input.catatan) {
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.ink2).text('CATATAN', left, y);
    doc.font('Helvetica-Oblique').fontSize(10).fillColor(COLORS.ink)
      .text(input.catatan, left, y + 11, { width: pageWidth, lineGap: 2 });
    y = doc.y + 8;
  }

  // Footer
  const footY = doc.page.height - doc.page.margins.bottom - 28;
  doc.fillColor(COLORS.bg).rect(left, footY, pageWidth, 28).fill();
  doc.fillColor(COLORS.ink2).font('Helvetica').fontSize(7.5)
    .text(
      'Bukti ini sah tanpa tanda tangan basah. Simpan sebagai referensi pembayaran Anda.',
      left + 10, footY + 6, { width: pageWidth - 20 },
    );
  doc.text(`Dicetak ${new Date().toLocaleString('id-ID')} · ${input.branch.kode}`,
    left + 10, footY + 17, { width: pageWidth - 20 });

  if (input.verifyQr) {
    drawVerifyQr(doc, input.verifyQr);
  }

  doc.end();
  return doc;
}
