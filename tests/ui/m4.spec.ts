import { expect, test, type Page } from '@playwright/test';
import { openSection } from './helpers';

async function dropColorImage(page: Page) {
  await page.locator('[data-slot="0"]').waitFor();
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 250;
    const ctx = c.getContext('2d')!;
    for (let x = 0; x < 400; x += 4) {
      ctx.fillStyle = `hsl(${(x / 400) * 360} 90% 50%)`;
      ctx.fillRect(x, 0, 4, 200);
    }
    const g = ctx.createLinearGradient(0, 0, 400, 0);
    g.addColorStop(0, '#000000');
    g.addColorStop(1, '#ffffff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 200, 400, 50);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'color.png', { type: 'image/png' }));
    document.querySelector('[data-slot="0"]')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true');
}

async function pick(page: Page, paramId: string, optionLabel: string) {
  await page.locator(`[data-param="${paramId}"]`).click();
  await page.getByRole('option', { name: optionLabel, exact: true }).click();
}

/** 画布上不同颜色的数量（抽样） */
async function distinctColors(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('.slot__canvas') as HTMLCanvasElement;
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    const set = new Set<number>();
    for (let i = 0; i < data.length; i += 16) set.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    return set.size;
  });
}

test('五种颜色模式与色板预览', async ({ page }) => {
  await page.goto('/');
  await dropColorImage(page);
  await openSection(page, 'color');
  await expect(page.getByTestId('color-preview')).toContainText('2 色');
  await expect.poll(() => distinctColors(page)).toBe(2);

  await pick(page, 'color.mode', 'Palette');
  await expect(page.locator('[data-param="color.palette.preset"]')).toContainText('Game Boy');
  await expect(page.getByTestId('color-preview')).toContainText('4 色');
  await expect.poll(() => distinctColors(page)).toBe(4);

  await pick(page, 'color.palette.preset', 'PICO-8');
  await expect(page.getByTestId('color-preview')).toContainText('16 色');
  await expect.poll(() => distinctColors(page)).toBeGreaterThan(4);

  await page.locator('[data-param="color.mismatch"]').click();
  await expect(page.locator('[data-param="color.palette.levels"]')).toBeVisible();

  await pick(page, 'color.mode', '灰阶');
  const levels = page.locator('[data-param="color.levels"] .tda-slider__input');
  await levels.fill('4');
  await levels.press('Enter');
  await expect(page.getByTestId('color-preview')).toContainText('4 色');
  await expect.poll(() => distinctColors(page)).toBe(4);

  await pick(page, 'color.mode', 'Channels');
  await expect(page.locator('[data-param="color.channels.space"]')).toBeVisible();
  await expect.poll(() => distinctColors(page)).toBeGreaterThan(4);

  await pick(page, 'color.mode', '单色');
  await expect.poll(() => distinctColors(page)).toBe(2);
  await expect(page.locator('.tda-toast--error')).toHaveCount(0);
});

test('Tint 双色与 Accent 层', async ({ page }) => {
  await page.goto('/');
  await dropColorImage(page);
  await openSection(page, 'color');
  // 默认颜色模式改成了单色，这里要的是 Tint
  await pick(page, 'color.mode', 'Tint');
  const dark = page.locator('[data-param="color.tint.dark"] .tda-color__hex');
  await dark.fill('#112233');
  await dark.press('Enter');
  await expect(dark).toHaveValue('#112233');
  await expect.poll(() =>
    page.evaluate(() => {
      const canvas = document.querySelector('.slot__canvas') as HTMLCanvasElement;
      const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < data.length; i += 4) if (data[i] === 0x11 && data[i + 1] === 0x22 && data[i + 2] === 0x33) return true;
      return false;
    }),
  ).toBe(true);

  await page.locator('[data-param="color.accent.enabled"]').click();
  await expect(page.locator('[data-param="color.accent.colors"]')).toBeVisible();
  await expect(page.locator('[data-param="color.accent.level"]')).toHaveCount(0);
  await pick(page, 'color.accent.placement', '仅某灰阶档');
  await expect(page.locator('[data-param="color.accent.level"]')).toBeVisible();
  await pick(page, 'color.accent.placement', '随机');
  await expect.poll(() =>
    page.evaluate(() => {
      const canvas = document.querySelector('.slot__canvas') as HTMLCanvasElement;
      const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < data.length; i += 4) if (data[i] === 0xff && data[i + 1] === 0x62 && data[i + 2] === 0x00) return true;
      return false;
    }),
  ).toBe(true);
  await expect(page.locator('.tda-toast--error')).toHaveCount(0);
});

