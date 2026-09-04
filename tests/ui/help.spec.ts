import { expect, test, type Page } from '@playwright/test';
import { openSection } from './helpers';

const help = (page: Page) => page.locator('.tda-help');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-section="basic"]').waitFor();
});

test('停在参数标签上弹出解读：一句话 + 各个值 + 提示，且不遮住控件自己', async ({ page }) => {
  await expect(help(page)).toHaveCount(0);

  await page.locator('[data-param="pixel.method"] .tda-select__label').hover();
  await expect(help(page)).toHaveAttribute('data-show', 'true');
  await expect(help(page).locator('.tda-help__title')).toHaveText('降采样');
  await expect(help(page).locator('.tda-help__summary')).toContainText('一格里那些原像素');
  // 四个值逐条解读
  await expect(help(page).locator('.tda-help__value')).toHaveCount(4);
  await expect(help(page).locator('.tda-help__value').first()).toContainText('Box 平均');
  await expect(help(page).locator('.tda-help__tip')).toContainText('照片用 Box 或 Lanczos');

  // 浮层贴在控件外侧，不压住触发它的那个控件
  const field = await page.locator('[data-param="pixel.method"]').boundingBox();
  const box = await help(page).boundingBox();
  const overlaps = box!.x < field!.x + field!.width && box!.x + box!.width > field!.x && box!.y < field!.y + field!.height && box!.y + box!.height > field!.y;
  expect(overlaps).toBe(false);

  // 移开就收起
  await page.mouse.move(1400, 500);
  await expect(help(page)).toHaveCount(0);
});

test('选项多的下拉：属性浮层只讲怎么挑，逐个值的解读挂在选项行上', async ({ page }) => {
  // 默认算法族是「有序」，先切到误差扩散让「算法」下拉露出 14 个核
  await page.locator('[data-param="dither.family"]').click();
  await page.getByRole('option', { name: '误差扩散', exact: true }).click();
  await page.mouse.move(1400, 500);
  await expect(help(page)).toHaveCount(0);
  await page.locator('[data-param="dither.ed.kernel"] .tda-select__label').hover();
  await expect(help(page).locator('.tda-help__title')).toHaveText('算法');
  await expect(help(page).locator('.tda-help__value')).toHaveCount(0);
  await expect(help(page).locator('.tda-help__tip')).toContainText('展开下拉后停在某一行');

  // 下拉展开后属性解读让位，停在选项行上出这一项的解读
  await page.locator('[data-param="dither.ed.kernel"]').click();
  await expect(help(page)).toHaveCount(0);
  await page.locator('.tda-popover__item', { hasText: 'Atkinson' }).hover();
  await expect(help(page).locator('.tda-help__title')).toHaveText('Atkinson');
  await expect(help(page).locator('.tda-help__summary')).toContainText('经典 Mac 味');

  // 收起下拉，选项解读跟着收
  await page.keyboard.press('Escape');
  await expect(help(page)).toHaveCount(0);
});

test('键盘：焦点在控件上按 ? 弹解读，Esc 收起', async ({ page }) => {
  await page.locator('[data-param="pixel.size"] .tda-slider__range').focus();
  await page.keyboard.press('?');
  await expect(help(page).locator('.tda-help__title')).toHaveText('像素尺寸');
  await page.keyboard.press('Escape');
  await expect(help(page)).toHaveCount(0);
});

test('左栏不再有参数 tab：分节可折叠，收起时显示当前值摘要', async ({ page }) => {
  const module = page.getByTestId('params-module');
  await expect(module.getByRole('tab')).toHaveCount(0);

  // 默认只展开「基础」，那一排快捷参数都在里面
  await expect(page.locator('[data-section="basic"]')).toHaveAttribute('data-open', 'true');
  const basic = page.locator('[data-section="basic"] .param-grid').first().locator('.tda-select, .tda-field');
  await expect(basic.nth(0)).toHaveAttribute('data-param', 'dither.family');
  await expect(basic.nth(1)).toHaveAttribute('data-param', 'dither.ordered.matrix');
  await expect(basic.nth(2)).toHaveAttribute('data-param', 'color.mode');
  await expect(basic.nth(3)).toHaveAttribute('data-param', 'pixel.size');
  await expect(basic.nth(4)).toHaveAttribute('data-param', 'pixel.method');

  // 其余分节收起，标题右侧是当前值摘要
  const tone = page.locator('[data-section="tone"]');
  await expect(tone).toHaveAttribute('data-open', 'false');
  await expect(tone.locator('.section__summary')).toHaveText('未调整');
  await expect(page.locator('[data-section="basic"] .section__summary')).toBeHidden();

  // 展开影调、改一个参数，摘要跟着变
  await openSection(page, 'tone');
  await page.locator('[data-param="tone.contrast"] input[type="range"]').fill('20');
  await tone.locator('.section__toggle').click();
  await expect(tone).toHaveAttribute('data-open', 'false');
  await expect(tone.locator('.section__summary')).toHaveText('对比 +20');
});
