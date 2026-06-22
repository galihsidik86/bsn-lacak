import { expect, test, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/');
  await page.getByPlaceholder(/supervisor/i).fill('supervisor');
  await page.getByPlaceholder('••••••••').fill('Sekret123!ABCD');
  await page.getByRole('button', { name: /masuk/i }).click();
  await expect(page.getByText(/postur kolektabilitas/i)).toBeVisible();
}

// Coverage for screens shipped in recent feature commits (DP–DY range).
// Each page is fetched lazily; the filter card renders before the network
// query resolves, so we assert on stable shell elements (topbar title +
// a distinctive control) rather than on data that the mock harness lacks.
test.describe('recently shipped screens', () => {
  test('Kalender Cuti renders shell + pending toggle', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: /^Kalender Cuti/i }).click();
    await expect(page.locator('.page-title')).toHaveText(/kalender cuti/i);
    await expect(page.getByText(/tampilkan pending/i)).toBeVisible();
  });

  test('Tracker Janji renders shell + window selector', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: /^Tracker Janji/i }).click();
    await expect(page.locator('.page-title')).toHaveText(/tracker janji/i);
    // Window select defaults to 30 hari.
    await expect(page.getByRole('combobox').first()).toBeVisible();
  });

  test('Dispute Absensi renders shell + status filter', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: /^Dispute Absensi/i }).click();
    await expect(page.locator('.page-title')).toHaveText(/dispute absensi/i);
    const status = page.getByRole('combobox').first();
    await expect(status).toBeVisible();
    // Filter offers Pending / Disetujui / Ditolak / Dibatalkan / Semua.
    await expect(status.locator('option', { hasText: /disetujui/i })).toHaveCount(1);
  });

  test('Laporan KM renders shell + month/year selectors', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: /^Laporan KM/i }).click();
    await expect(page.locator('.page-title')).toHaveText(/laporan km petugas/i);
    // Two selects: bulan + tahun.
    await expect(page.getByRole('combobox')).toHaveCount(2);
  });

  test('Tukar Nasabah renders shell + status filter', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: /^Tukar Nasabah/i }).click();
    await expect(page.locator('.page-title')).toHaveText(/tukar nasabah/i);
    const status = page.getByRole('combobox').first();
    await expect(status.locator('option', { hasText: /^pending$/i })).toHaveCount(1);
  });
});

test.describe('global search', () => {
  test('Ctrl+K opens the search dialog', async ({ page }) => {
    await login(page);
    await page.keyboard.press('Control+K');
    const dialog = page.getByRole('dialog', { name: /pencarian global/i });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByPlaceholder(/cari nasabah, petugas/i),
    ).toBeVisible();
    // Escape closes it.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('topbar search button also opens dialog', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: /cari nasabah, petugas, transaksi/i }).click();
    await expect(page.getByRole('dialog', { name: /pencarian global/i })).toBeVisible();
  });
});
