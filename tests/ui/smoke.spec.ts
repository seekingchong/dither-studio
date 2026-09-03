import { expect, test } from '@playwright/test';

test('页面骨架：顶栏 + 双栏', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.topbar__brand')).toHaveText(/Dither Studio/);
  await expect(page.locator('.pane--params')).toBeVisible();
  await expect(page.locator('.pane--preview')).toBeVisible();
});
