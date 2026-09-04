import { expect, test, type Page } from '@playwright/test';
import { openSection } from './helpers';

async function dropImage(page: Page) {
  await page.locator('[data-slot="0"]').waitFor();
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 250;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 400, 250);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 200, 250);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'sample.png', { type: 'image/png' }));
    document.querySelector('[data-slot="0"]')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true');
}

async function pick(page: Page, paramId: string, optionLabel: string) {
  await page.locator(`[data-param="${paramId}"]`).click();
  await page.getByRole('option', { name: optionLabel, exact: true }).click();
}

async function setSlider(page: Page, id: string, value: number) {
  const input = page.locator(`[data-param="${id}"] .tda-slider__input`);
  await input.fill(String(value));
  await input.press('Enter');
}

/** 画布左半区（墨区）内亮像素比例：网点 / 间距会让墨区露出纸色 */
async function paperInInkArea(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('.slot__canvas') as HTMLCanvasElement;
    const { data, width, height } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let light = 0;
    let total = 0;
    for (let y = 100; y < height - 100; y += 2) {
      for (let x = 60; x < width / 2 - 60; x += 2) {
        const i = (y * width + x) * 4;
        total++;
        if (data[i] > 127) light++;
      }
    }
    return light / total;
  });
}

test('网点、间距、反向与背景都改变渲染', async ({ page }) => {
  await page.goto('/');
  await dropImage(page);
  await setSlider(page, 'pixel.size', 12);
  await openSection(page, 'grid');
  await expect.poll(() => paperInInkArea(page)).toBeLessThan(0.05);

  await pick(page, 'grid.dot', '欧几里得网点');
  await expect(page.locator('[data-param="grid.dotSize"]')).toBeVisible();
  await expect.poll(() => paperInInkArea(page)).toBeGreaterThan(0.1);

  await page.locator('[data-param="grid.invert"]').click();
  await expect.poll(() => paperInInkArea(page)).toBeLessThan(0.05);
  await page.locator('[data-param="grid.invert"]').click();

  await page.locator('[data-param="grid.metaball"]').click();
  await expect(page.locator('[data-param="grid.metaballRadius"]')).toBeVisible();
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true');
  await page.locator('[data-param="grid.metaball"]').click();

  await pick(page, 'grid.dot', '方块');
  await setSlider(page, 'grid.gapX', 6);
  await expect.poll(() => paperInInkArea(page)).toBeGreaterThan(0.2);

  await pick(page, 'grid.background', '连线');
  await expect(page.locator('[data-param="grid.lineDirection"]')).toBeVisible();
  await expect(page.locator('[data-param="grid.bgColor"]')).toBeVisible();
  await pick(page, 'grid.background', '网格点');
  await expect(page.locator('[data-param="grid.bgDotShape"]')).toBeVisible();
  await expect(page.locator('[data-param="grid.lineDirection"]')).toHaveCount(0);
  await expect(page.locator('.tda-toast--error')).toHaveCount(0);
});
