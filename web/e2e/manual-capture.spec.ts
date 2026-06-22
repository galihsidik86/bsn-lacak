import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Generates the screenshots referenced by docs/MANUAL_PENGGUNAAN.md.
// Skipped unless CAPTURE_MANUAL=1, so the normal e2e run stays fast.
// Run with: CAPTURE_MANUAL=1 npx playwright test e2e/manual-capture.spec.ts

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = resolve(HERE, '../../docs/manual/screenshots');

test.describe('manual capture', () => {
  test.skip(!process.env.CAPTURE_MANUAL, 'set CAPTURE_MANUAL=1 to capture screenshots');
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    await mkdir(SHOT_DIR, { recursive: true });
  });

  async function shot(page: Page, name: string, fullPage = true) {
    await page.waitForTimeout(400); // let fade-up settle
    await page.screenshot({
      path: resolve(SHOT_DIR, name),
      fullPage,
      animations: 'disabled',
    });
  }

  async function login(page: Page) {
    await page.goto('/');
    await page.getByPlaceholder(/supervisor/i).fill('supervisor');
    await page.getByPlaceholder('••••••••').fill('Sekret123!ABCD');
    await page.getByRole('button', { name: /masuk/i }).click();
    await expect(page.getByText(/postur kolektabilitas/i)).toBeVisible();
  }

  test('01 login form', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /masuk ke dashboard/i })).toBeVisible();
    await shot(page, '01-login-kosong.png');

    await page.getByPlaceholder(/supervisor/i).fill('supervisor');
    await page.getByPlaceholder('••••••••').fill('Sekret123!ABCD');
    await shot(page, '02-login-terisi.png');
  });

  test('02 dashboard', async ({ page }) => {
    await login(page);
    await shot(page, '03-dashboard.png');
  });

  test('03 kolektabilitas', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: /^Kolektabilitas/i }).click();
    await expect(page.getByText(/komposisi akad pembiayaan/i)).toBeVisible();
    await shot(page, '04-kolektabilitas.png');
  });

  test('04 blast SMS/WA', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: /^Blast SMS/i }).click();
    await expect(page.getByRole('button', { name: /belum jatuh tempo/i })).toBeVisible();
    await shot(page, '05-blast.png');
  });

  test('05 tracking petugas', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: /tracking petugas/i }).click();
    await expect(page.getByText(/petugas lapangan/i).first()).toBeVisible();
    // Map tiles need an extra beat to draw.
    await page.waitForTimeout(1200);
    await shot(page, '06-tracking.png', false);
  });

  test('06 global search (Ctrl+K)', async ({ page }) => {
    await login(page);
    await page.keyboard.press('Control+K');
    await expect(page.getByRole('dialog', { name: /pencarian global/i })).toBeVisible();
    await page.getByPlaceholder(/cari nasabah, petugas/i).fill('Bu Tini');
    await shot(page, '07-global-search.png', false);
    await page.keyboard.press('Escape');
  });

  test('07 kalender cuti', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: /^Kalender Cuti/i }).click();
    await expect(page.locator('.page-title')).toHaveText(/kalender cuti/i);
    await shot(page, '08-kalender-cuti.png');
  });

  test('08 tracker janji', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: /^Tracker Janji/i }).click();
    await expect(page.locator('.page-title')).toHaveText(/tracker janji/i);
    await shot(page, '09-tracker-janji.png');
  });

  test('09 dispute absensi', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: /^Dispute Absensi/i }).click();
    await expect(page.locator('.page-title')).toHaveText(/dispute absensi/i);
    await shot(page, '10-dispute-absensi.png');
  });

  test('10 laporan KM', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: /^Laporan KM/i }).click();
    await expect(page.locator('.page-title')).toHaveText(/laporan km petugas/i);
    await shot(page, '11-laporan-km.png');
  });

  test('11 tukar nasabah', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: /^Tukar Nasabah/i }).click();
    await expect(page.locator('.page-title')).toHaveText(/tukar nasabah/i);
    await shot(page, '12-tukar-nasabah.png');
  });

  test('12 settings akun', async ({ page }) => {
    await login(page);
    // Footer avatar button = open Pengaturan.
    await page.getByRole('button', { name: /buka pengaturan akun/i }).click();
    await expect(page.locator('.page-title')).toHaveText(/pengaturan akun/i);
    await shot(page, '13-settings.png');
  });
});
