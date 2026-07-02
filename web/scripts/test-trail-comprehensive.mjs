// Comprehensive trail smoke test — cek berbagai skenario supaya yakin
// tidak ada regresi lain setelah fix oklch (commit 699d8dd).
//
// Skenario:
//  1. Trail hari ini (default, live-refresh)
//  2. Trail historical Jun 27 (banyak titik: 451)
//  3. Trail historical Jun 26 (paling banyak: 556)
//  4. Trail historical Jun 25 (jarang: 9 titik)
//  5. Trail toggle OFF → hilang
//  6. Ganti tanggal → date picker
//  7. "Kembali ke hari ini" button

import { chromium } from 'playwright';
const BASE = 'https://lacak.sosmartpro.com';

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();

const xhrLog = [];
const consoleErrors = [];
page.on('response', async r => {
  const u = r.url();
  if (u.includes('/positions/trail')) {
    try {
      const j = await r.json();
      xhrLog.push(`${r.status()} count=${j?.count} url=${u.replace(BASE, '')}`);
    } catch { xhrLog.push(`${r.status()} PARSE_ERR ${u.replace(BASE, '')}`); }
  }
});
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

function report(label, ok, detail = '') {
  const mark = ok ? '✓' : '✗';
  console.log(`  ${mark} ${label}${detail ? ' — ' + detail : ''}`);
  return ok;
}

// === LOGIN ===
console.log('\n[login]');
await page.goto(BASE);
await page.waitForSelector('input[autocomplete=username]', { timeout: 30000 });
await page.fill('input[autocomplete=username]', 'sup_bsn003');
await page.fill('input[type=password]', 'debugpw123');
await page.click('button[type=submit]');
await page.waitForTimeout(3000);
report('logged in as sup_bsn003', page.url().includes(BASE));

// === NAV TRACKING + SELECT SIDIK ===
console.log('\n[navigation]');
await page.locator('a:has-text("Tracking"), button:has-text("Tracking")').first().click();
await page.waitForTimeout(4000);
report('opened Tracking', page.url().includes('#tracking'));
const sidik = await page.locator('.petugas-card:has-text("Sidik")').first();
await sidik.click();
await page.waitForTimeout(1500);
report('selected Sidik card');

// === SCENARIO 1: Trail toggle ON hari ini ===
console.log('\n[scenario 1: trail hari ini]');
const trailToggle = page.locator('label:has-text("trail pergerakan") input[type=checkbox]');
xhrLog.length = 0;
await trailToggle.click();
await page.waitForTimeout(3000);
report('trail checkbox checked', await trailToggle.isChecked());
const s1xhr = xhrLog.find(x => x.startsWith('200') && x.includes('count='));
report('XHR trail today succeeded', !!s1xhr, s1xhr);

// === SCENARIO 2-4: Historical dates ===
const historicals = [
  { date: '2026-06-27', expectMin: 400 },
  { date: '2026-06-26', expectMin: 500 },
  { date: '2026-06-25', expectMin: 5 },
];
for (const { date, expectMin } of historicals) {
  console.log(`\n[scenario historical ${date}]`);
  xhrLog.length = 0;
  const dateInput = page.locator('input[type=date]').first();
  await dateInput.fill(date);
  await page.waitForTimeout(3500);
  const xhr = xhrLog.find(x => x.includes(`since=${date}`) || x.includes(`since=${date.split('-').slice(0,3).join('-')}`) || (x.startsWith('200') && x.includes('count=')));
  const countMatch = xhr?.match(/count=(\d+)/);
  const count = countMatch ? parseInt(countMatch[1]) : 0;
  report(`XHR ${date} returned data`, count >= expectMin, `count=${count} expected≥${expectMin}`);
  await page.screenshot({ path: `test-results/trail-${date}.png` });
}

// === SCENARIO 5: Toggle OFF ===
console.log('\n[scenario 5: toggle OFF]');
xhrLog.length = 0;
await trailToggle.click();
await page.waitForTimeout(1500);
report('trail unchecked', !(await trailToggle.isChecked()));
report('no XHR after toggle OFF', xhrLog.length === 0, `xhr count=${xhrLog.length}`);

// === SCENARIO 6: "Kembali ke hari ini" button ===
console.log('\n[scenario 6: kembali ke hari ini]');
await trailToggle.click();  // re-enable
await page.waitForTimeout(1500);
const dateInput = page.locator('input[type=date]').first();
await dateInput.fill('2026-06-25');
await page.waitForTimeout(2000);
const backBtn = page.locator('button:has-text("Kembali ke hari ini")');
const backVisible = await backBtn.count();
report('"Kembali ke hari ini" button visible on historical date', backVisible > 0);
if (backVisible > 0) {
  await backBtn.first().click();
  await page.waitForTimeout(2000);
  const nowDate = await dateInput.inputValue();
  const today = new Date().toISOString().slice(0, 10);
  report(`date reset to today (${today})`, nowDate === today, `got=${nowDate}`);
}

// === FINAL CONSOLE ERROR CHECK ===
console.log('\n[console errors filter]');
const critical = consoleErrors.filter(e =>
  !e.includes('CSP') && !e.includes('401') && !e.includes('Failed to load resource')
);
report('no critical console errors', critical.length === 0);
if (critical.length > 0) {
  console.log('  Critical errors:');
  for (const e of critical.slice(0, 5)) console.log(`    ! ${e.slice(0, 150)}`);
}

// === MAP LAYERS INSPECTION ===
console.log('\n[map layer state]');
const layerCount = await page.locator('.maplibregl-canvas').count();
report('MapLibre canvas rendered', layerCount === 1, `count=${layerCount}`);

await b.close();
console.log('\n=== SMOKE TEST DONE ===');
