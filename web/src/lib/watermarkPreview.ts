// Client-side watermark for the preview thumbnail in MLapor.
// IMPORTANT: this re-encodes via canvas and therefore loses EXIF, so we
// do NOT use it as the upload payload. The form keeps the original File
// for upload; the server runs EXIF validation + applies the definitive
// watermark itself.

interface Info {
  petugasNama: string;
  nasabahNama: string;
  timestamp: Date;
  lat?: number | null;
  lng?: number | null;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image_decode_failed'));
    img.src = src;
  });
}

function fmtTs(d: Date): string {
  return d.toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export async function makeWatermarkedPreview(file: File, info: Info): Promise<string> {
  const objUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objUrl);
    // Cap dimensions so the preview isn't a 12MP encode in memory.
    const MAX = 1280;
    const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const W = Math.round(img.naturalWidth * scale);
    const H = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return objUrl;
    ctx.drawImage(img, 0, 0, W, H);

    // Watermark band — same visual language as the server-side stamp so
    // what the petugas sees in preview matches what supervisors see later.
    const bandH = Math.max(110, Math.round(H * 0.13));
    const padX = Math.round(W * 0.03);
    const grad = ctx.createLinearGradient(0, H - bandH, 0, H);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.4, 'rgba(0,0,0,0.6)');
    grad.addColorStop(1, 'rgba(0,0,0,0.88)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, H - bandH, W, bandH);

    const fsTitle = Math.max(14, Math.round(bandH * 0.22));
    const fsSub = Math.max(12, Math.round(bandH * 0.18));
    const fsCoord = Math.max(10, Math.round(bandH * 0.15));

    ctx.fillStyle = 'white';
    ctx.textBaseline = 'top';
    ctx.font = `700 ${fsTitle}px "Plus Jakarta Sans", Arial, sans-serif`;
    let y = H - bandH + Math.round(bandH * 0.18);
    ctx.fillText(`BSN Lacak • ${info.petugasNama}`, padX, y);

    y += Math.round(fsTitle * 1.25);
    ctx.font = `500 ${fsSub}px "Plus Jakarta Sans", Arial, sans-serif`;
    ctx.fillText(`${info.nasabahNama} • ${fmtTs(info.timestamp)}`, padX, y);

    y += Math.round(fsSub * 1.3);
    ctx.font = `500 ${fsCoord}px "Plus Jakarta Sans", Arial, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const gps = (typeof info.lat === 'number' && typeof info.lng === 'number')
      ? `GPS ${info.lat.toFixed(5)}, ${info.lng.toFixed(5)}`
      : 'GPS tidak tersedia';
    ctx.fillText(gps, padX, y);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return dataUrl;
  } catch {
    return objUrl;
  } finally {
    // The object URL is replaced by the data URL on success; revoke it.
    setTimeout(() => URL.revokeObjectURL(objUrl), 0);
  }
}
