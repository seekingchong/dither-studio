import { expect, test, type Page } from '@playwright/test';
import { openSection } from './helpers';

async function dropImage(page: Page, width: number, height: number) {
  await page.locator('[data-slot="0"]').waitFor();
  await page.evaluate(
    async ({ width, height }) => {
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      const ctx = c.getContext('2d')!;
      const g = ctx.createLinearGradient(0, 0, width, 0);
      g.addColorStop(0, '#000000');
      g.addColorStop(1, '#ffffff');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#404040';
      ctx.fillRect(width * 0.2, height * 0.2, width * 0.3, height * 0.4);
      const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'sample.png', { type: 'image/png' }));
      document.querySelector('[data-slot="0"]')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    },
    { width, height },
  );
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true');
}

async function setSlider(page: Page, id: string, value: number) {
  const input = page.locator(`[data-param="${id}"] .tda-slider__input`);
  await input.fill(String(value));
  await input.press('Enter');
}

/** 画布上亮像素比例 */
async function lightRatio(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('.slot__canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let light = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 127) light++;
    return light / (data.length / 4);
  });
}

test('像素尺寸默认 4、范围 1–16，载入媒体不改它', async ({ page }) => {
  await page.goto('/');
  const range = page.locator('[data-param="pixel.size"] .tda-slider__range');
  await expect(range).toHaveValue('4');
  await expect(range).toHaveAttribute('min', '1');
  await expect(range).toHaveAttribute('max', '16');
  await dropImage(page, 400, 250);
  await expect(range).toHaveValue('4');
  await dropImage(page, 2400, 1500);
  await expect(range).toHaveValue('4');
  await setSlider(page, 'pixel.size', 99);
  await expect(range).toHaveValue('16');
  await setSlider(page, 'pixel.size', 0);
  await expect(range).toHaveValue('1');
});

test('影调滑块改变渲染结果', async ({ page }) => {
  await page.goto('/');
  await dropImage(page, 800, 500);
  await openSection(page, 'tone');
  const base = await lightRatio(page);
  await setSlider(page, 'tone.brightness', 60);
  await expect.poll(() => lightRatio(page)).toBeGreaterThan(base + 0.05);
  await setSlider(page, 'tone.brightness', -60);
  await expect.poll(() => lightRatio(page)).toBeLessThan(base - 0.05);
  await setSlider(page, 'tone.brightness', 0);
  await page.locator('[data-param="tone.invert"]').click();
  await expect.poll(() => lightRatio(page)).toBeLessThan(0.5);
});

test('噪点与描边的从属参数按条件出现', async ({ page }) => {
  await page.goto('/');
  await dropImage(page, 400, 250);
  await openSection(page, 'tone');
  await expect(page.locator('[data-param="tone.noiseType"]')).toHaveCount(0);
  await setSlider(page, 'tone.noise', 30);
  await expect(page.locator('[data-param="tone.noiseType"]')).toBeVisible();
  await expect(page.locator('[data-param="tone.outlineThreshold"]')).toHaveCount(0);
  await setSlider(page, 'tone.outline', 50);
  await expect(page.locator('[data-param="tone.outlineThreshold"]')).toBeVisible();
  await expect(page.locator('.tda-toast--error')).toHaveCount(0);
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true');
});
