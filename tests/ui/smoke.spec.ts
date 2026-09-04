import { expect, test } from '@playwright/test';

test('页面骨架：无顶栏，左右双栏 + 中间拖拽条', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Dither Studio/);
  await expect(page.locator('.topbar')).toHaveCount(0);
  await expect(page.locator('.pane--params')).toBeVisible();
  await expect(page.getByTestId('pane-splitter')).toBeVisible();
  await expect(page.locator('.pane--preview')).toBeVisible();
});
