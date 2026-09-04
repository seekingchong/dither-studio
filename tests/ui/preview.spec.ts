import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

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

async function setZoom(page: Page, label: string) {
  await page.locator('.preview-zoom').click();
  await page.getByRole('option', { name: label, exact: true }).click();
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
  await expect(page.locator('.drop-overlay')).toHaveCount(0);
  await expect(page.locator('.app')).not.toHaveClass(/is-dragging/);
});

test('拖到窗口外或系统取消拖拽后，遮罩也要自行消失', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-slot="0"]').waitFor();
  const file = await makePng(page, 0);
  await page.evaluate((file) => {
    const dt = new DataTransfer();
    dt.items.add(file);
    document.querySelector('.pane--params')!.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, file);
  await expect(page.locator('.drop-overlay')).toHaveCount(1);
  // 之后再无任何拖拽事件（Esc 取消 / 拖出窗口且没有 dragleave）：看门狗到期自动熄灭
  await expect(page.locator('.drop-overlay')).toHaveCount(0, { timeout: 3000 });
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

test('4 坑位：顶部只有一个播放 / 暂停按钮控制全部动图，不显示进度条与分辨率信息', async ({ page }) => {
  await page.goto('/');
  await dropImage(page, 0);
  await expect(page.getByTestId('preview-meta')).toBeVisible();
  await useFourSlots(page);
  await expect(page.getByTestId('preview-meta')).toHaveCount(0);
  await expect(page.getByTestId('transport-group')).toHaveCount(0);

  await dropGif(page, 1);
  await dropGif(page, 2);
  await expect(page.getByTestId('transport-group')).toBeVisible();
  await expect(page.locator('.transport__range')).toHaveCount(0);
  await expect(page.locator('.transport__time')).toHaveCount(0);
  await expect(page.getByTestId('preview-meta')).toHaveCount(0);

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

  // 切回 1 坑位：恢复进度条与分辨率信息
  await page.getByTestId('settings-button').click();
  await pick(page, 'settings.slotCount', '1 个媒体');
  await page.keyboard.press('Escape');
  await expect(page.locator('.slot')).toHaveCount(1);
  await expect(page.getByTestId('preview-meta')).toBeVisible();
  await expect(page.getByTestId('transport-group')).toHaveCount(0);
});
