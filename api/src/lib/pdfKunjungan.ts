// Single-page A4 PDF for one Kunjungan. Hand-laid out in pdfkit — no HTML
// engine to bundle — which keeps the PDF service small and the layout
// trivially audited for sensitive fields (no surprise reflows that could
// leak data across pages).

import PDFDocument from 'pdfkit';
import path from 'node:path';
import fs from 'node:fs';
import type { Akad, HasilKunjungan, KolKey, ReviewStatus } from '@prisma/client';
import { RISK_FLAG_META } from './antiFraud.js';
import { drawDiagonalWatermark, drawVerifyQr } from './pdfWatermark.js';

const HASIL_LABEL: Record<HasilKunjungan, string> = {
  BAYAR: 'Bayar Lunas/Sebagian',
  JANJI: 'Janji Bayar',
  TIDAKADA: 'Tidak di Tempat',
  TOLAK: 'Menolak/Kabur',
};

const KOL_LABEL: Record<KolKey, string> = {
  K1: 'Lancar', K2: 'DPK', K3: 'Kurang Lancar', K4: 'Diragukan', K5: 'Macet',
};

const AKAD_LABEL: Record<Akad, string> = {
  MURABAHAH: 'Murabahah', MUSYARAKAH: 'Musyarakah',
  IJARAH: 'Ijarah', MUSYARAKAH_MUTANAQISAH: 'Musyarakah Mutanaqisah',
  ISTISHNA: 'Istishna',
};

const RP = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

const COLORS = {
  ink: '#1d2924',
  ink2: '#586a62',
  accent: '#1f8a5b',
  gold: '#b78b2a',
  rule: '#d2dad6',
  bg: '#f6f8f7',
};

interface PdfInput {
  kunjungan: {
    id: string;
    catatan: string;
    lokasi: string;
    jam: string;
    tanggal: Date;
    nominal: bigint;
    hasil: HasilKunjungan;
    valid: boolean;
    lat: number | null;
    lng: number | null;
    fotos: { path: string }[];
    riskScore: number;
    riskFlags: string[];
    reviewStatus: ReviewStatus;
    reviewNote: string | null;
    reviewedAt: Date | null;
  };
  reviewer?: { nama: string; username: string } | null;
  petugas: { kode: string; nama: string; wilayah: string; hp: string };
  nasabah: {
    kode: string; nama: string; alamat: string; hp: string;
    kol: KolKey; akad: Akad; dpd: number;
    sisa: bigint; angsuran: bigint;
  };
  branch: { kode: string; nama: string; alamat: string | null };
  // BW — optional verification QR PNG buffer + diagonal watermark trigger.
  verifyQr?: Buffer | null;
}

