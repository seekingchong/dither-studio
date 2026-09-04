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

/** 在页面里用 MediaRecorder 录一段 1.2 秒的 WebM（画面随时间变化） */
async function recordWebm(page: Page): Promise<string> {
  return page.evaluate(async () => {
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
        ctx.fillStyle = t < 0.6 ? '#000000' : '#ffffff';
        ctx.fillRect(0, 0, 320, 200);
        ctx.fillStyle = '#808080';
        ctx.fillRect((t * 200) % 320, 60, 60, 80);
        if (t < 1.2) requestAnimationFrame(draw);
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
  });
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
  await expect(page.getByTestId('transport')).toContainText('0:00.6');
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
  await pick(page, 'dither.family', '有序');
  await openSection(page, 'grid');
  await pick(page, 'grid.dot', '欧几里得网点');
  await expect.poll(() => page.getByTestId('preview-meta').textContent()).toContain('GPU');
  const gpuPixels = await canvasPixels(page);

  await page.getByTestId('settings-button').click();
  await page.locator('[data-param="settings.gpu"]').click();
  await expect.poll(() => page.getByTestId('preview-meta').textContent()).not.toContain('GPU');
  const cpuPixels = await canvasPixels(page);

  let diff = 0;
  for (let i = 0; i < gpuPixels.length; i++) if (gpuPixels[i] !== cpuPixels[i]) diff++;
  expect(diff / gpuPixels.length).toBeLessThan(0.005);
  await expect(page.locator('.tda-toast--error')).toHaveCount(0);
});
