// Generate semua varian icon Android + PWA dari 2 SVG sumber:
//   resources/icon-foreground.svg → ic_launcher_foreground.png (adaptive
//     foreground; logo dalam safe-zone 66%, no background)
//   resources/icon-legacy.svg     → ic_launcher.png + ic_launcher_round.png
//     (Android <8 dipakai langsung; logo + background built-in)
//
// Sekalian regen PWA icons web/public/pwa-{192,512}x.png supaya brand
// konsisten antara PWA browser dan APK native.
//
// Jalankan: node scripts/generate-icons.mjs (dari web/).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(__dirname, '..');

// Sizing: foreground perlu render lebih besar (108dp at xxxhdpi = 432px)
// supaya saat OS scale ke densitas lain tetap sharp. Legacy ic_launcher
// pakai 48dp base (mdpi = 48 px), tripled tiap step.
const ADAPTIVE_SIZES = [
  { dir: 'mipmap-mdpi',    px: 108 },
  { dir: 'mipmap-hdpi',    px: 162 },
  { dir: 'mipmap-xhdpi',   px: 216 },
  { dir: 'mipmap-xxhdpi',  px: 324 },
  { dir: 'mipmap-xxxhdpi', px: 432 },
];
const LEGACY_SIZES = [
  { dir: 'mipmap-mdpi',    px: 48 },
  { dir: 'mipmap-hdpi',    px: 72 },
  { dir: 'mipmap-xhdpi',   px: 96 },
  { dir: 'mipmap-xxhdpi',  px: 144 },
  { dir: 'mipmap-xxxhdpi', px: 192 },
];

const RES_BASE = join(WEB, 'android/app/src/main/res');

async function renderSvgToPng(svgPath, outPath, sizePx, opts = {}) {
  const svg = await readFile(svgPath);
  await mkdir(dirname(outPath), { recursive: true });
  // Sharp svg renderer (resvg-based) — density default 72 dpi; naikkan
  // di file kecil supaya tipis stroke tidak hilang saat downsample.
  // Density dipilih supaya rasterized SVG ~2x target output (anti-alias
  // smooth) tanpa hit sharp pixel limit (~256M default). 72dpi = output
  // size yang sama dengan viewBox SVG, jadi rumus: density = 72 * (target/viewBoxSize) * 2.
  const VIEWBOX = 1024;
  const density = Math.min(2400, Math.round(72 * (sizePx / VIEWBOX) * 2));
  let pipe = sharp(svg, { density })
    .resize(sizePx, sizePx, { fit: 'contain', background: opts.bg ?? { r: 0, g: 0, b: 0, alpha: 0 } });
  // PNG dengan kompresi maksimum (level 9) supaya APK tidak gendut.
  pipe = pipe.png({ compressionLevel: 9, palette: false });
  await pipe.toFile(outPath);
  console.log(`✓ ${outPath} ${sizePx}px`);
}

async function main() {
  const fgSvg = join(WEB, 'resources/icon-foreground.svg');
  const lgSvg = join(WEB, 'resources/icon-legacy.svg');

  // Adaptive foreground PNGs
  for (const s of ADAPTIVE_SIZES) {
    await renderSvgToPng(
      fgSvg,
      join(RES_BASE, s.dir, 'ic_launcher_foreground.png'),
      s.px,
    );
  }

  // Legacy ic_launcher + ic_launcher_round (same source, square + round
  // dihandle oleh launcher dengan masking — file PNG tetap kotak,
  // launcher yang crop ke lingkaran sesuai mask Android-nya).
  for (const s of LEGACY_SIZES) {
    await renderSvgToPng(
      lgSvg,
      join(RES_BASE, s.dir, 'ic_launcher.png'),
      s.px,
    );
    await renderSvgToPng(
      lgSvg,
      join(RES_BASE, s.dir, 'ic_launcher_round.png'),
      s.px,
    );
  }

  // PWA icons — match brand baru di browser juga.
  const pub = join(WEB, 'public');
  await renderSvgToPng(lgSvg, join(pub, 'pwa-192x192.png'), 192);
  await renderSvgToPng(lgSvg, join(pub, 'pwa-512x512.png'), 512);
  // Favicon SVG kita update juga supaya tab browser ikut ganti.
  const fav = await readFile(lgSvg, 'utf8');
  await writeFile(join(pub, 'favicon.svg'), fav);
  console.log(`✓ ${join(pub, 'favicon.svg')} updated`);

  console.log('\nDone. Jalankan `npx cap sync android` untuk copy ke APK.');
}

main().catch(e => { console.error(e); process.exit(1); });
