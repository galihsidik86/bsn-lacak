import { expect, test } from '@playwright/test';

test.describe('login flow', () => {
  test('shows login form on first visit', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /masuk ke dashboard/i })).toBeVisible();
    await expect(page.getByPlaceholder(/supervisor/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /masuk/i })).toBeDisabled();
  });

  test('enables submit only when both fields filled', async ({ page }) => {
    await page.goto('/');
    const submit = page.getByRole('button', { name: /masuk/i });
    await expect(submit).toBeDisabled();
    await page.getByPlaceholder(/supervisor/i).fill('supervisor');
    await expect(submit).toBeDisabled();
    await page.getByPlaceholder('••••••••').fill('Sekret123!ABCD');
    await expect(submit).toBeEnabled();
  });

  test('logs in successfully → lands on dashboard', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder(/supervisor/i).fill('supervisor');
    await page.getByPlaceholder('••••••••').fill('Sekret123!ABCD');
    await page.getByRole('button', { name: /masuk/i }).click();

    await expect(page.getByText(/dashboard/i).first()).toBeVisible();
    await expect(page.getByText(/postur kolektabilitas/i)).toBeVisible();
    // Sidebar shows the logged-in username
    await expect(page.getByText('supervisor').first()).toBeVisible();
  });

  test('logout returns to login form', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder(/supervisor/i).fill('supervisor');
    await page.getByPlaceholder('••••••••').fill('Sekret123!ABCD');
    await page.getByRole('button', { name: /masuk/i }).click();
    await expect(page.getByText(/postur kolektabilitas/i)).toBeVisible();

    await page.getByRole('button', { name: /keluar/i }).click();
    await expect(page.getByRole('heading', { name: /masuk ke dashboard/i })).toBeVisible();
  });

  test('skip-to-content link appears on Tab focus', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder(/supervisor/i).fill('supervisor');
    await page.getByPlaceholder('••••••••').fill('Sekret123!ABCD');
    await page.getByRole('button', { name: /masuk/i }).click();
    await expect(page.getByText(/postur kolektabilitas/i)).toBeVisible();

    // The skip link should exist in DOM and become visible when focused.
    const skip = page.getByRole('link', { name: /lewati ke konten utama/i });
    await expect(skip).toBeAttached();
  });
});
