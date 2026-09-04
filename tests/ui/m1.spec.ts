import { expect, test, type Page } from '@playwright/test';

/** 在页面里合成一张 800×500 的测试图并以拖拽方式放进坑位 0 */
async function dropSyntheticImage(page: Page) {
  // 入口是动态 import，load 事件后 React 才挂载，先等坑位出现
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
    const rg = ctx.createRadialGradient(520, 250, 10, 520, 250, 200);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, 800, 500);
    ctx.fillStyle = '#202020';
    ctx.beginPath();
    ctx.arc(220, 170, 90, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(120, 330, 300, 90);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
    const file = new File([blob], 'sample.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const target = document.querySelector('[data-slot="0"]')!;
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true');
}

async function pick(page: Page, paramId: string, optionLabel: string) {
  await page.locator(`[data-param="${paramId}"]`).click();
  await page.getByRole('option', { name: optionLabel, exact: true }).click();
}

const screenshotOptions = (_page: Page) => ({
  maxDiffPixelRatio: 0.01,
});

test.beforeEach(async ({ page }) => {
  // 强制走下载与 <input type=file> 回退路径，避免原生文件对话框
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
});

test('空态：无顶栏，设置在左栏操作行，参数面板与拖拽区', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('dropzone')).toBeVisible();
  // 应用内不再有顶栏；「设置」齿轮在左栏操作行里，预览头里没有分辨率 / 耗时小字
  await expect(page.locator('.topbar')).toHaveCount(0);
  await expect(page.locator('.pane--params .pane-actions').getByTestId('settings-button')).toBeVisible();
  await expect(page.getByTestId('preview-meta')).toHaveCount(0);
  // 导出只有预览头里那一个按钮，图片时叫「导出图片」；左栏一个导出按钮都没有
  await expect(page.locator('.pane--preview').getByRole('button', { name: '导出图片' })).toBeDisabled();
  await expect(page.locator('.pane--params').getByRole('button', { name: /导出/ })).toHaveCount(0);
  await expect(page).toHaveScreenshot('m1-empty.png', screenshotOptions(page));
});

test('打开图片后三个算法各出一张截图', async ({ page }) => {
  await page.goto('/');
  await dropSyntheticImage(page);
  // 默认：有序 Bayer 2×2、单色、像素尺寸 4
  await expect(page.locator('[data-param="dither.ordered.matrix"]')).toContainText('Bayer 2×2');
  await expect(page.locator('[data-param="color.mode"]')).toContainText('单色');
  await expect(page.locator('[data-param="pixel.size"] .tda-slider__range')).toHaveValue('4');
  await expect(page).toHaveScreenshot('m1-bayer2.png', screenshotOptions(page));

  await pick(page, 'dither.family', '误差扩散');
  await expect(page.locator('[data-param="dither.ed.kernel"]')).toContainText('Floyd–Steinberg');
  await page.waitForTimeout(200);
  await expect(page).toHaveScreenshot('m1-floyd-steinberg.png', screenshotOptions(page));

  await pick(page, 'dither.family', '阈值');
  await expect(page.locator('[data-param="dither.threshold.method"]')).toContainText('固定阈值');
  await page.waitForTimeout(200);
  await expect(page).toHaveScreenshot('m1-threshold.png', screenshotOptions(page));
});

test('缩放档位改变画布显示尺寸', async ({ page }) => {
  await page.goto('/');
  await dropSyntheticImage(page);
  const canvas = page.locator('.slot__canvas');
  const fitBox = (await canvas.boundingBox())!;
  expect(fitBox.width).toBeLessThan(1000);

  // 缩放在预览区右上角的「画布」菜单里
  await page.getByTestId('canvas-menu-button').click();
  await expect(page.getByTestId('canvas-menu')).toBeVisible();
  await page.locator('.preview-zoom .tda-select').click();
  await page.getByRole('option', { name: '100%' }).click();
  await expect.poll(async () => (await canvas.boundingBox())!.width).toBe(1000);

  await page.locator('.preview-zoom .tda-select').click();
  await page.getByRole('option', { name: '25%' }).click();
  await expect.poll(async () => (await canvas.boundingBox())!.width).toBe(250);
  await expect(page.getByTestId('canvas-menu-button')).toContainText('1000 × 600 · 25%');

  // 画布尺寸也在这里改：只有宽高两个输入框，常用尺寸芯片已去掉
  await expect(page.locator('.size-chip')).toHaveCount(0);
  const width = page.locator('[data-param="canvas.width"] input');
  const height = page.locator('[data-param="canvas.height"] input');
  await width.fill('800');
  await width.press('Enter');
  await height.fill('800');
  await height.press('Enter');
  await expect(page.getByTestId('canvas-menu-button')).toContainText('800 × 800');
  await expect.poll(async () => (await canvas.boundingBox())!.width).toBe(200);
  await width.fill('640');
  await width.press('Enter');
  await expect(page.getByTestId('canvas-menu-button')).toContainText('640 × 800');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('canvas-menu')).toHaveCount(0);
});

test('原图 / 结果切换与像素尺寸滑块', async ({ page }) => {
  await page.goto('/');
  await dropSyntheticImage(page);
  await page.getByRole('tab', { name: '原图' }).click();
  await expect(page.locator('.slot__canvas')).toHaveAttribute('data-tab', 'source');
  await page.getByRole('tab', { name: '结果' }).click();
  await expect(page.locator('.slot__canvas')).toHaveAttribute('data-tab', 'result');

  // 预览画布圆角是宽度的 7.2%（100px → 7.2，500px → 36），两个页签都有；
  // 它只是 DOM 上的 border-radius，导出的 PNG / 视频不带圆角
  const radiusRatio = () =>
    page.locator('.slot__canvas').evaluate((el) => {
      const cs = getComputedStyle(el);
      return Number.parseFloat(cs.borderTopLeftRadius) / Number.parseFloat(cs.width);
    });
  expect(await radiusRatio()).toBeCloseTo(0.072, 3);
  await page.getByRole('tab', { name: '原图' }).click();
  expect(await radiusRatio()).toBeCloseTo(0.072, 3);
  await page.getByRole('tab', { name: '结果' }).click();

  const input = page.locator('[data-param="pixel.size"] .tda-slider__input');
  await input.fill('16');
  await input.press('Enter');
  await expect(page.locator('[data-param="pixel.size"] .tda-slider__range')).toHaveValue('16');
});

test('导出图片触发 PNG 下载，Ctrl+C 复制当前帧 PNG 到剪贴板', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-write', 'clipboard-read']);
  await page.goto('/');
  await dropSyntheticImage(page);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出图片' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('sample-dither.png');
  const path = await download.path();
  expect(path).toBeTruthy();
  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync(path!);
  expect(Array.from(bytes.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // IHDR 宽高 = 1000 × 600
  expect(bytes.readUInt32BE(16)).toBe(1000);
  expect(bytes.readUInt32BE(20)).toBe(600);

  // 面板上没有复制按钮：焦点不在输入框时按复制快捷键即复制当前帧
  await expect(page.getByRole('button', { name: '复制 PNG' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '打开', exact: true })).toHaveCount(0);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+c');
  await expect(page.getByRole('status')).toContainText('已复制');
});
