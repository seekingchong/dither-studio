import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { openSection, setZoom } from './helpers';

const GIF_B64 = readFileSync(fileURLToPath(new URL('./fixtures/anim.gif', import.meta.url))).toString('base64');

/** 设计稿（Figma tdc home 45:3223）上的关键坐标，界面按 1728×1080 画好再整体缩放 */
const DESIGN = {
  frame: { width: 1728, height: 1080 },
  rail: [0, 0, 120, 1080],
  sidebar: [120, 0, 234, 1080],
  card: [330, 138, 360, 512.375],
  cover: [339, 147, 342, 192.375],
  videoCover: [421.93, 225.375, 98.958, 59.375],
  main: [354, 0, 1374, 1080],
  input: [641, 517, 800, 44],
};

async function dropInto(page: Page, b64: string, name: string, mime: string) {
  await page.locator('[data-slot="0"]').waitFor();
  await page.evaluate(
    ({ b64, name, mime }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], name, { type: mime }));
      document.querySelector('[data-slot="0"]')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    },
    { b64, name, mime },
  );
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true');
}

/** 在页面里合成一张图丢进坑位 0 */
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
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'sample.png', { type: 'image/png' }));
    document.querySelector('[data-slot="0"]')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true');
}

/** 双击坑位，接住弹出来的界面预览窗口 */
async function openPreview(page: Page, context = page.context()) {
  const popupPromise = context.waitForEvent('page');
  await page.locator('[data-slot="0"]').dblclick({ position: { x: 40, y: 40 } });
  const popup = await popupPromise;
  await popup.setViewportSize(DESIGN.frame);
  await popup.waitForSelector('.tdc-frame');
  return popup;
}

/** 元素在设计稿坐标系里的位置与大小（把整体缩放折算回去） */
async function designBox(popup: Page, selector: string): Promise<number[]> {
  return popup.evaluate((sel) => {
    const frameEl = document.querySelector('.tdc-frame')!;
    const frame = frameEl.getBoundingClientRect();
    const scale = Number(getComputedStyle(frameEl).transform.split('(')[1]?.split(',')[0]) || 1;
    const r = document.querySelector(sel)!.getBoundingClientRect();
    return [(r.left - frame.left) / scale, (r.top - frame.top) / scale, r.width / scale, r.height / scale];
  }, selector);
}

/** 像素数据的指纹：尺寸 + FNV-1a，两边各算一份来比对，省得把几 MB 像素搬出页面 */
const PIXEL_HASH = `(data, w, h) => {
  let x = 2166136261;
  for (let i = 0; i < data.length; i++) { x ^= data[i]; x = Math.imul(x, 16777619) >>> 0; }
  return w + 'x' + h + ':' + x;
}`;

