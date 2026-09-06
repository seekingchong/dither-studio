import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { setZoom } from './helpers';

const GIF_B64 = readFileSync(fileURLToPath(new URL('./fixtures/anim.gif', import.meta.url))).toString('base64');

/** 造一个 400×250 的渐变 PNG 文件 */
async function makePng(page: Page, slot: number) {
  return page.evaluateHandle(async (slot) => {
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
    return new File([blob], `sample-${slot}.png`, { type: 'image/png' });
  }, slot);
}

async function dropImage(page: Page, slot = 0) {
  await page.locator(`[data-slot="${slot}"]`).waitFor();
  const file = await makePng(page, slot);
  await page.evaluate(
    ({ file, slot }) => {
      const dt = new DataTransfer();
      dt.items.add(file);
      document.querySelector(`[data-slot="${slot}"]`)!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    },
    { file, slot },
  );
  await expect(page.locator(`[data-slot="${slot}"]`)).toHaveAttribute('data-rendered', 'true');
}

async function dropGif(page: Page, slot: number) {
  await page.locator(`[data-slot="${slot}"]`).waitFor();
  await page.evaluate(
    ({ b64, slot }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], `anim-${slot}.gif`, { type: 'image/gif' }));
      document.querySelector(`[data-slot="${slot}"]`)!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    },
    { b64: GIF_B64, slot },
  );
  await expect(page.locator(`[data-slot="${slot}"]`)).toHaveAttribute('data-rendered', 'true');
}

async function pick(page: Page, paramId: string, optionLabel: string) {
  await page.locator(`[data-param="${paramId}"]`).click();
  await page.getByRole('option', { name: optionLabel, exact: true }).click();
}

async function useFourSlots(page: Page) {
  await page.getByTestId('settings-button').click();
  await pick(page, 'settings.slotCount', '4 个媒体');
  await page.keyboard.press('Escape');
  await expect(page.locator('.slot')).toHaveCount(4);
}

/** 每个有画布的坑位：画布中心与视口中心的偏差（px） */
async function centerOffsets(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.slot__viewport')).flatMap((vp) => {
      const c = vp.querySelector('.slot__canvas');
      if (!c) return [];
      const a = vp.getBoundingClientRect();
      const b = c.getBoundingClientRect();
      return [{ dx: Math.abs(a.x + a.width / 2 - (b.x + b.width / 2)), dy: Math.abs(a.y + a.height / 2 - (b.y + b.height / 2)) }];
    }),
  );
}

test('按系统拖拽的事件顺序把文件放进坑位后，全窗遮罩要消失', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-slot="0"]').waitFor();
  const file = await makePng(page, 0);
  await page.evaluate(async (file) => {
    const dt = new DataTransfer();
    dt.items.add(file);
    const ev = (type: string, related: Element | null = null) => new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, relatedTarget: related });
    const params = document.querySelector('.pane--params')!;
    const slot = document.querySelector('[data-slot="0"]')!;
    // 先从参数面板进入窗口，再移到坑位，最后在坑位松手（坑位会 stopPropagation）
    params.dispatchEvent(ev('dragenter'));
    params.dispatchEvent(ev('dragover'));
    await new Promise((r) => setTimeout(r, 30));
    params.dispatchEvent(ev('dragleave', slot));
    slot.dispatchEvent(ev('dragenter'));
    slot.dispatchEvent(ev('dragover'));
    await new Promise((r) => setTimeout(r, 30));
    slot.dispatchEvent(ev('drop'));
  }, file);
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true');
  await expect(page.locator('.app')).toHaveAttribute('data-file-drag', 'false');
});

test('拖文件进窗口时不盖全窗遮罩，由坑位自己标成可放置；拖到窗口外或系统取消后也要自行恢复', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-slot="0"]').waitFor();
  const file = await makePng(page, 0);
  await page.evaluate((file) => {
    const dt = new DataTransfer();
    dt.items.add(file);
    document.querySelector('.pane--params')!.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, file);
  await expect(page.locator('.drop-overlay')).toHaveCount(0);
  await expect(page.locator('.app')).toHaveAttribute('data-file-drag', 'true');
  // 可放置态落在坑位上：描边变虚线
  await expect(page.locator('[data-slot="0"]')).toHaveCSS('border-top-style', 'dashed');
  // 之后再无任何拖拽事件（Esc 取消 / 拖出窗口且没有 dragleave）：看门狗到期自动恢复
  await expect(page.locator('.app')).toHaveAttribute('data-file-drag', 'false', { timeout: 3000 });
  await expect(page.locator('[data-slot="0"]')).toHaveCSS('border-top-style', 'solid');
});

