// Repro: login sup_bsn003, buka Tracking, pilih Sidik, toggle trail
// hari ini + historical, screenshot map + capture network XHR.
import { chromium } from 'playwright';

const BASE = 'https://lacak.sosmartpro.com';

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();

const xhrLog = [];
page.on('response', async r => {
  const u = r.url();
  if (u.includes('/positions/trail') || u.includes('/positions/latest')) {
    xhrLog.push(`${r.status()} ${u}`);
    try {
      const j = await r.json();
      if (typeof j?.count === 'number') xhrLog.push(`  → count=${j.count}`);
    } catch {}
  }
});
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

// Login
await page.goto(BASE);
await page.waitForSelector('input[autocomplete=username]', { timeout: 30000 });
await page.fill('input[autocomplete=username]', 'sup_bsn003');
await page.fill('input[type=password]', 'debugpw123');
await page.click('button[type=submit]');
await page.waitForTimeout(3000);
console.log('after login url:', page.url());

// Wait for post-login shell
await page.waitForTimeout(4000);
console.log('post-login title:', await page.title());

// Try nav to Tracking via top-nav link (nav item "Tracking")
const trackingNav = page.locator('a:has-text("Tracking"), button:has-text("Tracking")').first();
if (await trackingNav.count() > 0) {
  await trackingNav.click();
  console.log('clicked Tracking nav');
} else {
  console.log('no Tracking nav — try hash');
  await page.evaluate(() => { window.location.hash = 'tracking'; });
}
await page.waitForTimeout(5000);
console.log('after nav url:', page.url());
await page.screenshot({ path: 'test-results/after-nav.png' });

// Find and click Sidik in sidebar
const sidikCards = await page.locator('.petugas-card').all();
console.log(`petugas-card count: ${sidikCards.length}`);
for (const c of sidikCards) {
  const txt = await c.innerText().catch(() => '');
  if (txt.toLowerCase().includes('sidik')) {
    console.log('found Sidik card, clicking');
    await c.click();
    break;
  }
}
await page.waitForTimeout(2000);

// Toggle "Tampilkan trail pergerakan"
const trailToggle = page.locator('label:has-text("trail pergerakan") input[type=checkbox]');
const beforeChecked = await trailToggle.isChecked().catch(() => 'no-elem');
console.log('trail toggle before:', beforeChecked);
if (beforeChecked === false) {
  await trailToggle.click();
  await page.waitForTimeout(3000);
}

await page.screenshot({ path: 'test-results/trail-today.png', fullPage: false });
console.log('--- XHR log ---');
console.log(xhrLog.join('\n'));

// Try historical date (Jun 27 — 451 pts)
const dateInput = page.locator('input[type=date]');
if (await dateInput.count() > 0) {
  await dateInput.first().fill('2026-06-27');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'test-results/trail-jun27.png', fullPage: false });
}
console.log('--- XHR log (post-historical) ---');
console.log(xhrLog.join('\n'));

// Drag map ke arah Bogor (barat-daya dari Depok default view) supaya
// posisi Sidik masuk viewport. Sidik coords ~-6.589, 106.758. Default
// HUB view ~-6.4, 106.79 (Depok). Selisih ~20km barat-daya.
const mapContainer = page.locator('.maplibregl-map').first();
const mapBox = await mapContainer.boundingBox();
if (mapBox) {
  // Drag dari kiri-bawah ke tengah supaya kamera pindah ke sana
  const startX = mapBox.x + mapBox.width * 0.2;
  const startY = mapBox.y + mapBox.height * 0.8;
  const endX = mapBox.x + mapBox.width * 0.6;
  const endY = mapBox.y + mapBox.height * 0.3;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(1500);
  // Zoom in dengan wheel (5x klik zoom control)
  const zoomIn = page.locator('.maplibregl-ctrl-zoom-in').first();
  if (await zoomIn.count() > 0) {
    for (let i = 0; i < 5; i++) { await zoomIn.click(); await page.waitForTimeout(400); }
  }
  await page.waitForTimeout(2000);
}
await page.screenshot({ path: 'test-results/trail-jun27-centered.png', fullPage: false });

// Inspect map layers via internal MapLibre state
const layerInspect = await page.evaluate(() => {
  const canvases = document.querySelectorAll('.maplibregl-canvas');
  const rows = [];
  for (const c of canvases) {
    rows.push({ w: c.clientWidth, h: c.clientHeight });
  }
  return rows;
});
console.log('canvas:', layerInspect);
console.log('--- console errors ---');
console.log(consoleErrors.length ? consoleErrors.filter(e => !e.includes('401') && !e.includes('CSP')).join('\n') : '(none)');

await b.close();
