// Per-nasabah GDPR-style export — a single A4 PDF covering profile +
// payment history + visit history. Hand-laid in pdfkit, same approach as
// pdfKunjungan to avoid a HTML engine dep.

import PDFDocument from 'pdfkit';

const COLORS = {
  ink: '#1d2924',
  ink2: '#586a62',
  accent: '#1f8a5b',
  gold: '#b78b2a',
  rule: '#d2dad6',
  bg: '#f6f8f7',
};

const RP = (n: number | bigint) => 'Rp ' + Number(n).toLocaleString('id-ID');

interface ExportInput {
  generatedAt: Date;
  nasabah: {
    id: string; kode: string; nama: string; alamat: string; hp: string;
    kol: string; akad: string; plafon: bigint; tenor: number;
    angsuran: bigint; sisa: bigint; dpd: number; active: boolean;
    lat: number | null; lng: number | null;
  };
  petugas: { kode: string; nama: string };
  branch: { kode: string; nama: string };
  pembayaran: Array<{ tanggal: Date; jam: string; nominal: bigint; metode: string; status: string }>;
  kunjungan: Array<{ tanggal: Date; jam: string; hasil: string; nominal: bigint; reviewStatus: string; catatan: string }>;
}

export function renderNasabahExportPdf(input: ExportInput): InstanceType<typeof PDFDocument> {
  const doc = new PDFDocument({
    size: 'A4', margin: 44,
    info: {
      Title: `Data Nasabah ${input.nasabah.kode}`,
      Author: 'Bank Syariah Nasional',
      Subject: 'Ringkasan data nasabah binaan',
    },
  });

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;

  // Header strip.
  doc.fillColor(COLORS.accent).rect(left, doc.page.margins.top, pageWidth, 60).fill();
  doc.fillColor('white').font('Helvetica-Bold').fontSize(15)
    .text('BANK SYARIAH NASIONAL', left + 16, doc.page.margins.top + 14);
  doc.fillColor('#dff0e7').font('Helvetica').fontSize(9.5)
    .text(`${input.branch.nama} · ${input.branch.kode}`, left + 16, doc.page.margins.top + 33);
  doc.fillColor('#e9b949').font('Helvetica-Bold').fontSize(11)
    .text('DATA NASABAH BINAAN', left, doc.page.margins.top + 18, { width: pageWidth - 14, align: 'right' });
  doc.fillColor('white').font('Helvetica').fontSize(9)
    .text(`Dicetak ${input.generatedAt.toLocaleString('id-ID')}`, left, doc.page.margins.top + 38, { width: pageWidth - 14, align: 'right' });

  let y = doc.page.margins.top + 76;
  doc.fillColor(COLORS.ink);

  // Profile block.
  sectionHeader(doc, 'PROFIL', y, pageWidth, left);
  y += 22;
  field(doc, 'Nama', input.nasabah.nama, left, y, pageWidth / 2 - 8);
  field(doc, 'Kode', input.nasabah.kode, left + pageWidth / 2 + 8, y, pageWidth / 2 - 8);
  y += 38;
  field(doc, 'Alamat', input.nasabah.alamat, left, y, pageWidth);
  y += 38;
  field(doc, 'HP', input.nasabah.hp, left, y, pageWidth / 2 - 8);
  field(doc, 'Status', input.nasabah.active ? 'Aktif' : 'Non-aktif',
    left + pageWidth / 2 + 8, y, pageWidth / 2 - 8);
  y += 38;
  const gps = (input.nasabah.lat != null && input.nasabah.lng != null)
    ? `${input.nasabah.lat.toFixed(5)}, ${input.nasabah.lng.toFixed(5)}` : 'tidak tercatat';
  field(doc, 'Koordinat', gps, left, y, pageWidth / 2 - 8);
  field(doc, 'Petugas Penagih', `${input.petugas.nama} (${input.petugas.kode})`,
    left + pageWidth / 2 + 8, y, pageWidth / 2 - 8);
  y += 50;

  // Kredit block.
  sectionHeader(doc, 'PEMBIAYAAN', y, pageWidth, left);
  y += 22;
  field(doc, 'Akad', input.nasabah.akad, left, y, pageWidth / 2 - 8);
  field(doc, 'Kolektabilitas', input.nasabah.kol + (input.nasabah.dpd > 0 ? ` · DPD ${input.nasabah.dpd}` : ''),
    left + pageWidth / 2 + 8, y, pageWidth / 2 - 8);
  y += 38;
  field(doc, 'Plafon', RP(input.nasabah.plafon), left, y, pageWidth / 3);
  field(doc, 'Angsuran/bln', RP(input.nasabah.angsuran), left + pageWidth / 3, y, pageWidth / 3);
  field(doc, 'Outstanding', RP(input.nasabah.sisa), left + 2 * pageWidth / 3, y, pageWidth / 3);
  y += 38;
  field(doc, 'Tenor', `${input.nasabah.tenor} bulan`, left, y, pageWidth / 3);
  y += 38;

  // Pembayaran table.
  if (input.pembayaran.length > 0) {
    sectionHeader(doc, `RIWAYAT PEMBAYARAN (${input.pembayaran.length})`, y, pageWidth, left);
    y += 22;
    y = tableHeader(doc, ['TANGGAL', 'JAM', 'METODE', 'STATUS', 'NOMINAL'], [0.22, 0.12, 0.20, 0.18, 0.28], left, y, pageWidth);
    for (const p of input.pembayaran.slice(0, 30)) {
      if (y > doc.page.height - 100) { doc.addPage(); y = 60; }
      y = tableRow(doc, [
        p.tanggal.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }),
        p.jam, p.metode, p.status, RP(p.nominal),
      ], [0.22, 0.12, 0.20, 0.18, 0.28], left, y, pageWidth);
    }
    if (input.pembayaran.length > 30) {
      doc.fillColor(COLORS.ink2).font('Helvetica-Oblique').fontSize(9)
        .text(`… dan ${input.pembayaran.length - 30} pembayaran lainnya (dipotong agar PDF tidak terlalu panjang)`,
          left, y + 6);
      y += 18;
    }
    y += 20;
  }

  // Kunjungan table.
  if (input.kunjungan.length > 0) {
    if (y > doc.page.height - 200) { doc.addPage(); y = 60; }
    sectionHeader(doc, `RIWAYAT KUNJUNGAN (${input.kunjungan.length})`, y, pageWidth, left);
    y += 22;
    y = tableHeader(doc, ['TANGGAL', 'JAM', 'HASIL', 'REVIEW', 'NOMINAL'], [0.22, 0.12, 0.22, 0.20, 0.24], left, y, pageWidth);
    for (const k of input.kunjungan.slice(0, 30)) {
      if (y > doc.page.height - 100) { doc.addPage(); y = 60; }
      y = tableRow(doc, [
        k.tanggal.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }),
        k.jam, k.hasil, k.reviewStatus, k.nominal > 0n ? RP(k.nominal) : '—',
      ], [0.22, 0.12, 0.22, 0.20, 0.24], left, y, pageWidth);
    }
    if (input.kunjungan.length > 30) {
      doc.fillColor(COLORS.ink2).font('Helvetica-Oblique').fontSize(9)
        .text(`… dan ${input.kunjungan.length - 30} kunjungan lainnya`, left, y + 6);
      y += 18;
    }
  }

  // Footer.
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.ink2);
  const footY = doc.page.height - doc.page.margins.bottom - 24;
  doc.text('Dokumen rahasia — hanya untuk keperluan internal dan permintaan resmi nasabah.',
    left, footY);
  doc.text(`${input.branch.kode} · ${input.nasabah.kode}`, left, footY, {
    align: 'right', width: pageWidth,
  });

  doc.end();
  return doc;
}

