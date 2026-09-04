import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { openSection } from './helpers';

const GIF_B64 = readFileSync(fileURLToPath(new URL('./fixtures/anim.gif', import.meta.url))).toString('base64');

async function dropBytes(page: Page, b64: string, name: string, mime: string) {
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

/** 在页面里用 MediaRecorder 录一段 WebM（画面随时间变化），默认 1.2 秒 */
async function recordWebm(page: Page, seconds = 1.2): Promise<string> {
  return page.evaluate(async (seconds) => {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 200;
    const ctx = c.getContext('2d')!;
    const stream = c.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 2_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise<void>((r) => (rec.onstop = () => r()));
    rec.start(100);
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const draw = () => {
        const t = (performance.now() - start) / 1000;
        ctx.fillStyle = t < seconds / 2 ? '#000000' : '#ffffff';
        ctx.fillRect(0, 0, 320, 200);
        ctx.fillStyle = '#808080';
        ctx.fillRect((t * 200) % 320, 60, 60, 80);
        if (t < seconds) requestAnimationFrame(draw);
        else resolve();
      };
      draw();
    });
    rec.stop();
    await done;
    const blob = new Blob(chunks, { type: 'video/webm' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, seconds);
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

async function canvasPixels(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const canvas = document.querySelector('.slot__canvas') as HTMLCanvasElement;
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    const out: number[] = [];
    for (let i = 0; i < data.length; i += 4) out.push(data[i]);
    return out;
  });
}

async function pick(page: Page, paramId: string, optionLabel: string) {
  await page.locator(`[data-param="${paramId}"]`).click();
  await page.getByRole('option', { name: optionLabel, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
});

test('GIF 动图：逐帧预览、暂停、进度条', async ({ page }) => {
  await page.goto('/');
  await dropBytes(page, GIF_B64, 'anim.gif', 'image/gif');
  await expect(page.getByTestId('transport')).toBeVisible();
  // 进度条右侧不再显示时间文字，时长体现在滑杆的 max 上（这张 GIF 共 0.6 秒）
  await expect(page.locator('.transport__range')).toHaveAttribute('max', /^0\.6/);
  const first = await canvasHash(page);
  await expect.poll(() => canvasHash(page), { timeout: 3000 }).not.toBe(first);
  await page.getByRole('button', { name: '暂停' }).click();
  await expect(page.getByRole('button', { name: '播放' })).toBeVisible();
  await page.waitForTimeout(500);
  const paused = await canvasHash(page);
  await page.waitForTimeout(500);
  expect(await canvasHash(page)).toBe(paused);
  await expect(page.getByRole('button', { name: '导出视频' })).toBeEnabled();
});

test('视频：播放预览与导出 WebM', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const webm = await recordWebm(page);
  await dropBytes(page, webm, 'clip.webm', 'video/webm');
  await expect(page.getByTestId('transport')).toBeVisible();
  const first = await canvasHash(page);
  await expect.poll(() => canvasHash(page), { timeout: 5000 }).not.toBe(first);

  await page.getByRole('button', { name: '导出视频' }).click();
  await expect(page.getByTestId('export-video-dialog')).toBeVisible();
  await pick(page, 'export.quality', '中');
  await page.getByRole('button', { name: '开始导出' }).click();
  await expect(page.getByTestId('export-video-status')).toContainText(/VP9|VP8|H\.264/, { timeout: 90_000 });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^clip-dither\.(webm|mp4)$/);
  const file = readFileSync((await download.path())!);
  expect(file.length).toBeGreaterThan(5000);
  // WebM 以 EBML 头开始，MP4 前 8 字节含 ftyp
  const head = file.subarray(0, 8);
  expect(head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3 ? 'webm' : head.toString('latin1').includes('ftyp') ? 'mp4' : 'unknown').not.toBe('unknown');
});

async function setSlider(page: Page, id: string, value: number) {
  const input = page.locator(`[data-param="${id}"] .tda-slider__input`);
  await input.fill(String(value));
  await input.press('Enter');
}

/** 切 GPU 开关不会让流水线缓存失效：把阈值改一下再改回来，逼它按当前开关把同一套参数重算一遍 */
async function recompute(page: Page) {
  const before = await canvasHash(page);
  // 阈值在「影调」分节里，默认收起
  await openSection(page, 'tone');
  await setSlider(page, 'tone.threshold', 129);
  await expect.poll(() => canvasHash(page)).not.toBe(before);
  const nudged = await canvasHash(page);
  await setSlider(page, 'tone.threshold', 128);
  await expect.poll(() => canvasHash(page)).not.toBe(nudged);
}