test('预览画布在任何缩放与坑位数下都上下左右居中', async ({ page }) => {
  await page.goto('/');
  await dropImage(page, 0);
  for (const zoom of ['适应窗口', '50%', '100%']) {
    await setZoom(page, zoom);
    for (const o of await centerOffsets(page)) {
      expect(o.dx, `${zoom} dx`).toBeLessThanOrEqual(1);
      expect(o.dy, `${zoom} dy`).toBeLessThanOrEqual(1);
    }
  }
  // 100% 时画布 1000×600 比视口大：可以滚动，且初始滚到正中
  const scroll = await page.locator('.slot__viewport').evaluate((el) => ({ w: el.scrollWidth - el.clientWidth, left: el.scrollLeft }));
  expect(scroll.w).toBeGreaterThan(0);
  expect(Math.abs(scroll.left - scroll.w / 2)).toBeLessThanOrEqual(1);

  await useFourSlots(page);
  await dropImage(page, 1);
  await dropImage(page, 3);
  for (const zoom of ['适应窗口', '100%']) {
    await setZoom(page, zoom);
    const offsets = await centerOffsets(page);
    expect(offsets).toHaveLength(3);
    for (const o of offsets) {
      expect(o.dx, `4 坑位 ${zoom} dx`).toBeLessThanOrEqual(1);
      expect(o.dy, `4 坑位 ${zoom} dy`).toBeLessThanOrEqual(1);
    }
  }
});

test('4 坑位：顶部只有一个播放 / 暂停按钮控制全部动图，不显示进度条', async ({ page }) => {
  await page.goto('/');
  await dropImage(page, 0);
  await useFourSlots(page);
  await expect(page.getByTestId('transport-group')).toHaveCount(0);

  await dropGif(page, 1);
  await dropGif(page, 2);
  await expect(page.getByTestId('transport-group')).toBeVisible();
  await expect(page.locator('.transport__range')).toHaveCount(0);

  const hashes = () => page.evaluate(() => Array.from(document.querySelectorAll('[data-slot="1"] canvas, [data-slot="2"] canvas')).map((c) => (c as HTMLCanvasElement).toDataURL().length));

  await page.getByRole('button', { name: '全部暂停' }).click();
  await expect(page.getByRole('button', { name: '全部播放' })).toBeVisible();
  await page.waitForTimeout(400);
  const paused = await hashes();
  await page.waitForTimeout(500);
  expect(await hashes()).toEqual(paused);

  await page.getByRole('button', { name: '全部播放' }).click();
  await expect(page.getByRole('button', { name: '全部暂停' })).toBeVisible();
  await expect.poll(hashes, { timeout: 3000 }).not.toEqual(paused);

  // 切回 1 坑位：进度条按坑位恢复，顶部不再有总控播放键
  await page.getByTestId('settings-button').click();
  await pick(page, 'settings.slotCount', '1 个媒体');
  await page.keyboard.press('Escape');
  await expect(page.locator('.slot')).toHaveCount(1);
  await expect(page.getByTestId('transport-group')).toHaveCount(0);
});

/** 画布后备存储的尺寸 */
const backingSize = (page: Page) => page.locator('.slot__canvas').evaluate((el) => [(el as HTMLCanvasElement).width, (el as HTMLCanvasElement).height]);

/** 画布上「既不接近黑也不接近白」的像素占比：缩小时混出来的中间色 */
const blendedRatio = (page: Page) =>
  page.locator('.slot__canvas').evaluate((el) => {
    const canvas = el as HTMLCanvasElement;
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let mixed = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 16 && data[i] < 239) mixed++;
    return mixed / (data.length / 4);
  });

test('缩到 100% 以下的预览照浏览器显示大图的方式缩到屏幕物理像素，与导出图在浏览器 / 设计软件里缩到同样大小一致', async ({ page }) => {
  await page.goto('/');
  await dropImage(page, 0);
  const canvas = page.locator('.slot__canvas');

  // 10%：1000×600 的画布在 DPR 1 的屏幕上只有 100×60 个像素，后备存储就开这么大，不再让 CSS 抽样
  await setZoom(page, '10%');
  await expect(canvas).toHaveAttribute('data-resample', 'area');
  await expect.poll(() => backingSize(page)).toEqual([100, 60]);
  await expect(canvas).toHaveCSS('image-rendering', 'auto');
  const box = (await canvas.boundingBox())!;
  expect(Math.round(box.width)).toBe(100);
  expect(Math.round(box.height)).toBe(60);
  // 默认 Bayer 2×2 单色只有黑白两色；渐变图缩到 10% 后每个屏幕像素盖住 10×10 个画布像素，颗粒融成灰——
  // 这就是导出图缩小后「糊到一起」的真实样子，最近邻抽样出来的是黑白分明的假图
  await expect.poll(() => blendedRatio(page)).toBeGreaterThan(0.3);

  // 100%：屏幕像素不少于画布像素，后备存储回到画布尺寸，帧原样贴上、只有两种颜色
  await setZoom(page, '100%');
  await expect(canvas).toHaveAttribute('data-resample', 'nearest');
  await expect.poll(() => backingSize(page)).toEqual([1000, 600]);
  await expect(canvas).toHaveCSS('image-rendering', 'pixelated');
  await expect.poll(() => blendedRatio(page)).toBe(0);

  // 适应窗口：1920 宽的视口放不下 1000px 的画布，也是缩到屏幕像素
  await setZoom(page, '适应窗口');
  await expect(canvas).toHaveAttribute('data-resample', 'area');
  const fitBox = (await canvas.boundingBox())!;
  await expect.poll(() => backingSize(page)).toEqual([Math.round(fitBox.width), Math.round(fitBox.height)]);
  await expect(page.locator('.tda-toast--error')).toHaveCount(0);
});
