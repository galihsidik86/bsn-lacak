import sharp from 'sharp';
import { logger } from './logger.js';

// Server-side watermark stamped over the bottom of every uploaded photo.
// Done server-side (not in the browser) because canvas re-encode would
// strip EXIF and break the photo_no_exif / photo_stale fraud checks.

interface Info {
  petugasNama: string;
  nasabahNama: string;
  timestamp: Date;
  lat?: number | null;
  lng?: number | null;
}

function xml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtTs(d: Date): string {
  return d.toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export async function watermarkPhoto(buf: Buffer, info: Info): Promise<Buffer> {
  let img;
  try {
    img = sharp(buf, { failOn: 'truncated' });
  } catch (e) {
    logger.warn({ err: String(e) }, 'watermark_sharp_init_fail');
    return buf;
  }

  let W = 1080;
  let H = 1080;
  try {
    const meta = await img.metadata();
    W = meta.width ?? W;
    H = meta.height ?? H;
  } catch {
    return buf;
  }

  const bandH = Math.max(140, Math.round(H * 0.11));
  const padX = Math.round(W * 0.025);
  const fsTitle = Math.round(bandH * 0.24);
  const fsSub = Math.round(bandH * 0.20);
  const fsCoord = Math.round(bandH * 0.17);

  const ts = fmtTs(info.timestamp);
  const gps = (typeof info.lat === 'number' && typeof info.lng === 'number')
    ? `GPS ${info.lat.toFixed(5)}, ${info.lng.toFixed(5)}`
    : 'GPS tidak tersedia';

  // Solid 88%-opaque dark band so text stays legible over any background.
  const svg = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="black" stop-opacity="0"/>
          <stop offset="0.4" stop-color="black" stop-opacity="0.6"/>
          <stop offset="1" stop-color="black" stop-opacity="0.85"/>
        </linearGradient>
      </defs>
      <rect x="0" y="${H - bandH}" width="${W}" height="${bandH}" fill="url(#g)"/>
      <text x="${padX}" y="${H - bandH + fsTitle * 1.3}" font-family="Arial, sans-serif" font-size="${fsTitle}" font-weight="700" fill="white">BSN Lacak • ${xml(info.petugasNama)}</text>
      <text x="${padX}" y="${H - bandH + fsTitle * 1.3 + fsSub * 1.35}" font-family="Arial, sans-serif" font-size="${fsSub}" fill="white">${xml(info.nasabahNama)} • ${xml(ts)}</text>
      <text x="${padX}" y="${H - bandH + fsTitle * 1.3 + fsSub * 1.35 + fsCoord * 1.35}" font-family="Arial, sans-serif" font-size="${fsCoord}" fill="rgba(255,255,255,0.85)">${xml(gps)}</text>
    </svg>`,
    'utf-8',
  );

  try {
    return await img
      .rotate() // auto-orient from EXIF before compositing
      .composite([{ input: svg, top: 0, left: 0 }])
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
  } catch (e) {
    logger.warn({ err: String(e) }, 'watermark_composite_fail');
    return buf;
  }
}