test('视频裁剪：「原图」页上一条固定 3 秒的窗口，左右拖挑哪三秒，导出只出这一段', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const webm = await recordWebm(page, 4.5);
  await dropBytes(page, webm, 'clip.webm', 'video/webm');
  await expect(page.getByTestId('transport')).toBeVisible();

  // 「结果」页没有裁剪条，切到「原图」才出现
  await expect(page.getByTestId('trim-0')).toHaveCount(0);
  await page.getByRole('tab', { name: '原图' }).click();
  const trim = page.getByTestId('trim-0');
  await expect(trim).toBeVisible();
  await expect(trim).toContainText('裁剪 3.0 秒');
  await expect(trim).toHaveAttribute('data-trim-start', '0.00');
  const track = trim.locator('.trim__track');
  const duration = Number(await trim.getAttribute('data-duration'));
  expect(duration).toBeGreaterThan(3);

  // 窗口宽度就是 3 秒占整段的比例
  const trackBox = (await track.boundingBox())!;
  const windowBox = (await trim.locator('.trim__window').boundingBox())!;
  expect(windowBox.width / trackBox.width).toBeCloseTo(3 / duration, 1);

  // 拖到最右：起点贴到 时长 - 3，再往右也不动
  await page.mouse.move(trackBox.x + trackBox.width - 2, trackBox.y + trackBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(trackBox.x + trackBox.width + 200, trackBox.y + trackBox.height / 2);
  await page.mouse.up();
  const maxStart = Number(await trim.getAttribute('data-trim-start'));
  expect(maxStart).toBeCloseTo(duration - 3, 1);
  await expect(trim.getByTestId('trim-range-0')).toContainText('–');

  // 方向键微调；Home 回到开头
  await track.focus();
  await track.press('ArrowLeft');
  expect(Number(await trim.getAttribute('data-trim-start'))).toBeCloseTo(maxStart - 0.1, 2);
  await track.press('Home');
  await expect(trim).toHaveAttribute('data-trim-start', '0.00');

  // 进度条就是裁出来的这一段：min / max 跟着窗口走，拖不到被裁掉的部分
  await track.press('End');
  await expect.poll(async () => Number(await page.locator('.transport__range').getAttribute('min'))).toBeCloseTo(duration - 3, 1);
  expect(Number(await page.locator('.transport__range').getAttribute('max'))).toBeCloseTo(duration, 1);
  await track.press('Home');
  await expect.poll(async () => Number(await page.locator('.transport__range').getAttribute('max'))).toBeCloseTo(3, 1);
  await track.press('End');

  // 导出只出这 3 秒：60 fps × 3 秒 = 180 帧
  await page.getByRole('button', { name: '导出视频' }).click();
  await page.getByRole('button', { name: '开始导出' }).click();
  await expect(page.getByTestId('export-video-dialog')).toContainText('/ 180 帧', { timeout: 30_000 });
  await page.getByRole('button', { name: '取消' }).click();
  await page.getByRole('button', { name: '关闭' }).click();
});

test('视频：暂停后拖动进度条，画面跟着走', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const webm = await recordWebm(page);
  await dropBytes(page, webm, 'clip.webm', 'video/webm');
  await expect(page.getByTestId('transport')).toBeVisible();
  await page.getByRole('button', { name: '暂停' }).click();
  await expect(page.getByRole('button', { name: '播放' })).toBeVisible();
  const range = page.locator('.transport__range');
  // 录的片子 0.6 秒处由黑转白：按画面明暗断言，不受一帧早晚的影响
  const luma = async () => {
    const px = await canvasPixels(page);
    return px.reduce((s, v) => s + v, 0) / px.length;
  };
  await range.fill('0.1');
  await expect.poll(luma, { timeout: 5000 }).toBeLessThan(96);
  await range.fill('0.9');
  await expect.poll(luma, { timeout: 5000 }).toBeGreaterThan(160);
});

test('GPU 路径与 CPU 结果一致（有序抖动与网点渲染）', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-slot="0"]').waitFor();
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 250;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 400, 250);
    g.addColorStop(0, '#000000');
    g.addColorStop(1, '#ffffff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 400, 250);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'g.png', { type: 'image/png' }));
    document.querySelector('[data-slot="0"]')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true');
  // 默认就是有序 Bayer 2×2（抖动阶段走 GPU）；换成欧几里得网点让渲染阶段也走 GPU
  await expect(page.locator('[data-param="dither.ordered.matrix"]')).toContainText('Bayer 2×2');
  await openSection(page, 'grid');
  const squares = await canvasHash(page);
  await pick(page, 'grid.dot', '欧几里得网点');
  await expect.poll(() => canvasHash(page)).not.toBe(squares);
  await recompute(page);
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-gpu', 'true');
  const gpuPixels = await canvasPixels(page);

  await page.getByTestId('settings-button').click();
  await page.locator('[data-param="settings.gpu"]').click();
  await page.keyboard.press('Escape');
  await recompute(page);
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-gpu', 'false');
  const cpuPixels = await canvasPixels(page);

  let diff = 0;
  for (let i = 0; i < gpuPixels.length; i++) if (gpuPixels[i] !== cpuPixels[i]) diff++;
  expect(diff / gpuPixels.length).toBeLessThan(0.005);
  await expect(page.locator('.tda-toast--error')).toHaveCount(0);
});
