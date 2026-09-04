import { expect, test, type Page } from '@playwright/test';

/** 四个象限四种颜色的方图，用来看清旋转 / 镜像把哪个角转到了哪里 */
async function dropQuadrantImage(page: Page) {
  await page.locator('[data-slot="0"]').waitFor();
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 200;
    const ctx = c.getContext('2d')!;
    const quads: Array<[string, number, number]> = [
      ['#FF0000', 0, 0], // 左上 红
      ['#00FF00', 100, 0], // 右上 绿
      ['#0000FF', 0, 100], // 左下 蓝
      ['#FFFF00', 100, 100], // 右下 黄
    ];
    for (const [color, x, y] of quads) {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 100, 100);
    }
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'quad.png', { type: 'image/png' }));
    document.querySelector('[data-slot="0"]')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true');
}

/** 「原图」页画布四个角的颜色，顺序：左上、右上、左下、右下 */
async function corners(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const canvas = document.querySelector('.slot__canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const hex = (x: number, y: number) => {
      const d = ctx.getImageData(x, y, 1, 1).data;
      return `#${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
    };
    const w = canvas.width;
    const h = canvas.height;
    return [hex(10, 10), hex(w - 10, 10), hex(10, h - 10), hex(w - 10, h - 10)];
  });
}

async function pick(page: Page, paramId: string, optionLabel: string) {
  await page.locator(`[data-param="${paramId}"]`).click();
  await page.getByRole('option', { name: optionLabel, exact: true }).click();
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

test('素材编辑：旋转、上下左右镜像、等比裁剪缩放，结果与导出都跟着变', async ({ page }) => {
  await page.goto('/');
  await dropQuadrantImage(page);

  // 画布调成 200×200 且适配用 Fill，源图与画布一一对应，四个角能直接读出来
  await page.getByTestId('canvas-menu-button').click();
  const width = page.locator('[data-param="canvas.width"] input');
  const height = page.locator('[data-param="canvas.height"] input');
  await width.fill('200');
  await width.press('Enter');
  await height.fill('200');
  await height.press('Enter');
  await pick(page, 'canvas.fit', 'Fill');
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: '原图' }).click();
  const bar = page.getByTestId('source-edit-0');
  await expect(bar).toBeVisible();
  await expect(corners(page)).resolves.toEqual(['#FF0000', '#00FF00', '#0000FF', '#FFFF00']);

  // 旋转 90°（顺时针）：左下的蓝转到左上，左上的红转到右上
  await page.getByTestId('rotate-0').click();
  await expect(bar).toHaveAttribute('data-rotate', '90');
  await expect(corners(page)).resolves.toEqual(['#0000FF', '#FF0000', '#FFFF00', '#00FF00']);

  // 再转三次回到原样
  for (let i = 0; i < 3; i++) await page.getByTestId('rotate-0').click();
  await expect(bar).toHaveAttribute('data-rotate', '0');
  await expect(corners(page)).resolves.toEqual(['#FF0000', '#00FF00', '#0000FF', '#FFFF00']);

  // 左右镜像：左右两列对调
  await page.getByTestId('flip-x-0').click();
  await expect(corners(page)).resolves.toEqual(['#00FF00', '#FF0000', '#FFFF00', '#0000FF']);
  // 再叠上下镜像：上下两行也对调（等于转 180°）
  await page.getByTestId('flip-y-0').click();
  await expect(corners(page)).resolves.toEqual(['#FFFF00', '#0000FF', '#00FF00', '#FF0000']);
  await page.getByTestId('flip-x-0').click();
  await page.getByTestId('flip-y-0').click();
  await expect(corners(page)).resolves.toEqual(['#FF0000', '#00FF00', '#0000FF', '#FFFF00']);

  // 镜像是在旋转之后的画面上翻：转 90° 再左右镜像 = 左右两列对调
  await page.getByTestId('rotate-0').click();
  await page.getByTestId('flip-x-0').click();
  await expect(corners(page)).resolves.toEqual(['#FF0000', '#0000FF', '#00FF00', '#FFFF00']);
  await page.getByTestId('source-edit-reset-0').click();
  await expect(bar).toHaveAttribute('data-rotate', '0');
  await expect(corners(page)).resolves.toEqual(['#FF0000', '#00FF00', '#0000FF', '#FFFF00']);

  // 等比裁剪缩放：2× 时输出 100×100，比例不变，居中裁的是正中那块（四个象限各占一角）
  const zoom = page.locator('.source-edit__zoom input');
  await zoom.fill('2');
  await expect(bar).toHaveAttribute('data-zoom', '2.00');
  await expect(page.getByTestId('source-edit-size-0')).toContainText('100 × 100');
  await expect(corners(page)).resolves.toEqual(['#FF0000', '#00FF00', '#0000FF', '#FFFF00']);

  // 拖预览把裁剪窗口挪到左上角，整屏只剩红
  const box = (await page.locator('.slot__canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 2, box.y + box.height * 2, { steps: 4 });
  await page.mouse.up();
  await expect(corners(page)).resolves.toEqual(['#FF0000', '#FF0000', '#FF0000', '#FF0000']);

  // 「结果」页也跟着变：编辑前后的渲染结果不一样
  await page.getByRole('tab', { name: '结果' }).click();
  await expect(page.locator('.slot__canvas')).toHaveAttribute('data-tab', 'result');
  const cropped = await canvasHash(page);
  await page.getByRole('tab', { name: '原图' }).click();
  await page.getByTestId('source-edit-reset-0').click();
  await page.getByRole('tab', { name: '结果' }).click();
  await expect.poll(() => canvasHash(page)).not.toBe(cropped);
  await expect(page.locator('.tda-toast--error')).toHaveCount(0);
});

test('换素材会把编辑清掉', async ({ page }) => {
  await page.goto('/');
  await dropQuadrantImage(page);
  await page.getByRole('tab', { name: '原图' }).click();
  await page.getByTestId('rotate-0').click();
  await expect(page.getByTestId('source-edit-0')).toHaveAttribute('data-rotate', '90');
  await dropQuadrantImage(page);
  await expect(page.getByTestId('source-edit-0')).toHaveAttribute('data-rotate', '0');
});
