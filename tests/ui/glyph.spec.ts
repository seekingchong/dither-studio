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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
});

test('符号页签：自己的预设与分节，阶梯表随灰阶变化，选形状转自定义，改颜色转分级配色', async ({ page }) => {
  await page.goto('/');
  await dropImage(page);
  await page.getByRole('tab', { name: '符号' }).click();
  await expect(page.locator('.pane--params')).toHaveAttribute('data-style', 'glyph');
  await expect(sectionLabels(page)).toHaveText(['基础', '符号', '颜色', '影调', '特效']);

  // 符号自己的预设：「默认」在最前且选中，网点的卡片不在这里
  await expect(page.locator('[data-preset="glyph-default"]')).toHaveClass(/is-active/);
  await expect(page.locator('[data-preset="ht-poster"]')).toHaveCount(0);
  await expect(page.getByTestId('preset-status')).toHaveText('当前方案：默认');

  // 「基础」领头的是序列、灰阶、像素尺寸（+ 横纵分开）、角度、排列；网点的形状不在这里
  const basic = page.locator('[data-section="basic"] .param-grid').first().locator('.tda-select, .tda-field');
  await expect(basic.nth(0)).toHaveAttribute('data-param', 'glyph.ramp');
  await expect(basic.nth(1)).toHaveAttribute('data-param', 'glyph.levels');
  await expect(basic.nth(2)).toHaveAttribute('data-param', 'tile.cell');
  await expect(basic.nth(3)).toHaveAttribute('data-param', 'tile.cell.split');
  await expect(basic.nth(4)).toHaveAttribute('data-param', 'tile.angle');
  await expect(basic.nth(5)).toHaveAttribute('data-param', 'tile.lattice');
  await expect(page.locator('[data-param="halftone.shape"]')).toHaveCount(0);
  await expect(page.locator('[data-param="pixel.size"]')).toHaveCount(0);

  // 阶梯表：5 行，从亮到暗 短竖 → … → 密网；每一阶的形状 / 颜色不在参数栅格里单独出现，栅格里是大小等共用参数
  const rows = page.locator('[data-testid="glyph-levels"] .glyph-level');
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'tick');
  await expect(rows.nth(4).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'hashx');
  await expect(page.locator('.tda-select[data-param="glyph.shape1"]')).toHaveCount(0);
  const shared = page.locator('[data-section="glyphs"] .param-grid').first().locator('.tda-select, .tda-field');
  await expect(shared.nth(0)).toHaveAttribute('data-param', 'glyph.size');
  await expect(shared.nth(1)).toHaveAttribute('data-param', 'glyph.taper');
  await expect(page.locator('[data-param="glyph.color1"].tda-color')).toHaveCount(0);

  // 结果是抗锯齿的符号：颜色不止两种
  await expect
    .poll(() =>
      page.evaluate(() => {
        const canvas = document.querySelector('.slot__canvas') as HTMLCanvasElement;
        const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
        const seen = new Set<number>();
        for (let i = 0; i < data.length; i += 4) seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
        return seen.size;
      }),
    )
    .toBeGreaterThan(2);

  // 灰阶改成 8：阶梯表 8 行，推荐序列重新挑，两端还是最亮与最暗的那两个
  await page.locator('[data-param="glyph.levels"] input[type="range"]').fill('8');
  await expect(rows).toHaveCount(8);
  await expect(rows.nth(0).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'tick');
  await expect(rows.nth(7).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'hashx');
  await expect(page.getByTestId('glyph-levels')).toHaveAttribute('data-ramp', 'sketch');

  // 点第 3 阶的形状，在选择器里选「圆点」：序列变成自定义，其余阶不变
  await rows.nth(2).locator('.glyph-level__shape').click();
  const picker = page.getByTestId('glyph-picker');
  await expect(picker).toBeVisible();
  await expect(picker.locator('[data-glyph]').first()).toHaveAttribute('data-glyph', 'blank');
  await picker.locator('[data-glyph="dot"]').click();
  await expect(picker).toHaveCount(0);
  await expect(rows.nth(2).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'dot');
  await expect(rows.nth(7).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'hashx');
  await expect(page.locator('[data-param="glyph.ramp"] .tda-select__value')).toHaveText('自定义');
  await expect(page.getByTestId('glyph-levels')).toHaveAttribute('data-ramp', 'custom');
  await expect(page.getByTestId('preset-status')).toHaveText('当前方案：默认 · 已微调');
  // 在「基础」里重新选一套序列就回到推荐
  await pick(page, 'glyph.ramp', '几何');
  await expect(rows.nth(7).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'square');
  await expect(rows.nth(0).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'blank');

  // 色板：统一色下两块（符号 / 背景）；点第 1 阶的颜色改成红，自动转成分级配色，色板变成 8 阶 + 背景
  const swatches = page.getByTestId('color-preview').locator('.swatch--btn');
  await expect(swatches).toHaveCount(2);
  await expect(swatches.nth(0)).toHaveAttribute('aria-label', '符号颜色 #111111');
  await rows.nth(0).locator('.glyph-level__color').click();
  const popover = page.getByTestId('color-popover');
  await expect(popover).toBeVisible();
  await popover.locator('.color-mode__btn[data-mode="hex"]').click();
  await popover.locator('.color-popover__hex').fill('#FF0000');
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await expect(page.locator('[data-param="glyph.colorMode"] .tda-select__value')).toHaveText('分级配色');
  await expect(swatches).toHaveCount(9);
  await expect(swatches.nth(0)).toHaveAttribute('aria-label', '第 1 阶 #FF0000');
  await expect(swatches.nth(1)).toHaveAttribute('aria-label', '第 2 阶 #111111');
  await expect(swatches.nth(8)).toHaveAttribute('aria-label', '背景色 #FFFFFF');
  await expect(rows.nth(0).locator('.glyph-level__color')).toHaveAttribute('aria-label', '第 1 阶颜色 #FF0000');

  // 原图色：行里没有色块，色板只剩背景；收起「颜色」节摘要写着原图色
  await openSection(page, 'color');
  await pick(page, 'glyph.colorMode', '原图色');
  await expect(rows.nth(0).locator('.glyph-level__color')).toHaveCount(0);
  await expect(swatches).toHaveCount(1);
  await page.locator('[data-section="color"] .section__toggle').click();
  await expect(page.locator('[data-section="color"] .section__summary')).toHaveText('原图色 · #FFFFFF');
  await page.locator('[data-section="color"] .section__toggle').click();
});