/** 主窗口画布上的帧（100% 下后备存储就是原样的帧，也就是「导出图片」会存的那张） */
const mainCanvasHash = (page: Page) =>
  page.evaluate((hashSrc) => {
    const hash = new Function(`return ${hashSrc}`)() as (d: Uint8ClampedArray, w: number, h: number) => string;
    const c = document.querySelector('.slot__canvas') as HTMLCanvasElement;
    return hash(c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
  }, PIXEL_HASH);

/** 预览窗口封面里那张 PNG 解码回来的像素 */
const coverImageHash = (popup: Page) =>
  popup.evaluate(async (hashSrc) => {
    const hash = new Function(`return ${hashSrc}`)() as (d: Uint8ClampedArray, w: number, h: number) => string;
    const img = document.querySelector('img.tdc-cover__image') as HTMLImageElement | null;
    if (!img || !img.naturalWidth) return 'none';
    const blob = await (await fetch(img.src)).blob();
    const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const c = document.createElement('canvas');
    c.width = bitmap.width;
    c.height = bitmap.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return hash(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
  }, PIXEL_HASH);

/** 封面里成品文件的头几个字节与大小 */
const coverFileHead = (popup: Page, selector: string) =>
  popup.evaluate(async (sel) => {
    const el = document.querySelector(sel) as HTMLImageElement | HTMLVideoElement;
    const bytes = new Uint8Array(await (await fetch(el.src)).arrayBuffer());
    return { size: bytes.length, head: Array.from(bytes.subarray(0, 12)) };
  }, selector);

test('双击坑位打开界面预览窗口，整张界面按设计稿尺寸复刻，封面里是导出的 PNG', async ({ page }) => {
  await page.goto('/');
  await dropSyntheticImage(page);
  const popup = await openPreview(page);

  expect(popup.url()).toContain('#interface-preview?slot=0');
  await expect.poll(() => popup.title()).toContain('sample.png');

  // 逐块对齐设计稿坐标
  for (const [name, expected] of Object.entries({
    '.tdc-rail': DESIGN.rail,
    '.tdc-side': DESIGN.sidebar,
    '.tdc-card__panel': DESIGN.card,
    '.tdc-card__cover': DESIGN.cover,
    '.tdc-cover__video': DESIGN.videoCover,
    '.tdc-main': DESIGN.main,
    '.tdc-input': DESIGN.input,
  })) {
    const actual = await designBox(popup, name);
    for (let i = 0; i < 4; i++) expect(actual[i], `${name} 第 ${i} 项`).toBeCloseTo(expected[i], 1);
  }

  // 界面本身是静态的：没有输入框、没有按钮，只有一张画
  await expect(popup.locator('.tdc input, .tdc button, .tdc a')).toHaveCount(0);

  // 封面里是一张 <img>，来源是导出的 PNG 文件（blob），尺寸是画布全尺寸，不是封面那么大的抓帧
  const img = popup.locator('img.tdc-cover__image');
  await expect(img).toHaveCount(1, { timeout: 15_000 });
  await expect(img).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1000);
  await expect(popup.locator('.tdc-cover__media')).toHaveAttribute('data-format', 'PNG');
  const png = await coverFileHead(popup, 'img.tdc-cover__image');
  expect(png.head.slice(0, 8)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // 逐像素等于主窗口 100% 下画布上的帧——也就是「导出图片」会存的那张
  await setZoom(page, '100%');
  const expected = await mainCanvasHash(page);
  await expect.poll(() => coverImageHash(popup), { timeout: 15_000 }).toBe(expected);

  // 主窗口改参数（反相）：预览窗口自动换成新导出的 PNG，仍然逐像素一致
  const before = await img.getAttribute('src');
  await openSection(page, 'tone');
  await page.locator('[data-param="tone.invert"]').click();
  await expect.poll(() => mainCanvasHash(page)).not.toBe(expected);
  await expect.poll(() => img.getAttribute('src'), { timeout: 15_000 }).not.toBe(before);
  const inverted = await mainCanvasHash(page);
  await expect.poll(() => coverImageHash(popup), { timeout: 15_000 }).toBe(inverted);
  await expect(popup.getByTestId('preview-status')).toHaveCount(0);
});

test('界面预览里的 video cover 是导出的 MP4 / WebM，自己循环播放', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await dropInto(page, GIF_B64, 'anim.gif', 'image/gif');
  const popup = await openPreview(page);

  // 成品是 <video>，来源是导出的视频文件（blob）；封装按平台有没有 H.264 编码器决定
  const clip = popup.locator('video.tdc-cover__clip');
  await expect(clip).toHaveCount(1, { timeout: 90_000 });
  await expect(clip).toHaveAttribute('src', /^blob:/);
  const format = await popup.locator('.tdc-cover__media').getAttribute('data-format');
  expect(['MP4', 'WebM']).toContain(format);
  await expect.poll(() => popup.title()).toContain('anim.gif');

  // 文件头跟容器对得上：MP4 前 8 字节含 ftyp，WebM 以 EBML 头开始
  const file = await coverFileHead(popup, 'video.tdc-cover__clip');
  expect(file.size).toBeGreaterThan(1000);
  const isWebm = file.head[0] === 0x1a && file.head[1] === 0x45 && file.head[2] === 0xdf && file.head[3] === 0xa3;
  const isMp4 = String.fromCharCode(...file.head.slice(4, 8)) === 'ftyp';
  expect(format === 'MP4' ? isMp4 : isWebm, `${format} 的文件头`).toBe(true);

  // 视频元数据：画布全尺寸 1000×600，时长就是这张 GIF 的 0.6 秒（60 fps × 36 帧），循环
  await expect.poll(() => clip.evaluate((el) => (el as HTMLVideoElement).readyState), { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  const meta = await clip.evaluate((el) => {
    const v = el as HTMLVideoElement;
    return { width: v.videoWidth, height: v.videoHeight, duration: v.duration, loop: v.loop };
  });
  expect(meta.width).toBe(1000);
  expect(meta.height).toBe(600);
  expect(meta.duration).toBeCloseTo(0.6, 1);
  expect(meta.loop).toBe(true);

  // 自己在循环播：采样跨度远超一个循环，时间一直在变，没有停在末尾
  await expect.poll(() => clip.evaluate((el) => (el as HTMLVideoElement).paused), { timeout: 10_000 }).toBe(false);
  const times = new Set<number>();
  for (let i = 0; i < 6; i++) {
    times.add(await clip.evaluate((el) => (el as HTMLVideoElement).currentTime));
    await popup.waitForTimeout(250);
  }
  expect(times.size).toBeGreaterThan(2);

  // 导完之后状态条收起
  await expect(popup.getByTestId('preview-status')).toHaveCount(0);
});

test('界面整体等比缩放：任何窗口大小下都完整可见、居中、不出滚动条', async ({ page }) => {
  await page.goto('/');
  await dropSyntheticImage(page);
  const popup = await openPreview(page);

  for (const size of [
    { width: 960, height: 600 },
    { width: 1280, height: 800 },
    { width: 760, height: 900 },
    { width: 1728, height: 1080 },
  ]) {
    await popup.setViewportSize(size);
    await popup.waitForTimeout(120);
    const r = await popup.evaluate(() => {
      const el = document.querySelector('.tdc-frame')!;
      const b = el.getBoundingClientRect();
      return {
        left: b.left, top: b.top, width: b.width, height: b.height,
        scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight,
      };
    });
    const label = `${size.width}x${size.height}`;
    // 完整可见：缩放后的画板落在窗口里，不被裁掉
    expect(r.left, label).toBeGreaterThanOrEqual(-1);
    expect(r.top, label).toBeGreaterThanOrEqual(-1);
    expect(r.left + r.width, label).toBeLessThanOrEqual(size.width + 1);
    expect(r.top + r.height, label).toBeLessThanOrEqual(size.height + 1);
    // 等比：宽高比就是设计稿的 1728:1080
    expect(r.width / r.height, label).toBeCloseTo(1728 / 1080, 2);
    // 居中，且没撑出滚动条
    expect(r.left, label).toBeCloseTo((size.width - r.width) / 2, 0);
    expect(r.top, label).toBeCloseTo((size.height - r.height) / 2, 0);
    expect(r.scrollW, label).toBeLessThanOrEqual(size.width + 1);
    expect(r.scrollH, label).toBeLessThanOrEqual(size.height + 1);
  }
});

test('双击只认画面那块：素材编辑条与裁剪条上双击不弹预览窗', async ({ page, context }) => {
  await page.goto('/');
  await dropInto(page, GIF_B64, 'anim.gif', 'image/gif');
  // 编辑条只在「原图」页出现
  await page.getByRole('tab', { name: '原图' }).click();
  const editBar = page.locator('[data-slot="0"] .slot__editor');
  await expect(editBar).toBeVisible();

  const before = context.pages().length;
  await editBar.dblclick({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(600);
  expect(context.pages().length, '编辑条上双击不该开窗').toBe(before);

  // 画面上双击照样开
  const popup = await openPreview(page, context);
  expect(popup.url()).toContain('#interface-preview');
});

test('再次双击同一个坑位复用同一扇预览窗口，不会越开越多', async ({ page, context }) => {
  await page.goto('/');
  await dropSyntheticImage(page);
  const popup = await openPreview(page, context);
  const before = context.pages().length;
  await page.locator('[data-slot="0"]').dblclick({ position: { x: 40, y: 40 } });
  await page.waitForTimeout(500);
  expect(context.pages().length).toBe(before);
  expect(popup.isClosed()).toBe(false);
});
