// Render docs/NARASI_PRESENTASI.md → HTML + PDF.
//
// Format: A4 portrait, cover page, page numbers, styling supaya enak
// dibaca sebagai cue card saat presentasi (font lebih besar dari spec
// dokumen, line-height longgar).
//
// Usage: node web/scripts/render-narasi.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, '..', '..', 'docs');
const mdPath = resolve(docsDir, 'NARASI_PRESENTASI.md');
const htmlPath = resolve(docsDir, 'NARASI_PRESENTASI.html');
const pdfPath = resolve(docsDir, 'NARASI_PRESENTASI.pdf');

const CSS = `
  :root {
    --ink: #1c2620;
    --ink-2: #4a5a52;
    --ink-3: #7a8a82;
    --muted: #7a8a82;
    --accent: #1f8a5b;
    --accent-2: #0e5746;
    --accent-soft: #e6f4ee;
    --gold: #c79a3a;
    --gold-soft: #fbf2dc;
    --line: #dfe7e2;
    --line-2: #c9d4cd;
    --code-bg: #f3f4f6;
    --quote-bg: #fafaf6;
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    font-family: 'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, sans-serif;
    color: var(--ink);
    line-height: 1.6;
    max-width: 880px;
    margin: 0 auto;
    padding: 0;
    background: #fff;
    font-size: 13.5px;
  }
  h1, h2, h3, h4 { color: var(--ink); line-height: 1.25; }
  h1 {
    font-size: 24px;
    margin: 0 0 8px;
    padding-bottom: 12px;
    border-bottom: 3px solid var(--accent);
    color: var(--accent);
  }
  /* Setiap h2 = slide baru → page break supaya tidak ada slide yang
     dipotong di tengah saat print. */
  h2 {
    font-size: 19px;
    margin: 28px 0 10px;
    padding: 12px 0 8px;
    color: var(--accent-2);
    page-break-before: always;
    border-bottom: 1px solid var(--accent-soft);
  }
  h2:first-of-type, .body > h2:first-of-type { page-break-before: avoid; }
  h3 {
    font-size: 14.5px;
    margin: 20px 0 6px;
    color: var(--ink);
    font-weight: 700;
  }
  h4 {
    font-size: 13px;
    margin: 14px 0 4px;
    color: var(--ink-2);
  }
  p { margin: 7px 0; }
  ul, ol { padding-left: 22px; margin: 7px 0; }
  li { margin: 3px 0; }
  a { color: var(--accent); text-decoration: none; }
  hr { border: 0; border-top: 1px solid var(--line); margin: 18px 0; }

  /* Narasi block (blockquote) — bagian yang paling sering dibaca saat
     presentasi. Visual menonjol supaya gampang lock-on di tengah panik. */
  blockquote {
    margin: 10px 0;
    padding: 12px 16px;
    border-left: 4px solid var(--accent);
    background: var(--quote-bg);
    color: var(--ink);
    border-radius: 0 6px 6px 0;
    font-size: 13.5px;
    line-height: 1.65;
    page-break-inside: avoid;
  }
  blockquote p { margin: 6px 0; }
  blockquote strong { color: var(--accent-2); }

  code {
    font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace;
    font-size: 0.85em;
    background: var(--code-bg);
    padding: 1px 5px;
    border-radius: 4px;
    color: var(--accent-2);
  }
  pre {
    background: var(--code-bg);
    border-radius: 6px;
    padding: 10px 12px;
    overflow-x: auto;
    page-break-inside: avoid;
    font-size: 11.5px;
  }
  pre code { background: none; padding: 0; }

  table {
    border-collapse: collapse;
    margin: 12px 0 16px;
    width: 100%;
    page-break-inside: avoid;
    font-size: 12.5px;
  }
  th, td {
    border: 1px solid var(--line);
    padding: 7px 9px;
    text-align: left;
    vertical-align: top;
  }
  th {
    background: var(--accent-soft);
    color: var(--accent-2);
    font-weight: 700;
  }
  tbody tr:nth-child(2n) { background: #fafbfa; }
  strong { color: var(--ink); }
  em { color: var(--ink-2); }

  /* Cover page */
  .cover {
    page-break-after: always;
    padding: 120px 60px 60px;
    text-align: center;
    background: linear-gradient(180deg, var(--accent-soft) 0%, #fff 100%);
    min-height: 90vh;
    display: flex; flex-direction: column; align-items: center;
    justify-content: space-between;
  }
  .cover-top { width: 100%; }
  .cover .logo {
    display: inline-block;
    width: 76px; height: 76px;
    background: var(--accent);
    border-radius: 18px;
    margin-bottom: 28px;
    position: relative;
  }
  .cover .logo::before {
    content: '';
    position: absolute;
    inset: 16px;
    border: 3px solid #fff;
    border-radius: 6px;
    transform: rotate(45deg);
  }
  .cover .logo::after {
    content: '';
    position: absolute;
    inset: 28px;
    background: var(--gold);
    border-radius: 50%;
  }
  .cover .title {
    font-size: 30px;
    font-weight: 800;
    margin: 0 0 12px;
    color: var(--accent-2);
    letter-spacing: -0.01em;
    line-height: 1.2;
  }
  .cover .sub {
    font-size: 16px;
    color: var(--ink-2);
    margin: 0 0 8px;
    font-weight: 600;
  }
  .cover .org {
    font-size: 13px;
    color: var(--muted);
    margin: 0;
  }
  .cover .meta {
    margin-top: 22px;
    padding: 14px 22px;
    background: white;
    border-radius: 12px;
    border: 1px solid var(--line);
    display: inline-block;
    text-align: left;
    font-size: 12px;
    color: var(--ink-2);
    line-height: 1.7;
  }
  .cover .meta strong { color: var(--ink); display: inline-block; min-width: 110px; }
  .cover-footer {
    width: 100%;
    border-top: 2px solid var(--accent);
    padding-top: 14px;
    font-size: 11px;
    color: var(--muted);
  }

  .body { padding: 32px 56px 60px; }

  /* PDF page setup */
  @page { size: A4; margin: 18mm 16mm 22mm; }
  @media print {
    body { padding: 0; max-width: none; }
    .body { padding: 24px 0 0; }
    .cover { min-height: 95vh; }
  }
`;

