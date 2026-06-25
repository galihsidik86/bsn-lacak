// Render docs/SPESIFIKASI_INFRASTRUKTUR.md → HTML + PDF.
//
// Format proposal — A4 with cover page, section breaks, page numbers
// in footer, dan styling yang formal cocok untuk dilampirkan ke
// proposal procurement.
//
// Usage: node web/scripts/render-spek.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { marked } from 'marked';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, '..', '..', 'docs');
const mdPath = resolve(docsDir, 'SPESIFIKASI_INFRASTRUKTUR.md');
const htmlPath = resolve(docsDir, 'SPESIFIKASI_INFRASTRUKTUR.html');
const pdfPath = resolve(docsDir, 'SPESIFIKASI_INFRASTRUKTUR.pdf');
const docxPath = resolve(docsDir, 'SPESIFIKASI_INFRASTRUKTUR.docx');

const CSS = `
  :root {
    --ink: #1f2a37;
    --ink-2: #374151;
    --ink-3: #4b5563;
    --muted: #6b7280;
    --accent: #047857;
    --accent-soft: #ecfdf5;
    --gold: #b45309;
    --gold-soft: #fef3c7;
    --line: #e5e7eb;
    --line-2: #d1d5db;
    --code-bg: #f3f4f6;
    --table-stripe: #fafafa;
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    font-family: 'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, sans-serif;
    color: var(--ink);
    line-height: 1.55;
    max-width: 880px;
    margin: 0 auto;
    padding: 0;
    background: #fff;
    font-size: 13.5px;
  }
  h1, h2, h3, h4 { color: var(--ink); line-height: 1.25; }
  h1 {
    font-size: 26px;
    margin: 0 0 8px;
    padding-bottom: 14px;
    border-bottom: 3px solid var(--accent);
    color: var(--accent);
  }
  h2 {
    font-size: 19px;
    margin: 36px 0 12px;
    padding-top: 10px;
    color: var(--accent);
    page-break-before: always;
    border-bottom: 1px solid var(--line);
    padding-bottom: 6px;
  }
  h2:first-of-type, .body > h2:first-child { page-break-before: avoid; }
  h3 {
    font-size: 15px;
    margin: 22px 0 8px;
    color: var(--ink);
  }
  h4 {
    font-size: 13.5px;
    margin: 16px 0 6px;
    color: var(--ink-2);
  }
  p { margin: 8px 0; }
  ul, ol { padding-left: 22px; margin: 8px 0; }
  li { margin: 3px 0; }
  a { color: var(--accent); text-decoration: none; }
  hr { border: 0; border-top: 1px solid var(--line); margin: 24px 0; }
  blockquote {
    margin: 12px 0;
    padding: 9px 14px;
    border-left: 3px solid var(--gold);
    background: var(--gold-soft);
    color: var(--ink-2);
    border-radius: 4px;
    font-size: 12.5px;
  }
  blockquote p { margin: 3px 0; }
  code {
    font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace;
    font-size: 0.86em;
    background: var(--code-bg);
    padding: 1px 5px;
    border-radius: 4px;
  }
  pre {
    background: var(--code-bg);
    border-radius: 6px;
    padding: 12px 14px;
    overflow-x: auto;
    page-break-inside: avoid;
    font-size: 11.5px;
    line-height: 1.45;
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
    color: var(--accent);
    font-weight: 700;
  }
  tbody tr:nth-child(2n) { background: var(--table-stripe); }
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
    width: 72px; height: 72px;
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
  .cover .title {
    font-size: 32px;
    font-weight: 800;
    margin: 0 0 12px;
    color: var(--accent);
    letter-spacing: -0.01em;
    line-height: 1.2;
  }
  .cover .sub {
    font-size: 17px;
    color: var(--ink-2);
    margin: 0 0 8px;
    font-weight: 600;
  }
  .cover .org {
    font-size: 14px;
    color: var(--muted);
    margin: 0;
  }
  .cover .meta {
    margin-top: 24px;
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
  .cover .meta strong { color: var(--ink); display: inline-block; min-width: 100px; }
  .cover-footer {
    width: 100%;
    border-top: 2px solid var(--accent);
    padding-top: 14px;
    font-size: 11px;
    color: var(--muted);
  }

  .body {
    padding: 32px 56px 60px;
  }

  /* PDF page setup */
  @page { size: A4; margin: 18mm 16mm 22mm; }
  @media print {
    body { padding: 0; max-width: none; }
    .body { padding: 24px 0 0; }
    .cover { min-height: 95vh; }
  }
`;

