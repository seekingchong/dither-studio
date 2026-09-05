import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openSection, sectionLabels } from './helpers';

/** 合成一张带明暗层次的测试图放进坑位 0：左暗右亮的渐变上放一个亮圆 */
async function dropImage(page: Page) {
  await page.locator('[data-slot="0"]').waitFor();
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 600;
    c.height = 360;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 600, 0);
    g.addColorStop(0, '#101010');
    g.addColorStop(1, '#f0f0f0');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 600, 360);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(200, 180, 90, 0, Math.PI * 2);
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

/** 画布上出现过的颜色数（按 RGB 去重） */
async function canvasColorCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('.slot__canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4) seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    return seen.size;
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
});

test('网点页签：自己的预设与分节，来回切换不丢参数，保存与历史按风格分开，SVG 出真网点', async ({ page }) => {
  await page.goto('/');
  await dropImage(page);

  // 左栏页签：抖动 / 排线 / 网点 / 历史，默认在抖动
  const tabs = page.locator('.pane--params .pane-actions [role="tab"]');
  await expect(tabs).toHaveText(['抖动', '排线', '网点', '历史']);
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: '网点' }).click();
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.pane--params')).toHaveAttribute('data-style', 'halftone');
  await expect(sectionLabels(page)).toHaveText(['基础', '网点', '颜色', '影调', '特效']);

  // Halftone 自己的预设：「默认」在最前且选中，Dither 的卡片不在这里
  await expect(page.locator('[data-preset="halftone-default"]')).toHaveClass(/is-active/);
  await expect(page.locator('[data-preset="gameboy"]')).toHaveCount(0);
  await expect(page.getByTestId('preset-status')).toHaveText('当前方案：默认');
  await expect(page.locator('.preset-card').first()).toHaveAttribute('data-preset', 'halftone-default');

  // 「基础」领头的是形状、横纵间距、角度、排列；「网点」里是大小、最小网点…；「颜色」里是网点色 / 背景色（色板也只有这两块）
  const basic = page.locator('[data-section="basic"] .param-grid').first().locator('.tda-select, .tda-field');
  await expect(basic.nth(0)).toHaveAttribute('data-param', 'halftone.shape');
  // 横纵间距合成一个「像素尺寸」+「横纵分开」开关，横 / 纵各自的滑杆只在开关打开后出现
  await expect(basic.nth(1)).toHaveAttribute('data-param', 'screen.cell');
  await expect(basic.nth(2)).toHaveAttribute('data-param', 'screen.cell.split');
  await expect(basic.nth(3)).toHaveAttribute('data-param', 'screen.angle');
  await expect(basic.nth(4)).toHaveAttribute('data-param', 'screen.lattice');
  await expect(page.locator('[data-param="screen.pitchX"]')).toHaveCount(0);
  await expect(page.locator('[data-param="screen.cell"] input[type="range"]')).toHaveValue('12');
  await expect(page.locator('[data-param="dither.family"]')).toHaveCount(0);
  await expect(page.locator('[data-param="pixel.size"]')).toHaveCount(0);
  await expect(page.locator('[data-param="pixel.method"]')).toHaveCount(0);
  const dots = page.locator('[data-section="dots"] .param-grid').first().locator('.tda-select, .tda-field');
  await expect(dots.nth(0)).toHaveAttribute('data-param', 'halftone.size');
  await expect(dots.nth(1)).toHaveAttribute('data-param', 'halftone.minSize');
  await expect(page.locator('[data-param="ink.dot"]')).toBeVisible();
  await expect(page.locator('[data-param="ink.paper"]')).toBeVisible();
  const swatches = page.getByTestId('color-preview').locator('.swatch--btn');
  await expect(swatches).toHaveCount(2);
  await expect(swatches.nth(0)).toHaveAttribute('aria-label', '网点颜色 #11192D');
  await expect(swatches.nth(1)).toHaveAttribute('aria-label', '背景色 #FFFFFF');
  // 线性空间开关对网点有效（面积正比在线性光里算墨量），留在影调的「更多参数」里
  await expect(page.locator('[data-param="tone.linear"]')).toHaveCount(1);
  // 分级级数只在打开分级后出现
  await expect(page.locator('[data-param="halftone.levels"]')).toHaveCount(0);

  // 结果是抗锯齿的网点：颜色不止两种（切页签后要等 Worker 把新一帧画上来）
  await expect.poll(() => canvasColorCount(page)).toBeGreaterThan(2);
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-gpu', 'false');

  // 选 Poster：红点、分 8 档；改网点大小后标成已微调
  await page.locator('[data-preset="ht-poster"]').click();
  await expect(page.locator('[data-preset="ht-poster"]')).toHaveClass(/is-active/);
  await expect(page.locator('[data-param="halftone.shape"] .tda-select__value')).toHaveText('圆形');
  await expect(page.locator('[data-param="ink.dot"] input[type="text"]')).toHaveValue('#E4002B');
  await expect(page.locator('[data-param="halftone.levels"] input[type="range"]')).toHaveValue('8');
  await page.locator('[data-param="halftone.size"] input[type="range"]').fill('80');
  await expect(page.getByTestId('preset-status')).toHaveText('当前方案：Poster · 已微调');

  // 切回抖动：那边还是默认方案，自己的参数没被动过（影调三种风格共用，Poster 带的对比度 +15 在这边也算微调）；再切回来，Poster 与微调都还在
  await page.getByRole('tab', { name: '抖动' }).click();
  await expect(page.locator('.pane--params')).toHaveAttribute('data-style', 'dither');
  await expect(sectionLabels(page)).toHaveText(['基础', '颜色', '影调', '网格', '特效']);
  await expect(page.locator('[data-preset="default"]')).toHaveClass(/is-active/);
  await expect(page.getByTestId('preset-status')).toHaveText('当前方案：默认 · 已微调');
  await expect(page.locator('[data-param="dither.ordered.matrix"] .tda-select__value')).toHaveText('Bayer 2×2');
  await expect(page.locator('[data-param="tone.contrast"] input[type="range"]')).toHaveValue('15');
  await expect(page.locator('[data-preset="ht-poster"]')).toHaveCount(0);
  await page.getByRole('tab', { name: '网点' }).click();
  await expect(page.getByTestId('preset-status')).toHaveText('当前方案：Poster · 已微调');
  await expect(page.locator('[data-param="halftone.size"] input[type="range"]')).toHaveValue('80');

  // 颜色模式换成 CMYK：网点颜色那格收起来，色板只剩背景色
  await openSection(page, 'color');
  await pick(page, 'ink.mode', 'CMYK 分色');
  await expect(page.locator('[data-param="ink.dot"]')).toHaveCount(0);
  await expect(page.locator('[data-param="ink.paper"]')).toBeVisible();
  await expect(swatches).toHaveCount(1);
  await pick(page, 'ink.mode', '双色');

  // 保存成我的预设：只出现在网点页签，抖动页签里没有；历史页摘要以「网点」开头
  await page.getByTestId('preset-save-button').click();
  await expect(page.getByLabel('新预设名称')).toHaveValue('Poster 副本');
  await page.getByLabel('新预设名称').fill('我的网点');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.preset-card--user')).toHaveCount(1);
  await expect(page.locator('.preset-card--user')).toContainText('基于 Poster');
  await expect(page.getByTestId('preset-status')).toHaveText('当前方案：我的网点');
  await page.getByRole('tab', { name: '抖动' }).click();
  await expect(page.locator('.preset-card--user')).toHaveCount(0);
  await page.getByRole('tab', { name: '历史' }).click();
  await expect(page.locator('.history-item__meta')).toHaveText(/基于 Poster · 网点 · 圆形 · 14px · 双色/);
  // 从历史页应用回来：风格页签跟着回到网点
  await page.locator('.history-item').getByRole('button', { name: '应用', exact: true }).click();
  await expect(page.getByRole('tab', { name: '网点' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('preset-status')).toHaveText('当前方案：我的网点');

  // 导出帧：真矢量——每颗点一个 <circle>，网格旋转写在 <g transform> 上
  const svgDownload = page.waitForEvent('download');
  await page.getByTestId('export-svg').click();
  const svgFile = await svgDownload;
  expect(svgFile.suggestedFilename()).toBe('sample-dither.svg');
  const svg = readFileSync((await svgFile.path())!, 'utf8');
  expect(svg.startsWith('<svg xmlns=')).toBe(true);
  expect(svg).toContain('viewBox="0 0 1000 600"');
  expect((svg.match(/<circle /g) ?? []).length).toBeGreaterThan(1000);
  expect(svg).toContain('fill="#E4002B"');
});

test('网点：形状、排列与融合都能切，撤销能跨风格页签回退', async ({ page }) => {
  await page.goto('/');
  await dropImage(page);
  await page.getByRole('tab', { name: '网点' }).click();
  await pick(page, 'halftone.shape', '三角');
  await expect(page.locator('[data-param="halftone.shape"] .tda-select__value')).toHaveText('三角');
  await pick(page, 'screen.lattice', '交错');
  await page.locator('[data-param="halftone.merge"] input[type="range"]').fill('60');
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true');
  // 收起两节，摘要写着形状 / 排列与融合
  await page.locator('[data-section="basic"] .section__toggle').click();
  await expect(page.locator('[data-section="basic"] .section__summary')).toHaveText('三角 · 12px · 0° · 交错');
  await page.locator('[data-section="dots"] .section__toggle').click();
  await expect(page.locator('[data-section="dots"] .section__summary')).toHaveText('100% · 最小 10% · 融合 60%');

  // 撤销：融合 → 排列 → 形状 → 切页签（回到抖动）
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('[data-section="basic"] .section__summary')).toHaveText('圆形 · 12px · 0°');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByRole('tab', { name: '抖动' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.getByRole('tab', { name: '网点' })).toHaveAttribute('aria-selected', 'true');
});
