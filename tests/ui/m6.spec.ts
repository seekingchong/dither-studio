import { expect, test, type Page } from '@playwright/test';

async function dropImage(page: Page) {
  await page.locator('[data-slot="0"]').waitFor();
  await page.evaluate(async () => {
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
    dt.items.add(new File([blob], 'sample.png', { type: 'image/png' }));
    document.querySelector('[data-slot="0"]')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true');
}

async function pick(page: Page, paramId: string, optionLabel: string) {
  await page.locator(`[data-param="${paramId}"]`).click();
  await page.getByRole('option', { name: optionLabel, exact: true }).click();
}

async function canvasHash(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('.slot__canvas') as HTMLCanvasElement;
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let h = 0;
    for (let i = 0; i < data.length; i += 64) h = (h * 31 + data[i]) >>> 0;
    return h;
  });
}

test('特效栈：添加、堆叠、排序、关闭、删除', async ({ page }) => {
  await page.goto('/');
  await dropImage(page);
  await page.getByRole('tab', { name: '特效' }).click();
  await expect(page.getByTestId('effects-editor')).toContainText('还没有特效');
  const base = await canvasHash(page);

  await pick(page, 'effects.add', '扫描线 / CRT');
  await expect(page.locator('.effect-card')).toHaveCount(1);
  await expect(page.locator('.effect-card').first()).toContainText('扫描线 / CRT');
  await expect.poll(() => canvasHash(page)).not.toBe(base);
  const withScan = await canvasHash(page);

  await pick(page, 'effects.add', '波形');
  await expect(page.locator('.effect-card')).toHaveCount(2);
  await expect.poll(() => canvasHash(page)).not.toBe(withScan);
  const scanThenWave = await canvasHash(page);

  // 上移波形：顺序变为 波形 → 扫描线，结果不同
  await page.locator('.effect-card').nth(1).getByRole('button', { name: '上移' }).click();
  await expect(page.locator('.effect-card').first()).toContainText('波形');
  await expect.poll(() => canvasHash(page)).not.toBe(scanThenWave);

  // 关闭扫描线后只剩波形
  await page.locator('.effect-card').nth(1).locator('.effect-card__switch').click();
  await expect(page.locator('.effect-card').nth(1)).toHaveClass(/is-disabled/);
  await expect.poll(() => canvasHash(page)).not.toBe(scanThenWave);

  // 改波形振幅
  const amp = page.locator('.effect-card').first().locator('[data-param="effect.amplitude"] .tda-slider__input');
  await amp.fill('40');
  await amp.press('Enter');
  const bigWave = await canvasHash(page);
  expect(bigWave).not.toBe(scanThenWave);

  // 删除两个特效后回到原始画面
  await page.locator('.effect-card').first().getByRole('button', { name: '删除' }).click();
  await page.locator('.effect-card').first().getByRole('button', { name: '删除' }).click();
  await expect(page.locator('.effect-card')).toHaveCount(0);
  await expect.poll(() => canvasHash(page)).toBe(base);
  await expect(page.locator('.tda-toast--error')).toHaveCount(0);
});
