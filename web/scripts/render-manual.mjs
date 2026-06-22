// Render docs/MANUAL_PENGGUNAAN.md → HTML + PDF.
//
// - HTML: standalone single file, screenshots embedded via base64 data URIs so
//   it travels as one file.
// - PDF: rendered with Playwright (Chromium) using A4 + print-friendly CSS.
//
// Usage: node web/scripts/render-manual.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, '..', '..', 'docs');
const mdPath = resolve(docsDir, 'MANUAL_PENGGUNAAN.md');
const htmlPath = resolve(docsDir, 'MANUAL_PENGGUNAAN.html');
const pdfPath = resolve(docsDir, 'MANUAL_PENGGUNAAN.pdf');

const CSS = `
  :root {
    --ink: #1f2a37;
    --ink-3: #4b5563;
    --muted: #6b7280;
    --accent: #047857;
    --accent-soft: #ecfdf5;
    --line: #e5e7eb;
    --code-bg: #f3f4f6;
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
    color: var(--ink);
    line-height: 1.55;
    max-width: 880px;
    margin: 0 auto;
    padding: 48px 56px 80px;
    background: #fff;
    font-size: 14.5px;
  }
  h1, h2, h3 { color: var(--ink); line-height: 1.25; }
  h1 {
    font-size: 30px;
    margin: 0 0 6px;
    padding-bottom: 16px;
    border-bottom: 3px solid var(--accent);
  }
  h2 {
    font-size: 22px;
    margin: 40px 0 12px;
    padding-top: 12px;
    page-break-before: always;
  }
  h2:first-of-type { page-break-before: avoid; }
  h3 { font-size: 16px; margin: 24px 0 8px; }
  p { margin: 10px 0; }
  ul, ol { padding-left: 24px; margin: 10px 0; }
  li { margin: 4px 0; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  hr { border: 0; border-top: 1px solid var(--line); margin: 28px 0; }
  blockquote {
    margin: 14px 0;
    padding: 10px 16px;
    border-left: 3px solid var(--accent);
    background: var(--accent-soft);
    color: var(--ink-3);
    border-radius: 4px;
  }
  blockquote p { margin: 4px 0; }
  code {
    font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace;
    font-size: 0.88em;
    background: var(--code-bg);
    padding: 1px 6px;
    border-radius: 4px;
  }
  pre {
    background: var(--code-bg);
    border-radius: 8px;
    padding: 14px 16px;
    overflow-x: auto;
    page-break-inside: avoid;
  }
  pre code { background: none; padding: 0; font-size: 0.9em; }
  img {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 16px auto;
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
    page-break-inside: avoid;
  }
  table { border-collapse: collapse; margin: 14px 0; width: 100%; }
  th, td { border: 1px solid var(--line); padding: 8px 10px; text-align: left; }
  th { background: var(--accent-soft); }
  .cover {
    text-align: center;
    padding: 80px 0 60px;
    border-bottom: 3px solid var(--accent);
    margin-bottom: 24px;
  }
  .cover .title { font-size: 36px; font-weight: 700; margin: 0; color: var(--accent); }
  .cover .sub { font-size: 16px; color: var(--muted); margin-top: 8px; }
  .cover .meta { font-size: 12.5px; color: var(--muted); margin-top: 24px; }
  @page { size: A4; margin: 18mm 16mm; }
  @media print {
    body { padding: 0; max-width: none; }
    h2 { page-break-before: always; }
    h2:first-of-type { page-break-before: avoid; }
  }
`;

async function embedImages(html, baseDir) {
  // Inline <img src="manual/screenshots/foo.png"> as data: URIs so the HTML
  // file is self-contained.
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
          : src.toLowerCase().endsWith('.jpg') || src.toLowerCase().endsWith('.jpeg') ? 'image/jpeg'
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

// Strip the original H1 — we'll replace it with a cover block.
const noTitle = md.replace(/^#\s+.*\n/, '');
const bodyHtml = marked.parse(noTitle, { gfm: true, breaks: false });
const embedded = await embedImages(bodyHtml, docsDir);

const today = new Date().toLocaleDateString('id-ID',
  { day: 'numeric', month: 'long', year: 'numeric' });

const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <title>Manual Penggunaan — BSN Lacak</title>
  <style>${CSS}</style>
</head>
<body>
  <div class="cover">
    <div class="title">Manual Penggunaan</div>
    <div class="sub">BSN Lacak — Sistem Tracking Penagihan</div>
    <div class="meta">Bank Syariah Nasional · Diperbarui ${today}</div>
  </div>
  ${embedded}
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
  margin: { top: '18mm', right: '16mm', bottom: '20mm', left: '16mm' },
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: `
    <div style="font-size:9px; color:#6b7280; width:100%; padding:0 16mm; display:flex; justify-content:space-between;">
      <span>BSN Lacak · Manual Penggunaan</span>
      <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
    </div>`,
});
await browser.close();
console.log('PDF  →', pdfPath);