const md = await readFile(mdPath, 'utf8');
// Buang H1 + 1 baris quote di bawah (kita render di cover sebagai title).
const noTitle = md.replace(/^#\s+[^\n]+\n+(>\s+[^\n]+\n+)?/, '');
const bodyHtml = marked.parse(noTitle, { gfm: true, breaks: false });

const today = new Date().toLocaleDateString('id-ID',
  { day: 'numeric', month: 'long', year: 'numeric' });

const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <title>Narasi Presentasi — BSN Lacak</title>
  <style>${CSS}</style>
</head>
<body>
  <div class="cover">
    <div class="cover-top">
      <div class="logo"></div>
      <div class="title">Narasi Presentasi<br>BSN Lacak</div>
      <div class="sub">Panduan Berbicara 14 Slide — Cue Card Presenter</div>
      <div class="org">PT ArtiVisi Intermedia · untuk Bank Syariah Nasional</div>
      <div class="meta">
        <div><strong>Dokumen</strong> NARASI_PRESENTASI v1.0</div>
        <div><strong>Versi</strong> 1.0</div>
        <div><strong>Tanggal</strong> ${today}</div>
        <div><strong>Klasifikasi</strong> Internal — Speaker Notes</div>
      </div>
    </div>
    <div class="cover-footer">
      Panduan berbicara per slide untuk presentasi BSN Lacak.
      Durasi target ~37 menit + 15–30 menit Q&amp;A.
      Slide jadi backdrop, narasi jadi konten — jangan dibaca kata-per-kata.
    </div>
  </div>

  <div class="body">
    ${bodyHtml}
  </div>
</body>
</html>`;

await writeFile(htmlPath, html, 'utf8');
console.log('HTML →', htmlPath);

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.setContent(html, { waitUntil: 'load' });
await page.emulateMedia({ media: 'print' });
await page.pdf({
  path: pdfPath,
  format: 'A4',
  printBackground: true,
  margin: { top: '18mm', right: '16mm', bottom: '22mm', left: '16mm' },
  displayHeaderFooter: true,
  headerTemplate: `
    <div style="font-size:8.5px; color:#9ca3af; width:100%; padding:0 16mm; display:flex; justify-content:space-between;">
      <span>BSN Lacak · Narasi Presentasi</span>
      <span>v1.0 · ${today}</span>
    </div>`,
  footerTemplate: `
    <div style="font-size:8.5px; color:#9ca3af; width:100%; padding:0 16mm; display:flex; justify-content:space-between;">
      <span>Internal — Speaker Notes</span>
      <span>Halaman <span class="pageNumber"></span> dari <span class="totalPages"></span></span>
    </div>`,
});
await browser.close();
console.log('PDF  →', pdfPath);
