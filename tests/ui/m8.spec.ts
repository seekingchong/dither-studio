import { expect, test, type Page } from '@playwright/test';
import { openSection, sectionLabels } from './helpers';

async function dropImage(page: Page, slot = 0) {
  await page.locator(`[data-slot="${slot}"]`).waitFor();
  await page.evaluate(async (slot) => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 250;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 400, 0);
    g.addColorStop(0, '#000000');
    g.addColorStop(1, '#ffffff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 400, 250);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], `sample-${slot}.png`, { type: 'image/png' }));
    document.querySelector(`[data-slot="${slot}"]`)!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, slot);
  await expect(page.locator(`[data-slot="${slot}"]`)).toHaveAttribute('data-rendered', 'true');
}

async function pick(page: Page, paramId: string, optionLabel: string) {
  await page.locator(`[data-param="${paramId}"]`).click();
  await page.getByRole('option', { name: optionLabel, exact: true }).click();
}

const familyValue = (page: Page) => page.locator('[data-param="dither.family"] .tda-select__value');

test('预设模块在参数上方：选方案、微调、保存为我的预设、历史页编辑，并跨刷新保留', async ({ page }) => {
  await page.goto('/');
  await dropImage(page);
  // 参数页里：预设模块在上、参数模块在下，没有单独的"预设"tab
  await expect(page.getByRole('tab', { name: '预设' })).toHaveCount(0);
  const picker = page.getByTestId('preset-picker');
  await expect(picker).toBeVisible();
  await expect(page.locator('.preset-card')).toHaveCount(11);
  const pickerBox = await picker.boundingBox();
  const paramsBox = await page.getByTestId('params-module').boundingBox();
  expect(pickerBox!.y).toBeLessThan(paramsBox!.y);
  await expect(page.locator('[data-preset="default"]')).toHaveClass(/is-active/);
  await expect(page.getByTestId('preset-status')).toHaveText('当前方案：默认');

  // 选 Game Boy：参数跟着变，且只露出这套方案具备的分组（没有网格 / 特效）
  await page.locator('[data-preset="gameboy"]').click();
  await expect(page.locator('[data-preset="gameboy"]')).toHaveClass(/is-active/);
  await expect(familyValue(page)).toHaveText('有序');
  await expect(page.locator('[data-param="color.mode"] .tda-select__value')).toHaveText('Palette');
  await expect(sectionLabels(page)).toHaveText(['基础', '影调', '颜色', '画布']);
  await page.locator('[data-preset="dot-matrix"]').click();
  await expect(sectionLabels(page)).toHaveText(['基础', '影调', '颜色', '网格', '画布']);
  await page.locator('[data-preset="default"]').click();
  await expect(sectionLabels(page)).toHaveText(['基础', '影调', '颜色', '网格', '特效', '画布']);

  // 在 Game Boy 基础上微调 → 状态显示已微调，可还原
  await page.locator('[data-preset="gameboy"]').click();
  await openSection(page, 'tone');
  const brightness = page.locator('[data-param="tone.brightness"] input[type="range"]');
  await brightness.fill('20');
  await expect(page.getByTestId('preset-status')).toHaveText('当前方案：Game Boy · 已微调');
  await expect(page.locator('[data-preset="gameboy"]')).toHaveClass(/is-active/);
  await page.getByRole('button', { name: '还原' }).click();
  await expect(page.getByTestId('preset-status')).toHaveText('当前方案：Game Boy');
  await brightness.fill('20');

  // 保存为我的预设：出现在预设卡片里并成为当前方案；来源是 Game Boy
  await page.getByLabel('新预设名称').fill('我的 GB');
  await page.getByRole('button', { name: '保存为我的预设' }).click();
  await expect(page.locator('.preset-card--user')).toHaveCount(1);
  await expect(page.locator('.preset-card--user')).toContainText('我的 GB');
  await expect(page.locator('.preset-card--user')).toContainText('基于 Game Boy');
  await expect(page.locator('.preset-card--user')).toHaveClass(/is-active/);
  await expect(page.getByTestId('preset-status')).toHaveText('当前方案：我的 GB');
  await expect(sectionLabels(page)).toHaveText(['基础', '影调', '颜色', '画布']);

  // 历史页：一条记录，带缩略图、来源与摘要
  await page.getByRole('tab', { name: '历史' }).click();
  await expect(page.getByTestId('history-pane')).toBeVisible();
  await expect(page.locator('.history-item')).toHaveCount(1);
  await expect(page.locator('.history-item')).toContainText('我的 GB');
  await expect(page.locator('.history-item__meta')).toHaveText(/基于 Game Boy · 有序 · Bayer 4×4 · Palette · 像素 4/);
  await expect(page.locator('.history-item__thumb img')).toHaveAttribute('src', /^data:image\/png/);

  // 刷新后仍在（web 端存 localStorage）
  await page.reload();
  await page.locator('[data-slot="0"]').waitFor();
  await expect(page.locator('.preset-card--user')).toHaveCount(1);
  await expect(familyValue(page)).toHaveText('误差扩散');

  // 从历史页应用：回到参数页，参数与来源都恢复
  await page.getByRole('tab', { name: '历史' }).click();
  await page.locator('.history-item').getByRole('button', { name: '应用', exact: true }).click();
  await expect(page.getByTestId('preset-picker')).toBeVisible();
  await expect(familyValue(page)).toHaveText('有序');
  await openSection(page, 'tone');
  await expect(page.locator('[data-param="tone.brightness"] input[type="range"]')).toHaveValue('20');
  await expect(page.getByTestId('preset-status')).toHaveText('当前方案：我的 GB');

  // 微调后在历史页"更新"写回，再重命名与删除
  await page.locator('[data-param="tone.brightness"] input[type="range"]').fill('30');
  await page.getByRole('tab', { name: '历史' }).click();
  await expect(page.locator('.history-item__tag')).toHaveText('使用中 · 已微调');
  await page.locator('.history-item').getByRole('button', { name: '更新' }).click();
  await expect(page.locator('.history-item__tag')).toHaveText('使用中');
  await page.getByRole('button', { name: '重命名' }).click();
  await page.getByLabel('预设名称', { exact: true }).fill('GB 改名');
  await page.getByLabel('预设名称', { exact: true }).press('Enter');
  await expect(page.locator('.history-item')).toContainText('GB 改名');
  await page.getByRole('button', { name: '删除' }).click();
  await expect(page.locator('.history-item')).toHaveCount(0);
  // 删除正在使用的预设：参数保留，来源退回 Game Boy
  await page.getByRole('tab', { name: '参数' }).click();
  await expect(page.locator('[data-param="tone.brightness"] input[type="range"]')).toHaveValue('30');
  await expect(page.getByTestId('preset-status')).toHaveText('当前方案：Game Boy · 已微调');
  await page.reload();
  await page.locator('[data-slot="0"]').waitFor();
  await expect(page.locator('.preset-card--user')).toHaveCount(0);
  await page.getByRole('tab', { name: '历史' }).click();
  await expect(page.locator('.history-item')).toHaveCount(0);
});

