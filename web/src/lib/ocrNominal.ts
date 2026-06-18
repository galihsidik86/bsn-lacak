// Client-side OCR for "bukti pembayaran" photos. Lazy-loads Tesseract.js
// only when the user actually clicks the "Baca nominal" button so the
// initial bundle isn't burdened with a 1+MB language pack.
//
// Heuristic: run OCR, then pick the largest numeric token that looks like
// rupiah. Strips thousands separators (. and ,) but keeps the integer.

export interface OcrResult {
  nominal: number | null;
  text: string;
  confidence: number;
}

export async function ocrLargestRupiah(image: File | Blob): Promise<OcrResult> {
  // Dynamic import — webpack/vite will code-split this away from main.
  const tesseract = await import('tesseract.js');
  const result = await tesseract.recognize(image, 'eng', {
    // Silently swallow tesseract's progress events. We DON'T want to log
    // every dot to the console in production.
    logger: () => undefined,
  });

  const text = result.data.text ?? '';
  const confidence = result.data.confidence ?? 0;

  // Find candidates that look like rupiah. Accept "Rp 1.250.000",
  // "1,250,000", "Rp1250000", etc. Strip thousands separators (both
  // dot and comma) and convert. Cap at 999,999,999,999 to avoid OCR
  // garbage like "11111111111111111".
  const candidates: number[] = [];
  const re = /(?:rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})+|\d{4,})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const stripped = m[1].replace(/[.,]/g, '');
    const n = Number.parseInt(stripped, 10);
    if (Number.isFinite(n) && n >= 1000 && n <= 999_999_999_999) {
      candidates.push(n);
    }
  }
  const nominal = candidates.length === 0 ? null : Math.max(...candidates);
  return { nominal, text, confidence };
}
