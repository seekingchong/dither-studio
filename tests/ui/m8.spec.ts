import { expect, test, type Page } from '@playwright/test';

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

test('内置预设应用、用户预设保存 / 重命名 / 删除并跨刷新保留', async ({ page }) => {
  await page.goto('/');
  await dropImage(page);
  await page.getByRole('tab', { name: '预设' }).click();
  await expect(page.getByTestId('presets-pane')).toBeVisible();
  await expect(page.locator('.preset-card')).toHaveCount(10);

  await page.locator('[data-preset="gameboy"]').click();
  await page.getByRole('tab', { name: '参数' }).click();
  await expect(familyValue(page)).toHaveText('有序');
  await expect(page.locator('[data-param="color.mode"] .tda-select__value')).toHaveText('Palette');

  // 保存当前为用户预设
  await page.getByRole('tab', { name: '预设' }).click();
  await page.getByLabel('新预设名称').fill('我的 GB');
  await page.getByRole('button', { name: '保存预设' }).click();
  await expect(page.locator('.preset-row')).toHaveCount(1);
  await expect(page.locator('.preset-row')).toContainText('我的 GB');

  // 刷新后仍在（web 端存 localStorage）
  await page.reload();
  await page.locator('[data-slot="0"]').waitFor();
  await page.getByRole('tab', { name: '预设' }).click();
  await expect(page.locator('.preset-row')).toHaveCount(1);

  // 改回默认参数，再应用用户预设
  await page.getByRole('tab', { name: '参数' }).click();
  await expect(familyValue(page)).toHaveText('误差扩散');
  await page.getByRole('tab', { name: '预设' }).click();
  await page.locator('.preset-row__name').click();
  await page.getByRole('tab', { name: '参数' }).click();
  await expect(familyValue(page)).toHaveText('有序');

  // 重命名与删除
  await page.getByRole('tab', { name: '预设' }).click();
  await page.getByRole('button', { name: '重命名' }).click();
  await page.getByLabel('预设名称', { exact: true }).fill('GB 改名');
  await page.getByLabel('预设名称', { exact: true }).press('Enter');
  await expect(page.locator('.preset-row')).toContainText('GB 改名');
  await page.getByRole('button', { name: '删除' }).click();
  await expect(page.locator('.preset-row')).toHaveCount(0);
  await page.reload();
  await page.locator('[data-slot="0"]').waitFor();
  await page.getByRole('tab', { name: '预设' }).click();
  await expect(page.locator('.preset-row')).toHaveCount(0);
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
