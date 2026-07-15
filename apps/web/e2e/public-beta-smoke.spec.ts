import { expect, test } from '@playwright/test';

const publicPages = [
  '/zh',
  '/zh/image/compress',
  '/zh/privacy',
  '/zh/terms',
  '/zh/beta',
];

for (const path of publicPages) {
  test(`${path} is available`, async ({ page }) => {
    const response = await page.goto(path);

    expect(response?.status()).toBe(200);
    await expect(page.locator('body')).not.toContainText('Page not found');
  });
}

test('dashboard redirects to login', async ({ page }) => {
  await page.goto('/zh/dashboard');

  await expect(page).toHaveURL(/\/zh\/login\?next=%2Fdashboard$/);
});

test('image compression exposes its canonical URL', async ({ page }) => {
  await page.goto('/zh/image/compress');

  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    /\/zh\/image\/compress$/
  );
});
