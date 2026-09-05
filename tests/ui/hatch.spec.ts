import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { sectionLabels } from './helpers';

/** 在页面里合成一张 800×500 的测试图并以拖拽方式放进坑位 0 */
async function dropSyntheticImage(page: Page) {
  await page.locator('[data-slot="0"]').waitFor();
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 800;
    c.height = 500;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 800, 0);
    g.addColorStop(0, '#000000');
    g.addColorStop(1, '#ffffff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 800, 500);
    ctx.fillStyle = '#202020';
    ctx.beginPath();
    ctx.arc(520, 250, 120, 0, Math.PI * 2);
    ctx.fill();
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'sample.png', { type: 'image/png' }));
    document.querySelector('[data-slot="0"]')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true');
}

const basicParams = (page: Page) => page.locator('[data-section="basic"] .param-grid').first().locator('.tda-select, .tda-field');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');
  await page.locator('[data-section="basic"]').waitFor();
});

test('左栏页签「抖动 | 排线 | 网点 | 历史」：切页签就是切风格，分节与预设跟着换', async ({ page }) => {
  test.setTimeout(45_000);
  const tabs = page.locator('.pane--params .pane-actions [role="tab"]');
  await expect(tabs).toHaveText(['抖动', '排线', '网点', '历史']);
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.pane--params')).toHaveAttribute('data-style', 'dither');
  await expect(sectionLabels(page)).toHaveText(['基础', '颜色', '影调', '网格', '特效']);

  // 切到排线：领头参数换成角度 / 像素尺寸（横纵间距合成一个，旁边「横纵分开」）/ 色阶，多出「笔画」一节，「网格」（抖动专属）收起
  await page.getByRole('tab', { name: '排线' }).click();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.pane--params')).toHaveAttribute('data-style', 'hatch');
  await expect(sectionLabels(page)).toHaveText(['基础', '笔画', '颜色', '影调', '特效']);
  await expect(basicParams(page).nth(0)).toHaveAttribute('data-param', 'hatch.angle');
  await expect(basicParams(page).nth(1)).toHaveAttribute('data-param', 'hatch.cell');
  await expect(basicParams(page).nth(2)).toHaveAttribute('data-param', 'hatch.cell.split');
  await expect(basicParams(page).nth(3)).toHaveAttribute('data-param', 'hatch.levels');
  await expect(basicParams(page).nth(4)).toHaveAttribute('data-param', 'pixel.method');
  await expect(page.locator('[data-param="hatch.spacingX"]')).toHaveCount(0);
  await expect(page.locator('[data-param="hatch.cell"] input[type="range"]')).toHaveValue('14');
  await expect(page.locator('[data-param="dither.family"]')).toHaveCount(0);
  await expect(page.locator('[data-param="pixel.size"]')).toHaveCount(0);
  await expect(page.locator('[data-param="hatch.length"]')).toBeVisible();
  await expect(page.locator('[data-param="hatch.link"]')).toBeVisible();
  // 连线粗细 / 颜色只在开了连线后出现
  await expect(page.locator('[data-param="hatch.linkWidth"]')).toHaveCount(0);
  await page.locator('[data-param="hatch.link"]').click();
  await page.getByRole('option', { name: '横向', exact: true }).click();
  // 选完下拉收起，选项行的解读浮层不能留在原地
  await expect(page.locator('.tda-help')).toHaveCount(0);
  await expect(page.locator('[data-param="hatch.linkWidth"]')).toBeVisible();
  await expect(page.locator('[data-param="hatch.linkColor"]')).toBeVisible();

  // 「颜色」只剩前景 / 背景两块；影调仍在（亮度等调整两种风格共用）
  const swatches = page.getByTestId('color-preview').locator('.swatch--btn');
  await expect(swatches).toHaveCount(2);
  await expect(swatches.nth(0)).toHaveAttribute('aria-label', '前景色 #1C1C1C');
  await expect(swatches.nth(1)).toHaveAttribute('aria-label', '背景色 #D9D9D9');
  await expect(page.locator('[data-param="hatch.ink"]')).toBeVisible();
  await expect(page.locator('[data-param="tone.brightness"]')).toBeVisible();
  await expect(page.locator('[data-param="tone.linear"]')).toHaveCount(0);

  // 预设模块只列排线的方案，「重置」退回排线的默认方案
  await expect(page.locator('[data-preset="hatch-classic"]')).toBeVisible();
  await expect(page.locator('[data-preset="gameboy"]')).toHaveCount(0);
  await page.locator('[data-preset="hatch-pencil"]').click();
  await expect(page.getByTestId('preset-status')).toHaveText('当前方案：Pencil');
  await expect(page.locator('[data-param="hatch.angle"] input[type="range"]')).toHaveValue('60');
  await expect(sectionLabels(page)).toHaveText(['基础', '笔画', '颜色', '影调']);
  await page.getByTestId('reset-preset').click();
  await expect(page.getByTestId('preset-status')).toHaveText('当前方案：Hatching');
  await expect(page.locator('[data-param="hatch.angle"] input[type="range"]')).toHaveValue('45');

  // 像素尺寸一个滑杆同时写横纵；「横纵分开」打开才换成横 / 纵各自的滑杆，关掉时纵向跟着横向走
  const cell = page.locator('[data-param="hatch.cell"] input[type="range"]');
  await cell.fill('20');
  await expect(cell).toHaveValue('20');
  await page.locator('[data-param="hatch.cell.split"]').click();
  await expect(basicParams(page).nth(1)).toHaveAttribute('data-param', 'hatch.spacingX');
  await expect(basicParams(page).nth(2)).toHaveAttribute('data-param', 'hatch.spacingY');
  await expect(basicParams(page).nth(3)).toHaveAttribute('data-param', 'hatch.cell.split');
  await expect(page.locator('[data-param="hatch.cell"]')).toHaveCount(0);
  await expect(page.locator('[data-param="hatch.spacingX"] input[type="range"]')).toHaveValue('20');
  await expect(page.locator('[data-param="hatch.spacingY"] input[type="range"]')).toHaveValue('20');
  await page.locator('[data-param="hatch.spacingY"] input[type="range"]').fill('30');
  await expect(page.locator('[data-section="basic"] .section__summary')).toHaveText('排线 · 45° · 像素 20×30');
  await page.locator('[data-param="hatch.cell.split"]').click();
  await expect(page.locator('[data-param="hatch.spacingY"]')).toHaveCount(0);
  await expect(page.locator('[data-param="hatch.cell"] input[type="range"]')).toHaveValue('20');
  await expect(page.locator('[data-section="basic"] .section__summary')).toHaveText('排线 · 45° · 像素 20');
  // 方案本身横纵不等（Rain 是 7×16）时「横纵分开」自动打开
  await page.locator('[data-preset="hatch-rain"]').click();
  await expect(page.locator('[data-param="hatch.cell.split"] input[role="switch"]')).toBeChecked();
  await expect(page.locator('[data-param="hatch.spacingX"] input[type="range"]')).toHaveValue('7');
  await expect(page.locator('[data-param="hatch.spacingY"] input[type="range"]')).toHaveValue('16');
  await page.getByTestId('reset-preset').click();
  await expect(page.locator('[data-param="hatch.cell"] input[type="range"]')).toHaveValue('14');

  // 切回抖动：抖动那套回来，排线的预设不在列表里
  await page.getByRole('tab', { name: '抖动' }).click();
  await expect(page.locator('.pane--params')).toHaveAttribute('data-style', 'dither');
  await expect(basicParams(page).nth(0)).toHaveAttribute('data-param', 'dither.family');
  await expect(page.locator('[data-preset="gameboy"]')).toBeVisible();
  await expect(page.locator('[data-preset="hatch-classic"]')).toHaveCount(0);
  await expect(page.locator('[data-section="hatch"]')).toHaveCount(0);

  // 历史页照旧，回来时停在当前风格
  await page.getByRole('tab', { name: '历史' }).click();
  await expect(page.getByTestId('history-pane')).toBeVisible();
  await page.getByRole('tab', { name: '排线' }).click();
  await expect(page.getByTestId('preset-picker')).toBeVisible();
  await expect(page.locator('.pane--params')).toHaveAttribute('data-style', 'hatch');
});