test('色块点开可改色、可直接输入色值；灰阶改中间级转 Tint，改内置调色板转自定义', async ({ page }) => {
  await page.goto('/');
  await dropColorImage(page);
  await openSection(page, 'color');
  const swatches = page.getByTestId('color-preview').locator('.swatch--btn');
  const popover = page.getByTestId('color-popover');

  // 单色：两块，第一块是暗色，输入色值即生效并同步到「暗色」字段
  await expect(swatches).toHaveCount(2);
  await swatches.first().click();
  await expect(popover).toBeVisible();
  const darkHex = popover.getByLabel('暗色色值');
  await darkHex.fill('#123456');
  await darkHex.press('Enter');
  await expect(popover).toHaveCount(0);
  await expect(page.locator('[data-param="color.tint.dark"] .tda-color__hex')).toHaveValue('#123456');
  await expect(swatches.first()).toHaveAttribute('aria-label', '暗色 #123456');
  await expect.poll(() =>
    page.evaluate(() => {
      const canvas = document.querySelector('.slot__canvas') as HTMLCanvasElement;
      const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < data.length; i += 4) if (data[i] === 0x12 && data[i + 1] === 0x34 && data[i + 2] === 0x56) return true;
      return false;
    }),
  ).toBe(true);

  // 灰阶 4 级：改第 2 级 → 转为 Tint，四级都保留且第 2 级是新色
  await pick(page, 'color.mode', '灰阶');
  const levels = page.locator('[data-param="color.levels"] .tda-slider__input');
  await levels.fill('4');
  await levels.press('Enter');
  await expect(swatches).toHaveCount(4);
  await swatches.nth(1).click();
  await expect(popover).toContainText('转为 Tint');
  const midHex = popover.getByLabel('第 2 级色值');
  await midHex.fill('#FF0000');
  await expect(page.locator('[data-param="color.mode"] .tda-select__value')).toHaveText('Tint');
  await expect(swatches).toHaveCount(4);
  await expect(swatches.nth(1)).toHaveAttribute('aria-label', '第 2 级 #FF0000');
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);

  // Palette：改 Game Boy 的第一色 → 自定义；加一色、删一色
  await pick(page, 'color.mode', 'Palette');
  await expect(page.getByTestId('color-preview')).toContainText('4 色 · Game Boy');
  await swatches.first().click();
  await expect(popover).toContainText('自定义');
  const firstHex = popover.getByLabel('第 1 色色值');
  await firstHex.fill('#0000FF');
  await firstHex.press('Enter');
  await expect(page.locator('[data-param="color.palette.preset"]')).toContainText('自定义');
  await expect(page.getByTestId('color-preview')).toContainText('4 色 · 自定义');
  await expect(swatches.first()).toHaveAttribute('aria-label', '第 1 色 #0000FF');
  await page.getByRole('button', { name: '添加颜色' }).click();
  await expect(swatches).toHaveCount(5);
  await expect(popover).toBeVisible();
  await popover.getByRole('button', { name: '删除' }).click();
  await expect(swatches).toHaveCount(4);
  await expect(popover).toHaveCount(0);
  await expect(page.locator('.tda-toast--error')).toHaveCount(0);
});
