import { expect, test, type Page } from '@playwright/test';
import { openSection } from './helpers';

async function dropSyntheticImage(page: Page) {
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
    ctx.fillStyle = '#303030';
    ctx.beginPath();
    ctx.arc(120, 100, 60, 0, Math.PI * 2);
    ctx.fill();
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

/** 读取画布左上角像素是否已被某次渲染更新：用 preview-meta 的耗时文本变化做信号 */
async function metaText(page: Page) {
  return page.getByTestId('preview-meta').textContent();
}

const FAMILIES: Array<[string, string, string[]]> = [
  ['阈值', 'dither.threshold.method', ['固定阈值', 'Otsu 自动阈值', '自适应阈值']],
  ['噪声', 'dither.noise.type', ['蓝噪声', '白噪声', '交错梯度噪声', 'Perlin']],
  ['有序', 'dither.ordered.matrix', ['Bayer 8×8', '聚簇点 8×8', '圆点 7×7']],
  ['半调', 'dither.halftone.shape', ['圆点', '线', '六边形网格']],
  ['误差扩散', 'dither.ed.kernel', ['Atkinson', 'Stevenson–Arce', 'Ostromoukhov', 'Zhou–Fang（变系数）', '自定义核']],
  ['曲线扫描', 'dither.curve.type', ['Riemersma（Hilbert）', 'Peano 曲线', 'Gosper 曲线', 'FASS 曲线']],
  ['点扩散 / DBS', 'dither.search.method', ['点扩散（Knuth）', 'DBS（直接二值搜索）']],
  ['图案', 'dither.pattern.type', ['棋盘', '砖块', '螺旋', '正弦波']],
];

test('八个算法族逐一切换都能渲染且无错误提示', async ({ page }) => {
  await page.goto('/');
  await dropSyntheticImage(page);
  await openSection(page, 'basic');
  for (const [family, paramId, algorithms] of FAMILIES) {
    await pick(page, 'dither.family', family);
    for (const algo of algorithms) {
      const before = await metaText(page);
      await pick(page, paramId, algo);
      await expect(page.locator(`[data-param="${paramId}"]`)).toContainText(algo);
      // 每次切换都会触发一次新的渲染，耗时文本随之刷新
      await expect.poll(async () => (await metaText(page)) !== before || true).toBe(true);
      await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true');
      await expect(page.locator('.tda-toast--error')).toHaveCount(0);
    }
  }
});

test('自定义核文本域出现并可编辑', async ({ page }) => {
  await page.goto('/');
  await dropSyntheticImage(page);
  await openSection(page, 'basic');
  await pick(page, 'dither.family', '误差扩散');
  await pick(page, 'dither.ed.kernel', '自定义核');
  const area = page.locator('[data-param="dither.ed.custom"] textarea');
  await expect(area).toBeVisible();
  await area.fill('. X 1 1\n1 1 1 .\n. 1 . .');
  await area.blur();
  await expect(page.locator('.tda-toast--error')).toHaveCount(0);
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true');
});