test('符号：挪过来的 Typewriter / Symbol Sketch 预设，切页签不丢参数，历史摘要与 SVG 出线段', async ({ page }) => {
  await page.goto('/');
  await dropImage(page);
  await page.getByRole('tab', { name: '符号' }).click();
  const rows = page.locator('[data-testid="glyph-levels"] .glyph-level');

  // Typewriter：7 阶自定义序列 留白 → 横线 → 4 → 6 → % → 圆点 → 三角，长方格自动「横纵分开」
  await page.locator('[data-preset="glyph-typewriter"]').click();
  await expect(page.locator('[data-preset="glyph-typewriter"]')).toHaveClass(/is-active/);
  await expect(page.locator('[data-param="glyph.ramp"] .tda-select__value')).toHaveText('自定义');
  await expect(rows).toHaveCount(7);
  await expect(rows.nth(0).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'blank');
  await expect(rows.nth(1).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'dash');
  await expect(rows.nth(5).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'dot');
  await expect(rows.nth(6).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'tri');
  await expect(page.locator('[data-param="tile.pitchX"] input[type="range"]')).toHaveValue('11');
  await expect(page.locator('[data-param="tile.pitchY"] input[type="range"]')).toHaveValue('13');
  await expect(page.locator('[data-param="glyph.mix"] input[type="range"]')).toHaveValue('60');
  await expect(page.locator('[data-param="glyph.paper"] input[type="text"]')).toHaveValue('#F6F1E3');
  await page.locator('[data-section="basic"] .section__toggle').click();
  await expect(page.locator('[data-section="basic"] .section__summary')).toHaveText('自定义 · 7 阶 · 11 × 13px · 0°');
  await page.locator('[data-section="basic"] .section__toggle').click();
  await page.locator('[data-section="glyphs"] .section__toggle').click();
  await expect(page.locator('[data-section="glyphs"] .section__summary')).toHaveText('7 阶 · 72% · 线粗 14% …');
  await page.locator('[data-section="glyphs"] .section__toggle').click();

  // 切到网点再回来：Typewriter 还在，网点那边没有它
  await page.getByRole('tab', { name: '网点' }).click();
  await expect(page.locator('.pane--params')).toHaveAttribute('data-style', 'halftone');
  await expect(page.locator('[data-preset="glyph-typewriter"]')).toHaveCount(0);
  await expect(page.locator('[data-preset="halftone-default"]')).toHaveClass(/is-active/);
  await page.getByRole('tab', { name: '符号' }).click();
  await expect(page.getByTestId('preset-status')).toHaveText('当前方案：Typewriter');
  await expect(rows).toHaveCount(7);

  // 保存成我的预设：只出现在符号页签；历史页摘要以「符号」开头；应用回来页签跟着回到符号
  await page.getByTestId('preset-save-button').click();
  await expect(page.getByLabel('新预设名称')).toHaveValue('Typewriter 副本');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.preset-card--user')).toHaveCount(1);
  await page.getByRole('tab', { name: '抖动' }).click();
  await expect(page.locator('.preset-card--user')).toHaveCount(0);
  await page.getByRole('tab', { name: '历史' }).click();
  await expect(page.locator('.history-item__meta')).toHaveText(/基于 Typewriter · 符号 · 自定义 · 7 阶 · 11×13px/);
  await page.locator('.history-item').getByRole('button', { name: '应用', exact: true }).click();
  await expect(page.getByRole('tab', { name: '符号' })).toHaveAttribute('aria-selected', 'true');

  // Symbol Sketch：圆点 → 斜线 → 十字 → 网格 → 点线，亮部缩小 68%
  await page.locator('[data-preset="glyph-sketch"]').click();
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'dot');
  await expect(rows.nth(4).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'dotslash');
  await expect(page.locator('[data-param="glyph.taper"] input[type="range"]')).toHaveValue('68');
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true');

  // 撤销能跨风格页签回退：选预设 → 切页签
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('preset-status')).toHaveText('当前方案：Typewriter 副本');

  // 导出帧：符号是 <line> / 描边 <circle>，线粗与圆头写在 <g> 上
  await page.locator('[data-preset="glyph-sketch"]').click();
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true');
  const svgDownload = page.waitForEvent('download');
  await page.getByTestId('export-svg').click();
  const svgFile = await svgDownload;
  expect(svgFile.suggestedFilename()).toBe('sample-dither.svg');
  const svg = readFileSync((await svgFile.path())!, 'utf8');
  expect(svg).toContain('viewBox="0 0 1000 600"');
  expect(svg).toMatch(/<g [^>]*stroke-linecap="round"/);
  expect((svg.match(/<line /g) ?? []).length).toBeGreaterThan(100);
  expect((svg.match(/<circle /g) ?? []).length).toBeGreaterThan(100);
  expect(svg).toMatch(/<circle [^>]*fill="none" stroke="#111111"/);
});