test('排线渲染：暗处笔画粗、亮处细；改影调与角度都重画；导出帧出真正的笔画', async ({ page }) => {
  await dropSyntheticImage(page);
  await page.getByRole('tab', { name: '排线' }).click();
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true');

  const inkRatio = async (x0: number, x1: number) =>
    page.evaluate(
      ([a, b]) => {
        const canvas = document.querySelector('.slot__canvas') as HTMLCanvasElement;
        const { width, height } = canvas;
        const data = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
        let ink = 0;
        let total = 0;
        for (let y = 0; y < height; y++) {
          for (let x = Math.floor(width * a); x < Math.floor(width * b); x++) {
            total++;
            if (data[(y * width + x) * 4] < 100) ink++;
          }
        }
        return ink / total;
      },
      [x0, x1] as const,
    );
  // 等排线那一帧画上去：左侧（暗）墨多于右侧（亮）
  await expect.poll(async () => (await inkRatio(0, 0.2)) - (await inkRatio(0.8, 1))).toBeGreaterThan(0.2);
  const darkBefore = await inkRatio(0, 0.2);

  // 影调对排线生效：提亮后暗部墨变少
  const slot = page.locator('[data-slot="0"]');
  const before = await slot.getAttribute('data-render-seq');
  await page.locator('[data-param="tone.brightness"] input[type="range"]').fill('60');
  await expect.poll(() => slot.getAttribute('data-render-seq')).not.toBe(before);
  await expect.poll(() => inkRatio(0, 0.2)).toBeLessThan(darkBefore);

  // 导出帧：SVG 里是圆角矩形定义 + use 摆放的真笔画，尺寸与画布一致
  const svgDownload = page.waitForEvent('download');
  await page.getByTestId('export-svg').click();
  const svgFile = await svgDownload;
  expect(svgFile.suggestedFilename()).toBe('sample-dither.svg');
  const svg = readFileSync((await svgFile.path())!, 'utf8');
  expect(svg.startsWith('<svg xmlns=')).toBe(true);
  expect(svg).toContain('viewBox="0 0 1000 600"');
  expect(svg).toContain('<defs><rect id="s0-');
  expect(svg).toContain('rotate(-45)');
  expect((svg.match(/<use /g) ?? []).length).toBeGreaterThan(1000);
  // 栅格化回来与画布大体一致（笔画边缘的抗锯齿由浏览器算，允许更多差异）
  const mismatch = await page.evaluate(async (text) => {
    const canvas = document.querySelector('.slot__canvas') as HTMLCanvasElement;
    const { width: w, height: h } = canvas;
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
    await img.decode();
    const shot = document.createElement('canvas');
    shot.width = w;
    shot.height = h;
    shot.getContext('2d')!.drawImage(img, 0, 0, w, h);
    const a = canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
    const b = shot.getContext('2d')!.getImageData(0, 0, w, h).data;
    let diff = 0;
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 64) diff++;
    return diff / (w * h);
  }, svg);
  expect(mismatch).toBeLessThan(0.03);
});