test('撤销 / 重做：按钮与快捷键，滑块拖动合并', async ({ page }) => {
  await page.goto('/');
  await dropImage(page);
  await expect(page.getByRole('button', { name: '撤销' })).toBeDisabled();
  await pick(page, 'dither.family', '有序');
  await expect(page.getByRole('button', { name: '撤销' })).toBeEnabled();
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(familyValue(page)).toHaveText('误差扩散');
  await page.getByRole('button', { name: '重做' }).click();
  await expect(familyValue(page)).toHaveText('有序');

  // 键盘：Ctrl+Z / Shift+Ctrl+Z
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect(familyValue(page)).toHaveText('误差扩散');
  await page.keyboard.press('Control+Shift+z');
  await expect(familyValue(page)).toHaveText('有序');

  // 拖动滑块的连续变化只算一步
  const range = page.locator('[data-param="pixel.size"] .tda-slider__range');
  const box = (await range.boundingBox())!;
  await page.mouse.move(box.x + 8, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + 8 + i * 6, box.y + box.height / 2);
  await page.mouse.up();
  const after = await range.inputValue();
  expect(Number(after)).toBeGreaterThan(2);
  await page.keyboard.press('Control+z');
  await expect(range).toHaveValue('2');
  await expect(familyValue(page)).toHaveText('有序');
});

test('深色主题与 4 坑位预览', async ({ page }) => {
  await page.goto('/');
  await dropImage(page);
  await page.getByTestId('settings-button').click();
  await pick(page, 'settings.theme', '深色');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.pane--params')!).backgroundColor);
  expect(bg).not.toBe('rgb(255, 255, 255)');

  await pick(page, 'settings.slotCount', '4 个媒体');
  await page.keyboard.press('Escape');
  await expect(page.locator('.slot')).toHaveCount(4);
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true');
  await dropImage(page, 2);
  await expect(page.locator('[data-slot="2"]')).toHaveClass(/is-active/);
  await expect(page).toHaveScreenshot('m8-dark-4slots.png', { maxDiffPixelRatio: 0.02, mask: [page.getByTestId('preview-meta')] });

  // 设置跨刷新保留
  await page.reload();
  await page.locator('[data-slot="0"]').waitFor();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.slot')).toHaveCount(4);
  await page.getByTestId('settings-button').click();
  await pick(page, 'settings.theme', '浅色');
  await pick(page, 'settings.slotCount', '1 个媒体');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