async function embedImages(html, baseDir) {
  const re = /<img([^>]*?)src="([^"]+)"([^>]*)>/g;
  const parts = [];
  let last = 0;
  let m;
  while ((m = re.exec(html)) !== null) {
    parts.push(html.slice(last, m.index));
    const [, pre, src, post] = m;
    if (/^https?:|^data:/.test(src)) {
      parts.push(m[0]);
    } else {
      try {
        const buf = await readFile(resolve(baseDir, src));
        const b64 = buf.toString('base64');
        const mime = src.toLowerCase().endsWith('.png') ? 'image/png'
          : src.toLowerCase().match(/\.(jpe?g)$/) ? 'image/jpeg'
          : 'image/png';
        parts.push(`<img${pre}src="data:${mime};base64,${b64}"${post}>`);
      } catch {
        parts.push(m[0]);
      }
    }
    last = m.index + m[0].length;
  }
  parts.push(html.slice(last));
  return parts.join('');
}

const md = await readFile(mdPath, 'utf8');
// Strip H1 + the next 2 lines (sub-title rows we render in cover instead).
const noTitle = md.replace(/^#\s+.*\n(\*\*[^\n]*\*\*\n[^\n]*\n)?/, '');
const bodyHtml = marked.parse(noTitle, { gfm: true, breaks: false });
const embedded = await embedImages(bodyHtml, docsDir);

const today = new Date().toLocaleDateString('id-ID',
  { day: 'numeric', month: 'long', year: 'numeric' });

const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <title>Spesifikasi Infrastruktur — BSN Lacak</title>
  <style>${CSS}</style>
</head>
<body>
  <div class="cover">
    <div class="cover-top">
      <div class="logo"></div>
      <div class="title">Spesifikasi<br>Kebutuhan Infrastruktur</div>
      <div class="sub">Sistem Tracking Penagihan BSN Lacak</div>
      <div class="org">Bank Syariah Nasional</div>
      <div class="meta">
        <div><strong>Dokumen</strong> SPESIFIKASI_INFRASTRUKTUR v1.0</div>
        <div><strong>Versi</strong> 1.0</div>
        <div><strong>Tanggal</strong> ${today}</div>
        <div><strong>Klasifikasi</strong> Internal — Procurement</div>
      </div>
    </div>
    <div class="cover-footer">
      Dokumen ini menetapkan spesifikasi minimum dan rekomendasi perangkat
      keras untuk operasional aplikasi BSN Lacak — siap dilampirkan ke
      proposal procurement infrastruktur.
    </div>
  </div>

  <div class="body">
    ${embedded}
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
      <span>BSN Lacak · Spesifikasi Infrastruktur</span>
      <span>v1.0 · ${today}</span>
    </div>`,
  footerTemplate: `
    <div style="font-size:8.5px; color:#9ca3af; width:100%; padding:0 16mm; display:flex; justify-content:space-between;">
      <span>Internal — Procurement</span>
      <span>Halaman <span class="pageNumber"></span> dari <span class="totalPages"></span></span>
    </div>`,
});
await browser.close();
console.log('PDF  →', pdfPath);

// Word .docx via pandoc — kalau pandoc terinstall di PATH.
// Procurement team biasanya minta versi editable Word untuk lampiran.
// Jalankan dari docsDir dengan path relatif supaya Windows path tidak
// salah parse di Haskell I/O pandoc.
const pandoc = spawnSync(
  'pandoc',
  ['SPESIFIKASI_INFRASTRUKTUR.md', '-o', 'SPESIFIKASI_INFRASTRUKTUR.docx'],
  { encoding: 'utf8', cwd: docsDir, shell: process.platform === 'win32' },
);
if (pandoc.status === 0) {
  console.log('DOCX →', docxPath);
} else {
  console.warn('DOCX → SKIPPED (pandoc tidak ditemukan / gagal).');
  console.warn('       Install: https://pandoc.org/installing.html');
  if (pandoc.stderr) console.warn('       stderr:', pandoc.stderr.trim().split('\n').slice(-2).join(' | '));
}