const canvasPixels = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector('.slot__canvas') as HTMLCanvasElement;
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    const out: number[] = [];
    for (let i = 0; i < data.length; i += 4) out.push(data[i]);
    return out;
  });

/** 切 GPU 开关不会让流水线缓存失效：把阈值改一下再改回来，逼它按当前开关把同一套参数重算一遍 */
async function recompute(page: Page) {
  const slot = page.locator('[data-slot="0"]');
  const range = page.locator('[data-param="tone.threshold"] input[type="range"]');
  for (const value of ['129', '128']) {
    const before = await slot.getAttribute('data-render-seq');
    await range.fill(value);
    await expect.poll(() => slot.getAttribute('data-render-seq')).not.toBe(before);
  }
}

test('排线的 GPU 路径与 CPU 结果一致', async ({ page }) => {
  await dropSyntheticImage(page);
  await page.getByRole('tab', { name: '排线' }).click();
  // 交叉排线 + 沿斜线连线 + 错行：把着色器的每条分支都走到
  await page.locator('[data-param="hatch.cross"]').click();
  await page.locator('[data-param="hatch.link"]').click();
  await page.getByRole('option', { name: '沿斜线', exact: true }).click();
  await recompute(page);
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-gpu', 'true');
  const gpuPixels = await canvasPixels(page);

  await page.getByTestId('settings-button').click();
  await page.locator('[data-param="settings.gpu"]').click();
  await page.keyboard.press('Escape');
  await recompute(page);
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-gpu', 'false');
  const cpuPixels = await canvasPixels(page);

  // 两条路径同一套距离场；抗锯齿边缘允许浮点误差
  let diff = 0;
  for (let i = 0; i < gpuPixels.length; i++) if (Math.abs(gpuPixels[i] - cpuPixels[i]) > 8) diff++;
  expect(diff / gpuPixels.length).toBeLessThan(0.005);
  await expect(page.locator('.tda-toast--error')).toHaveCount(0);
});
