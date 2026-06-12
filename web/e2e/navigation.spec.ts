import { expect, test } from '@playwright/test';

async function login(page: any) {
  await page.goto('/');
  await page.getByPlaceholder(/supervisor/i).fill('supervisor');
  await page.getByPlaceholder('••••••••').fill('Sekret123!ABCD');
  await page.getByRole('button', { name: /masuk/i }).click();
  await expect(page.getByText(/postur kolektabilitas/i)).toBeVisible();
}

test.describe('sidebar navigation', () => {
  test('navigates to Kolektabilitas and back', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: /^Kolektabilitas/i }).click();
    await expect(page.getByText(/komposisi akad pembiayaan/i)).toBeVisible();

    await page.getByRole('button', { name: /^Dashboard/i }).click();
    await expect(page.getByText(/postur kolektabilitas/i)).toBeVisible();
  });

  test('navigates to Blast and sees segment cards', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: /^Blast SMS/i }).click();
    await expect(page.getByText(/belum jatuh tempo/i)).toBeVisible();
    await expect(page.getByText(/jatuh tempo hari ini/i)).toBeVisible();
    await expect(page.getByText(/lewat jatuh tempo/i)).toBeVisible();
  });

  test('navigates to Tracking and sees petugas list', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: /tracking petugas/i }).click();
    await expect(page.getByText(/petugas lapangan/i).first()).toBeVisible();
  });

  test('active page has aria-current=page', async ({ page }) => {
    await login(page);
    const dashboardBtn = page.getByRole('button', { name: /^Dashboard/i });
    await expect(dashboardBtn).toHaveAttribute('aria-current', 'page');
  });
});
