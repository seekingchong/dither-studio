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

test('GIF 动图：逐帧预览、一直循环、暂停；播放键旁没有进度条', async ({ page }) => {
  await page.goto('/');
  await dropBytes(page, GIF_B64, 'anim.gif', 'image/gif');
  await expect(page.getByTestId('transport')).toBeVisible();
  // 只有播放 / 暂停键，没有进度条
  await expect(page.locator('.transport__range')).toHaveCount(0);
  await expect(page.getByTestId('transport').locator('input')).toHaveCount(0);
  const first = await canvasHash(page);
  await expect.poll(() => canvasHash(page), { timeout: 3000 }).not.toBe(first);
  // 这张 GIF 共 0.6 秒：过了好几圈还在动，说明默认一直循环
  await page.waitForTimeout(1500);
  const later = await canvasHash(page);
  await expect.poll(() => canvasHash(page), { timeout: 3000 }).not.toBe(later);
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
  // 默认就是画布尺寸 + 60 fps
  await expect(page.getByTestId('export-video-size')).toContainText('输出 1000 × 600 · 60 fps');
  await pick(page, 'export.quality', '中');
  // 帧率与倍率都能选：30 fps + 0.5× 就是 500 × 300
  await pick(page, 'export.fps', '30 fps');
  await pick(page, 'export.scale', '0.5×');
  await expect(page.getByTestId('export-video-size')).toContainText('输出 500 × 300 · 30 fps');
  // 自定义分辨率始终等比：接着当前尺寸改，只写宽度，高度自己跟上
  await pick(page, 'export.resolution', '自定义');
  await expect(page.locator('[data-param="export.width"] input')).toHaveValue('500');
  await page.locator('[data-param="export.width"] input').fill('800');
  await page.locator('[data-param="export.width"] input').press('Enter');
  await expect(page.locator('[data-param="export.height"] input')).toHaveValue('480');
  await expect(page.getByTestId('export-video-size')).toContainText('输出 800 × 480 · 30 fps');
  await page.getByRole('button', { name: '开始导出' }).click();
  await expect(page.getByTestId('export-video-status')).toContainText(/VP9|VP8|H\.264/, { timeout: 90_000 });
  // 出来的就是选的那个尺寸
  await expect(page.getByTestId('export-video-status')).toContainText('800 × 480');
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

test('视频裁剪：拖两端定裁剪范围、拖中间整体挪，导出只出这一段', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const webm = await recordWebm(page, 6);
  await dropBytes(page, webm, 'clip.webm', 'video/webm');
  await expect(page.getByTestId('transport')).toBeVisible();

  // 两个页签都有裁剪条（「结果」页那条另有一条用例），这条在「原图」页上验
  await expect(page.getByTestId('trim-0')).toBeVisible();
  await page.getByRole('tab', { name: '原图' }).click();
  const trim = page.getByTestId('trim-0');
  await expect(trim).toBeVisible();
  // 刚载入：默认取开头 4 秒
  await expect(trim).toContainText('裁剪 4.0 秒');
  await expect(trim).toHaveAttribute('data-trim-start', '0.00');
  await expect(trim).toHaveAttribute('data-trim-length', '4.00');
  const track = trim.locator('.trim__track');
  const windowBar = trim.locator('.trim__window');
  const startHandle = trim.getByTestId('trim-start-0');
  const endHandle = trim.getByTestId('trim-end-0');
  const duration = Number(await trim.getAttribute('data-duration'));
  expect(duration).toBeGreaterThan(4);

  const trackBox = (await track.boundingBox())!;
  const midY = trackBox.y + trackBox.height / 2;
  const xAt = (seconds: number) => trackBox.x + (seconds / duration) * trackBox.width;
  /** 抓住某个把手（或窗口本身）拖到时间轴上的某一秒 */
  const dragTo = async (from: ReturnType<typeof trim.locator>, seconds: number) => {
    const box = (await from.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(xAt(seconds), midY, { steps: 8 });
    await page.mouse.up();
  };
  const startAt = async () => Number(await trim.getAttribute('data-trim-start'));
  const lengthAt = async () => Number(await trim.getAttribute('data-trim-length'));
  const endAt = async () => Number(await trim.getAttribute('data-trim-end'));

  // 窗口宽度就是窗长占整段的比例
  expect((await windowBar.boundingBox())!.width / trackBox.width).toBeCloseTo(4 / duration, 1);

  // 拖右端往右：窗长变长，起点不动
  await dragTo(endHandle, 5.5);
  expect(await startAt()).toBeCloseTo(0, 1);
  expect(await lengthAt()).toBeCloseTo(5.5, 1);
  await expect(trim).toContainText('裁剪 5.5 秒');
  expect((await windowBar.boundingBox())!.width / trackBox.width).toBeCloseTo(5.5 / duration, 1);

  // 拖左端往右：起点跟着走，终点不动，窗长自己算出来
  await dragTo(startHandle, 2);
  expect(await startAt()).toBeCloseTo(2, 1);
  expect(await endAt()).toBeCloseTo(5.5, 1);
  expect(await lengthAt()).toBeCloseTo(3.5, 1);

  // 两端都拖不出整段之外
  await dragTo(startHandle, -3);
  expect(await startAt()).toBeCloseTo(0, 1);
  await dragTo(endHandle, duration + 3);
  expect(await endAt()).toBeCloseTo(duration, 1);

  // 左端拖过右端也不会把窗口拖成负的，最短停在 0.1 秒
  await dragTo(startHandle, duration + 3);
  expect(await lengthAt()).toBeCloseTo(0.1, 1);
  expect(await endAt()).toBeCloseTo(duration, 1);

  // 拖中间：整体挪，窗长不变（抓的是窗口正中，所以窗口居中落在指针那一秒）
  const center = async () => ((await startAt()) + (await endAt())) / 2;
  await dragTo(windowBar, 2);
  expect(await lengthAt()).toBeCloseTo(0.1, 1);
  expect(await center()).toBeCloseTo(2, 1);

  // 按在窗口外面：窗口整个居中挪过去，窗长照旧
  await page.mouse.click(xAt(4.5), midY);
  expect(await lengthAt()).toBeCloseTo(0.1, 1);
  expect(await center()).toBeCloseTo(4.5, 1);

  // 方向键微调各自那一端；Home / End 顶到极限
  await endHandle.focus();
  await endHandle.press('End');
  expect(await endAt()).toBeCloseTo(duration, 1);
  const tail = await endAt();
  await endHandle.press('ArrowLeft');
  // data-* 只到两位小数，0.1 这一步用 1 位精度断言（没挪就是差 0.1，照样挂）
  expect(await endAt()).toBeCloseTo(tail - 0.1, 1);
  await startHandle.focus();
  await startHandle.press('Home');
  await expect(trim).toHaveAttribute('data-trim-start', '0.00');
  expect(await lengthAt()).toBeCloseTo(duration - 0.1, 1);
  await startHandle.press('ArrowRight');
  expect(await startAt()).toBeCloseTo(0.1, 2);

  // 窗口本身的方向键管整段的位置：Home 回开头、End 顶到尾，窗长都不变
  const long = await lengthAt();
  await windowBar.focus();
  await windowBar.press('End');
  expect(await endAt()).toBeCloseTo(duration, 1);
  expect(await lengthAt()).toBeCloseTo(long, 2);
  await windowBar.press('Home');
  await expect(trim).toHaveAttribute('data-trim-start', '0.00');

  // 暂停后拖两端，画面当场跟到被拖的那一端（录的 6 秒片子 3 秒处由黑转白）
  await page.getByRole('button', { name: '暂停' }).click();
  await expect(page.getByRole('button', { name: '播放' })).toBeVisible();
  const luma = async () => {
    const px = await canvasPixels(page);
    return px.reduce((sum, v) => sum + v, 0) / px.length;
  };
  await startHandle.press('Home');
  await endHandle.press('End');
  await dragTo(startHandle, 4.5);
  await expect.poll(luma, { timeout: 5000 }).toBeGreaterThan(160);
  await dragTo(startHandle, 0);
  await expect.poll(luma, { timeout: 5000 }).toBeLessThan(96);
  await dragTo(endHandle, 4.5);
  await expect.poll(luma, { timeout: 5000 }).toBeGreaterThan(160);

  // 播放键旁没有进度条；定位靠裁剪条的两端
  await expect(page.locator('.transport__range')).toHaveCount(0);

  // 导出按窗长出帧：60 fps × 窗长。裁成 2 秒就是 120 帧，不再是固定的 240
  await dragTo(startHandle, 0);
  await dragTo(endHandle, 2);
  const length = await lengthAt();
  expect(length).toBeCloseTo(2, 1);
  const dialog = page.getByTestId('export-video-dialog');
  await page.getByRole('button', { name: '导出视频' }).click();
  await page.getByRole('button', { name: '开始导出' }).click();
  // 总帧数就是 60 fps × 这个窗长（data-* 只到两位小数，允许一两帧的出入），不再是固定的 240
  const framesInDialog = async () => Number(/\/ (\d+) 帧/.exec((await dialog.textContent()) ?? '')?.[1] ?? 0);
  let total = 0;
  await expect.poll(async () => (total = await framesInDialog()), { timeout: 30_000 }).toBeGreaterThan(0);
  expect(Math.abs(total - length * 60)).toBeLessThanOrEqual(2);
  await page.getByRole('button', { name: '取消' }).click();
  await page.getByRole('button', { name: '关闭' }).click();
});

test('裁剪条在「结果」页也在：拖两端直接改成品，两个页签同一个窗口', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const webm = await recordWebm(page, 6);
  await dropBytes(page, webm, 'clip.webm', 'video/webm');
  await expect(page.getByTestId('transport')).toBeVisible();

  // 落地就是「结果」页：裁剪条在这儿也给，不用先切到「原图」
  await expect(page.locator('.slot__canvas')).toHaveAttribute('data-tab', 'result');
  const trim = page.getByTestId('trim-0');
  await expect(trim).toBeVisible();
  await expect(trim).toContainText('裁剪 4.0 秒');

  const track = trim.locator('.trim__track');
  const startHandle = trim.getByTestId('trim-start-0');
  const endHandle = trim.getByTestId('trim-end-0');
  const trackBox = (await track.boundingBox())!;
  const duration = Number(await trim.getAttribute('data-duration'));
  const dragTo = async (from: ReturnType<typeof trim.locator>, seconds: number) => {
    const box = (await from.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(trackBox.x + (seconds / duration) * trackBox.width, trackBox.y + trackBox.height / 2, { steps: 8 });
    await page.mouse.up();
  };

  // 在「结果」页拖右端：窗长跟着变
  await dragTo(endHandle, 5.5);
  expect(Number(await trim.getAttribute('data-trim-length'))).toBeCloseTo(5.5, 1);

  // 暂停后拖两端，成品预览当场跟到被拖的那一头（录的 6 秒片子 3 秒处由黑转白）
  await page.getByRole('button', { name: '暂停' }).click();
  await expect(page.getByRole('button', { name: '播放' })).toBeVisible();
  const luma = async () => {
    const px = await canvasPixels(page);
    return px.reduce((sum, v) => sum + v, 0) / px.length;
  };
  await dragTo(startHandle, 4.5);
  await expect.poll(luma, { timeout: 5000 }).toBeGreaterThan(160);
  await dragTo(startHandle, 0);
  await expect.poll(luma, { timeout: 5000 }).toBeLessThan(96);

  // 切到「原图」是同一个窗口：值一致，接着在那边拖也写回同一份状态
  const [start, length] = [await trim.getAttribute('data-trim-start'), await trim.getAttribute('data-trim-length')];
  await page.getByRole('tab', { name: '原图' }).click();
  await expect(trim).toHaveAttribute('data-trim-start', start!);
  await expect(trim).toHaveAttribute('data-trim-length', length!);
  await dragTo(endHandle, 2);
  expect(Number(await trim.getAttribute('data-trim-length'))).toBeCloseTo(2, 1);
  await page.getByRole('tab', { name: '结果' }).click();
  await expect(trim).toHaveAttribute('data-trim-length', /^2\.0/);
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