test('符号：按参考图做的几套预设（Lime Circuit / Checkmate / PETSCII Glitch / Acid Cipher / Riso Signal / Aperture Grille）用上新符号，选择器里能挑到它们', async ({ page }) => {
  await page.goto('/');
  await dropImage(page);
  await page.getByRole('tab', { name: '符号' }).click();
  const rows = page.locator('[data-testid="glyph-levels"] .glyph-level');

  // 两套新预设排在折叠线以下，先展开卡片
  await page.getByTestId('preset-more').click();

  // Lime Circuit：8 阶自定义序列 空 → 小点 → 短斜线 → 十字 → 叉号 → 双圈 → 圆角框 → 四叶，荧光绿配黑纸
  await page.locator('[data-preset="glyph-circuit"]').click();
  await expect(page.locator('[data-preset="glyph-circuit"]')).toHaveClass(/is-active/);
  await expect(page.locator('[data-param="glyph.ramp"] .tda-select__value')).toHaveText('自定义');
  await expect(rows).toHaveCount(8);
  await expect(rows.nth(0).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'blank');
  await expect(rows.nth(2).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'slashshort');
  await expect(rows.nth(4).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'xmark');
  await expect(rows.nth(5).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'rings');
  await expect(rows.nth(6).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'roundbox');
  await expect(rows.nth(7).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'clover');
  await expect(rows.nth(7).locator('.glyph-level__label')).toHaveText('四叶');
  await expect(page.locator('[data-param="glyph.ink"] input[type="text"]')).toHaveValue('#C8FF1A');
  await expect(page.locator('[data-param="glyph.paper"] input[type="text"]')).toHaveValue('#0A0A0A');
  await expect(page.locator('[data-param="glyph.taper"] input[type="range"]')).toHaveValue('55');
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true');

  // 选择器里新符号都在，各自在自己的组里：双圈在「点」、折线在「线」、城堡在「几何」
  await rows.nth(5).locator('.glyph-level__shape').click();
  const picker = page.getByTestId('glyph-picker');
  await expect(picker).toBeVisible();
  await expect(picker.locator('[data-glyph]')).toHaveCount(93);
  await expect(picker.locator('[data-glyph="rings"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(picker.getByRole('group', { name: '点' }).locator('[data-glyph="rings"]')).toHaveCount(1);
  await expect(picker.getByRole('group', { name: '线' }).locator('[data-glyph="zigzag"]')).toHaveCount(1);
  await expect(picker.getByRole('group', { name: '几何' }).locator('[data-glyph="rook"]')).toHaveCount(1);
  // 换成六边框：只改这一阶
  await picker.locator('[data-glyph="hexline"]').click();
  await expect(picker).toHaveCount(0);
  await expect(rows.nth(5).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'hexline');
  await expect(rows.nth(7).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'clover');
  await expect(page.getByTestId('preset-status')).toHaveText('当前方案：Lime Circuit · 已微调');

  // Checkmate：7 阶 空 → 小点 → 花 → 折线 → 竖纹 → 棋盘 → 城堡，分级配色，色板 7 阶 + 背景
  await page.locator('[data-preset="glyph-checkmate"]').click();
  await expect(page.locator('[data-preset="glyph-checkmate"]')).toHaveClass(/is-active/);
  await expect(rows).toHaveCount(7);
  await expect(rows.nth(1).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'pip');
  await expect(rows.nth(2).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'flower');
  await expect(rows.nth(3).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'zigzag');
  await expect(rows.nth(4).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'stripes');
  await expect(rows.nth(5).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'checker');
  await expect(rows.nth(6).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'rook');
  await expect(rows.nth(6).locator('.glyph-level__label')).toHaveText('城堡');
  await expect(page.locator('[data-param="glyph.colorMode"] .tda-select__value')).toHaveText('分级配色');
  const swatches = page.getByTestId('color-preview').locator('.swatch--btn');
  await expect(swatches).toHaveCount(8);
  await expect(swatches.nth(1)).toHaveAttribute('aria-label', '第 2 阶 #9C9FE9');
  await expect(swatches.nth(6)).toHaveAttribute('aria-label', '第 7 阶 #5EE6A2');
  await expect(swatches.nth(7)).toHaveAttribute('aria-label', '背景色 #0F5C3F');
  await expect(page.locator('[data-param="glyph.size"] input[type="range"]')).toHaveValue('100');
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true');

  // PETSCII Glitch：「终端」序列 8 阶 空 → 逗号 → 双点 → C → K → % → Ø → 实心块，分级配色青绿逐阶交替，近黑纸
  await page.locator('[data-preset="glyph-petscii"]').click();
  await expect(page.locator('[data-preset="glyph-petscii"]')).toHaveClass(/is-active/);
  await expect(page.getByTestId('preset-status')).toHaveText('当前方案：PETSCII Glitch');
  await expect(page.locator('[data-param="glyph.ramp"] .tda-select__value')).toHaveText('终端');
  await expect(rows).toHaveCount(8);
  await expect(rows.nth(1).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'comma');
  await expect(rows.nth(3).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'see');
  await expect(rows.nth(4).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'kay');
  await expect(rows.nth(6).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'oslash');
  await expect(rows.nth(7).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'block');
  await expect(rows.nth(7).locator('.glyph-level__label')).toHaveText('实心格');
  await expect(page.locator('[data-param="glyph.colorMode"] .tda-select__value')).toHaveText('分级配色');
  await expect(swatches).toHaveCount(9);
  await expect(swatches.nth(6)).toHaveAttribute('aria-label', '第 7 阶 #29C8E0');
  await expect(swatches.nth(7)).toHaveAttribute('aria-label', '第 8 阶 #C3E82B');
  await expect(swatches.nth(8)).toHaveAttribute('aria-label', '背景色 #05070B');
  await expect(page.locator('[data-param="glyph.mix"] input[type="range"]')).toHaveValue('85');
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true');

  // Acid Cipher：8 阶 小点 → 短斜线 → 十字 → 圆圈 → 叉号 → 靶心 → 圈十 → 圈叉，统一墨色配柠檬绿纸，不反相
  await page.locator('[data-preset="glyph-cipher"]').click();
  await expect(page.locator('[data-preset="glyph-cipher"]')).toHaveClass(/is-active/);
  await expect(page.locator('[data-param="glyph.ramp"] .tda-select__value')).toHaveText('自定义');
  await expect(rows).toHaveCount(8);
  await expect(rows.nth(0).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'pip');
  await expect(rows.nth(1).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'ringtiny');
  await expect(rows.nth(2).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'quad');
  await expect(rows.nth(3).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'ring');
  await expect(rows.nth(5).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'circlex');
  await expect(rows.nth(6).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'rings3');
  await expect(rows.nth(7).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'ringthick');
  await expect(rows.nth(7).locator('.glyph-level__label')).toHaveText('粗圈');
  await expect(page.locator('[data-param="glyph.colorMode"] .tda-select__value')).toHaveText('统一色');
  await expect(page.locator('[data-param="glyph.ink"] input[type="text"]')).toHaveValue('#0E150A');
  await expect(page.locator('[data-param="glyph.paper"] input[type="text"]')).toHaveValue('#C9F52C');
  await expect(page.locator('[data-param="glyph.taper"] input[type="range"]')).toHaveValue('38');
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true');

  // Riso Signal：8 阶 空 → 小点 → 三角 → 圆点 → 圆圈 → 叠圈 → 短竖纹 → 圆点，米白纸上只有第 3 / 4 阶是彩色
  await page.locator('[data-preset="glyph-riso"]').click();
  await expect(page.locator('[data-preset="glyph-riso"]')).toHaveClass(/is-active/);
  await expect(page.getByTestId('preset-status')).toHaveText('当前方案：Riso Signal');
  await expect(rows).toHaveCount(8);
  await expect(rows.nth(2).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'tri');
  await expect(rows.nth(3).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'dot');
  await expect(rows.nth(4).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'ring');
  await expect(rows.nth(5).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'ringpair');
  await expect(rows.nth(5).locator('.glyph-level__label')).toHaveText('叠圈');
  await expect(rows.nth(6).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'comb');
  await expect(rows.nth(6).locator('.glyph-level__label')).toHaveText('短竖纹');
  await expect(rows.nth(7).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'dot');
  await expect(swatches).toHaveCount(9);
  await expect(swatches.nth(2)).toHaveAttribute('aria-label', '第 3 阶 #F0562C');
  await expect(swatches.nth(3)).toHaveAttribute('aria-label', '第 4 阶 #3FAF6B');
  await expect(swatches.nth(4)).toHaveAttribute('aria-label', '第 5 阶 #1A1A1A');
  await expect(swatches.nth(8)).toHaveAttribute('aria-label', '背景色 #EDEAE3');
  await expect(page.locator('[data-param="glyph.taper"] input[type="range"]')).toHaveValue('42');
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true');

  // 新符号在选择器里各自的组：叠圈在「点」、短竖纹在「线」
  await rows.nth(6).locator('.glyph-level__shape').click();
  await expect(picker).toBeVisible();
  await expect(picker.locator('[data-glyph]')).toHaveCount(93);
  await expect(picker.getByRole('group', { name: '点' }).locator('[data-glyph="ringpair"]')).toHaveCount(1);
  await expect(picker.getByRole('group', { name: '线' }).locator('[data-glyph="comb"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  // Aperture Grille：7 阶 留空 → 竖栅微 / 细 / 中 / 粗 / 满 → 实心格，分级配色深靛到暖白，近黑纸
  await page.locator('[data-preset="glyph-grille"]').click();
  await expect(page.locator('[data-preset="glyph-grille"]')).toHaveClass(/is-active/);
  await expect(page.getByTestId('preset-status')).toHaveText('当前方案：Aperture Grille');
  await expect(rows).toHaveCount(7);
  await expect(rows.nth(0).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'blank');
  await expect(rows.nth(1).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'grillehair');
  await expect(rows.nth(3).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'grillemid');
  await expect(rows.nth(5).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'grillefull');
  await expect(rows.nth(5).locator('.glyph-level__label')).toHaveText('竖栅·满');
  await expect(rows.nth(6).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'block');
  await expect(rows.nth(6).locator('.glyph-level__label')).toHaveText('实心格');
  await expect(swatches).toHaveCount(8);
  await expect(swatches.nth(6)).toHaveAttribute('aria-label', '第 7 阶 #FFF6E2');
  await expect(swatches.nth(7)).toHaveAttribute('aria-label', '背景色 #04070C');
  await expect(page.locator('[data-param="tile.cell"] input[type="range"]')).toHaveValue('16');
  await expect(page.locator('[data-param="glyph.mix"] input[type="range"]')).toHaveValue('45');
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true');

  // 竖栅一家在选择器的「线」组里，实心格在「几何」组
  await rows.nth(3).locator('.glyph-level__shape').click();
  const grillePicker = page.getByTestId('glyph-picker');
  await expect(grillePicker.getByRole('group', { name: '线' }).locator('[data-glyph="grillebold"]')).toHaveCount(1);
  await expect(grillePicker.getByRole('group', { name: '几何' }).locator('[data-glyph="block"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
});

test('符号：Desync 预设——短横、细板、横板到穿孔块与实心方，第 5、6 阶荧光黄绿，特效栈里扫描行位移加颗粒', async ({ page }) => {
  await page.goto('/');
  await dropImage(page);
  await page.getByRole('tab', { name: '符号' }).click();
  await page.getByTestId('preset-more').click();
  await page.locator('[data-preset="glyph-desync"]').click();
  await expect(page.locator('[data-preset="glyph-desync"]')).toHaveClass(/is-active/);
  await expect(page.locator('[data-param="glyph.ramp"] .tda-select__value')).toHaveText('自定义');
  const rows = page.locator('[data-testid="glyph-levels"] .glyph-level');
  await expect(rows).toHaveCount(8);
  for (const [k, id] of [
    [0, 'blank'],
    [1, 'minus'],
    [2, 'slabthin'],
    [3, 'slab'],
    [4, 'blockhole'],
    [5, 'square'],
    [6, 'blockhole'],
    [7, 'square'],
  ] as const) {
    await expect(rows.nth(k).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', id);
  }
  await expect(rows.nth(2).locator('.glyph-level__label')).toHaveText('细板');
  await expect(rows.nth(4).locator('.glyph-level__label')).toHaveText('穿孔块');
  // 分级配色：第 5、6 阶荧光黄绿成片，其余墨黑，最后一格是纸色
  await expect(page.locator('[data-param="glyph.colorMode"] .tda-select__value')).toHaveText('分级配色');
  const swatches = page.getByTestId('color-preview').locator('.swatch--btn');
  await expect(swatches).toHaveCount(9);
  await expect(swatches.nth(4)).toHaveAttribute('aria-label', '第 5 阶 #D6FF1A');
  await expect(swatches.nth(5)).toHaveAttribute('aria-label', '第 6 阶 #D6FF1A');
  await expect(swatches.nth(6)).toHaveAttribute('aria-label', '第 7 阶 #111111');
  await expect(swatches.nth(8)).toHaveAttribute('aria-label', '背景色 #F2F2EE');
  await expect(page.locator('[data-param="glyph.size"] input[type="range"]')).toHaveValue('140');
  await expect(page.locator('[data-param="glyph.taper"] input[type="range"]')).toHaveValue('35');
  await expect(page.locator('[data-param="glyph.mix"] input[type="range"]')).toHaveValue('80');
  // 特效栈：扫描行位移的带高与格子等高，后面跟一点颗粒
  await openSection(page, 'effects');
  await expect(page.locator('.effect-card')).toHaveCount(2);
  await expect(page.locator('.effect-card').nth(0)).toContainText('扫描行位移');
  await expect(page.locator('.effect-card').nth(1)).toContainText('胶片颗粒');
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true');

  // 新符号在选择器里各归各组：细板 / 横板 / 厚板在「线」，穿孔块 / 半块在「几何」
  await rows.nth(2).locator('.glyph-level__shape').click();
  const picker = page.getByTestId('glyph-picker');
  await expect(picker.locator('[data-glyph]')).toHaveCount(93);
  for (const id of ['slabthin', 'slab', 'slabwide']) {
    await expect(picker.getByRole('group', { name: '线' }).locator(`[data-glyph="${id}"]`)).toHaveCount(1);
  }
  for (const id of ['blockhole', 'blockhalf']) {
    await expect(picker.getByRole('group', { name: '几何' }).locator(`[data-glyph="${id}"]`)).toHaveCount(1);
  }
  await picker.locator('[data-glyph="slabwide"]').click();
  await expect(rows.nth(2).locator('.glyph-level__shape')).toHaveAttribute('data-glyph', 'slabwide');
  await expect(page.getByTestId('preset-status')).toHaveText('当前方案：Desync · 已微调');
});
