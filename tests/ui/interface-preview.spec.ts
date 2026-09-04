import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

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

/** 封面画布的像素统计：非透明像素数与总亮度（用来判断有没有画、画面动没动） */
async function coverSample(popup: Page) {
  return popup.evaluate(() => {
    const c = document.querySelector('canvas.tdc-cover__canvas') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    let opaque = 0;
    for (let i = 0; i < d.length; i += 4) {
      sum += d[i] + d[i + 1] + d[i + 2];
      if (d[i + 3] > 0) opaque++;
    }
    return { sum, opaque };
  });
}

test('双击坑位打开界面预览窗口，整张界面按设计稿尺寸复刻', async ({ page }) => {
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
  await expect(popup.locator('canvas.tdc-cover__canvas')).toHaveCount(1);

  // 素材确实画进了 video cover 容器
  await expect.poll(async () => (await coverSample(popup)).opaque, { timeout: 10_000 }).toBeGreaterThan(0);
});

test('界面预览里的 video cover 跟着主窗口循环播放动图', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await dropInto(page, GIF_B64, 'anim.gif', 'image/gif');
  const popup = await openPreview(page);
  await expect.poll(async () => (await coverSample(popup)).opaque, { timeout: 10_000 }).toBeGreaterThan(0);

  // 这张 GIF 只有 0.6 秒，采样跨度远超一个循环：一直在变说明它在循环播，没有停在最后一帧
  const sums = new Set<number>();
  for (let i = 0; i < 6; i++) {
    sums.add((await coverSample(popup)).sum);
    await popup.waitForTimeout(400);
  }
  expect(sums.size).toBeGreaterThan(2);

  // 主窗口暂停后，预览窗口也跟着停住
  await page.getByRole('button', { name: '暂停' }).click();
  await popup.waitForTimeout(500);
  const paused = (await coverSample(popup)).sum;
  await popup.waitForTimeout(700);
  expect((await coverSample(popup)).sum).toBe(paused);
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