export function renderKunjunganPdf(input: PdfInput): InstanceType<typeof PDFDocument> {
  const doc = new PDFDocument({
    size: 'A4', margin: 44,
    info: {
      Title: `Laporan Kunjungan ${input.kunjungan.id}`,
      Author: 'Bank Syariah Nasional',
      Subject: 'Laporan Kunjungan Penagihan',
    },
  });

  // BW — diagonal watermark drawn FIRST so the rest of the content sits on
  // top. Re-applied on every new page via pageAdded event so multi-page
  // PDFs (rare here, but possible with many fotos) stay protected.
  drawDiagonalWatermark(doc, input.branch.kode);
  doc.on('pageAdded', () => drawDiagonalWatermark(doc, input.branch.kode));

  // ---- Header (letterhead) ----
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.fillColor(COLORS.accent).rect(doc.page.margins.left, doc.page.margins.top, pageWidth, 64).fill();

  doc.fillColor('white')
    .font('Helvetica-Bold').fontSize(18)
    .text('BANK SYARIAH NASIONAL', doc.page.margins.left + 18, doc.page.margins.top + 16);
  doc.fillColor('#e9b949').font('Helvetica').fontSize(10)
    .text(input.branch.nama, doc.page.margins.left + 18, doc.page.margins.top + 38);
  if (input.branch.alamat) {
    doc.fillColor('#dff0e7').fontSize(9).text(input.branch.alamat,
      doc.page.margins.left + 18, doc.page.margins.top + 50);
  }
  doc.fillColor('white').font('Helvetica-Bold').fontSize(11)
    .text('LAPORAN KUNJUNGAN', doc.page.margins.left,
      doc.page.margins.top + 22, { width: pageWidth - 18, align: 'right' });
  doc.font('Helvetica').fontSize(9)
    .text(input.kunjungan.id, doc.page.margins.left,
      doc.page.margins.top + 38, { width: pageWidth - 18, align: 'right' });

  doc.fillColor(COLORS.ink);
  let y = doc.page.margins.top + 84;

  // ---- Tanggal & hasil ----
  const tanggalStr = input.kunjungan.tanggal.toLocaleString('id-ID', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.ink2)
    .text('TANGGAL & WAKTU', doc.page.margins.left, y);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.ink)
    .text(tanggalStr, doc.page.margins.left, y + 12);

  const hasilColor = input.kunjungan.hasil === 'BAYAR' ? COLORS.accent
    : input.kunjungan.hasil === 'JANJI' ? '#c39b1d'
    : input.kunjungan.hasil === 'TOLAK' ? '#bb392c' : COLORS.ink2;
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.ink2)
    .text('HASIL KUNJUNGAN', doc.page.margins.left + pageWidth / 2, y);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(hasilColor)
    .text(HASIL_LABEL[input.kunjungan.hasil], doc.page.margins.left + pageWidth / 2, y + 12);

  y += 40;

  // ---- Nasabah box ----
  drawSectionHeader(doc, 'NASABAH', y);
  y += 22;
  const colW = pageWidth / 2 - 8;
  const colRight = doc.page.margins.left + colW + 16;
  drawField(doc, 'Nama', input.nasabah.nama, doc.page.margins.left, y, colW);
  drawField(doc, 'Kode', input.nasabah.kode, colRight, y, colW);
  y += 36;
  drawField(doc, 'Alamat', input.nasabah.alamat, doc.page.margins.left, y, pageWidth);
  y += 36;
  drawField(doc, 'No. HP', input.nasabah.hp, doc.page.margins.left, y, colW);
  drawField(doc, 'Kolektabilitas', `${KOL_LABEL[input.nasabah.kol]}${input.nasabah.dpd > 0 ? ` · ${input.nasabah.dpd} hari` : ''}`,
    colRight, y, colW);
  y += 36;
  drawField(doc, 'Akad', AKAD_LABEL[input.nasabah.akad], doc.page.margins.left, y, colW);
  drawField(doc, 'Outstanding · Angsuran',
    `${RP(Number(input.nasabah.sisa))}  ·  ${RP(Number(input.nasabah.angsuran))}/bln`,
    colRight, y, colW);
  y += 44;

  // ---- Petugas + lokasi box ----
  drawSectionHeader(doc, 'PETUGAS & LOKASI', y);
  y += 22;
  drawField(doc, 'Petugas', `${input.petugas.nama} (${input.petugas.kode})`, doc.page.margins.left, y, colW);
  drawField(doc, 'Wilayah Binaan', input.petugas.wilayah, colRight, y, colW);
  y += 36;
  drawField(doc, 'Lokasi Kunjungan', input.kunjungan.lokasi, doc.page.margins.left, y, pageWidth);
  y += 36;
  const gpsText = input.kunjungan.lat != null && input.kunjungan.lng != null
    ? `${input.kunjungan.lat.toFixed(5)}, ${input.kunjungan.lng.toFixed(5)}`
    : 'tidak tercatat';
  drawField(doc, 'Koordinat GPS', gpsText, doc.page.margins.left, y, colW);
  drawField(doc, 'Validasi GPS',
    input.kunjungan.valid ? '✓ Sesuai lokasi nasabah' : '⚠ Di luar radius',
    colRight, y, colW);
  y += 44;

  // ---- Hasil ----
  drawSectionHeader(doc, 'HASIL & PEMBAYARAN', y);
  y += 22;
  drawField(doc, 'Hasil', HASIL_LABEL[input.kunjungan.hasil], doc.page.margins.left, y, colW);
  drawField(doc, 'Pembayaran Diterima',
    input.kunjungan.nominal > 0n ? RP(Number(input.kunjungan.nominal)) : '—',
    colRight, y, colW);
  y += 44;

  // ---- Anti-fraud flags (when any rule fired) ----
  if (input.kunjungan.riskFlags.length > 0) {
    drawSectionHeader(doc, 'ANTI-FRAUD · PERLU REVIEW', y);
    y += 22;
    doc.fillColor('#bb392c').font('Helvetica-Bold').fontSize(10)
      .text(`Skor risiko: ${input.kunjungan.riskScore}`, doc.page.margins.left, y);
    y += 16;
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.ink);
    for (const flag of input.kunjungan.riskFlags) {
      const meta = RISK_FLAG_META[flag];
      const label = meta?.label ?? flag;
      const hint = meta?.hint ?? '';
      doc.font('Helvetica-Bold').fillColor('#bb392c').text(`• ${label}`,
        doc.page.margins.left, y, { continued: !!hint });
      if (hint) {
        doc.font('Helvetica').fillColor(COLORS.ink2).text(` — ${hint}`);
      }
      y = doc.y + 4;
    }
    y += 10;
  }

  // ---- Review status (always shown, makes audit trail visible) ----
  drawSectionHeader(doc, 'STATUS REVIEW', y);
  y += 22;
  const statusColor =
    input.kunjungan.reviewStatus === 'APPROVED' ? COLORS.accent
    : input.kunjungan.reviewStatus === 'REJECTED' ? '#bb392c'
    : '#c39b1d';
  const statusLabel =
    input.kunjungan.reviewStatus === 'APPROVED' ? 'Disetujui'
    : input.kunjungan.reviewStatus === 'REJECTED' ? 'Ditolak'
    : 'Menunggu review';
  doc.font('Helvetica-Bold').fontSize(11).fillColor(statusColor)
    .text(statusLabel, doc.page.margins.left, y);
  if (input.reviewer && input.kunjungan.reviewedAt) {
    const ts = input.kunjungan.reviewedAt.toLocaleString('id-ID');
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.ink2)
      .text(`oleh ${input.reviewer.nama} (${input.reviewer.username}) · ${ts}`,
        doc.page.margins.left, y + 14);
  }
  if (input.kunjungan.reviewNote) {
    y += 32;
    doc.font('Helvetica-Oblique').fontSize(10).fillColor(COLORS.ink)
      .text(`"${input.kunjungan.reviewNote}"`, doc.page.margins.left, y,
        { width: pageWidth, lineGap: 2 });
    y = doc.y;
  } else {
    y += 28;
  }
  y += 16;

  // ---- Catatan ----
  drawSectionHeader(doc, 'CATATAN PETUGAS', y);
  y += 22;
  doc.fillColor(COLORS.ink).font('Helvetica').fontSize(10);
  doc.text(input.kunjungan.catatan || '—', doc.page.margins.left, y, {
    width: pageWidth,
    align: 'left',
    lineGap: 3,
  });

  // ---- Foto strip (filenames only; embed photo blobs only if local files exist
  //      and are reasonably small to keep PDF compact + avoid embedding deleted files)
  const valid = input.kunjungan.fotos
    .map(f => path.resolve(process.cwd(), f.path))
    .filter(p => fs.existsSync(p) && fs.statSync(p).size < 4 * 1024 * 1024)
    .slice(0, 3);
  if (valid.length > 0) {
    y = doc.y + 24;
    drawSectionHeader(doc, 'FOTO BUKTI', y);
    y += 22;
    const thumbW = (pageWidth - 16) / 3;
    const thumbH = 110;
    valid.forEach((p, i) => {
      try {
        doc.image(p, doc.page.margins.left + i * (thumbW + 8), y,
          { fit: [thumbW, thumbH], align: 'center' });
        doc.lineWidth(0.5).strokeColor(COLORS.rule)
          .rect(doc.page.margins.left + i * (thumbW + 8), y, thumbW, thumbH).stroke();
      } catch { /* skip unreadable image */ }
    });
  }

  // ---- Footer ----
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.ink2);
  const footY = doc.page.height - doc.page.margins.bottom - 24;
  doc.text(`Dicetak oleh sistem BSN Lacak — ${new Date().toLocaleString('id-ID')}`,
    doc.page.margins.left, footY);
  doc.text(`Dokumen rahasia · ${input.branch.kode}`,
    doc.page.margins.left, footY, { align: 'right', width: pageWidth });

  if (input.verifyQr) {
    drawVerifyQr(doc, input.verifyQr);
  }

  doc.end();
  return doc;
}

function drawSectionHeader(doc: any, label: string, y: number) {
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.fillColor(COLORS.bg).rect(doc.page.margins.left, y, pageWidth, 18).fill();
  doc.fillColor(COLORS.accent).font('Helvetica-Bold').fontSize(8.5)
    .text(label, doc.page.margins.left + 8, y + 5);
  doc.fillColor(COLORS.ink);
}

function drawField(doc: any, label: string, value: string, x: number, y: number, w: number) {
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.ink2)
    .text(label.toUpperCase(), x, y, { width: w });
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.ink)
    .text(value || '—', x, y + 12, { width: w });
}