function sectionHeader(doc: any, label: string, y: number, pageWidth: number, left: number) {
  doc.fillColor(COLORS.bg).rect(left, y, pageWidth, 18).fill();
  doc.fillColor(COLORS.accent).font('Helvetica-Bold').fontSize(9)
    .text(label, left + 8, y + 5);
  doc.fillColor(COLORS.ink);
}

function field(doc: any, label: string, value: string, x: number, y: number, w: number) {
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.ink2)
    .text(label.toUpperCase(), x, y, { width: w });
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.ink)
    .text(value || '—', x, y + 12, { width: w });
}

function tableHeader(doc: any, cols: string[], weights: number[], left: number, y: number, pageWidth: number): number {
  doc.fillColor(COLORS.ink2).font('Helvetica-Bold').fontSize(8);
  let x = left;
  for (let i = 0; i < cols.length; i++) {
    const w = pageWidth * weights[i];
    doc.text(cols[i], x, y, { width: w });
    x += w;
  }
  doc.lineWidth(0.4).strokeColor(COLORS.rule)
    .moveTo(left, y + 12).lineTo(left + pageWidth, y + 12).stroke();
  return y + 16;
}

function tableRow(doc: any, cells: string[], weights: number[], left: number, y: number, pageWidth: number): number {
  doc.fillColor(COLORS.ink).font('Helvetica').fontSize(9);
  let x = left;
  for (let i = 0; i < cells.length; i++) {
    const w = pageWidth * weights[i];
    doc.text(cells[i] || '—', x, y, { width: w });
    x += w;
  }
  return y + 14;
}
