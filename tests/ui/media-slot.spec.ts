import { expect, test, type Page } from '@playwright/test';

/** 在页面里合成一张图并以拖拽方式放进指定坑位 */
async function dropSyntheticImage(page: Page, slot = 0) {
  await page.locator(`[data-slot="${slot}"]`).waitFor();
  await page.evaluate(async (slot) => {
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
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'sample.png', { type: 'image/png' }));
    document.querySelector(`[data-slot="${slot}"]`)!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, slot);
  await expect(page.locator(`[data-slot="${slot}"]`)).toHaveAttribute('data-rendered', 'true');
}

async function useFourSlots(page: Page) {
  await page.getByTestId('settings-button').click();
  await page.locator('[data-param="settings.slotCount"]').click();
  await page.getByRole('option', { name: '4 个媒体', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.slot')).toHaveCount(4);
}

/** 造一个带图片的 paste 事件打到 window 上（Playwright 没法写系统剪贴板） */
async function pasteImage(page: Page, name = 'pasted.png', mime = 'image/png') {
  await page.evaluate(
    async ({ name, mime }) => {
      const c = document.createElement('canvas');
      c.width = 300;
      c.height = 200;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#444';
      ctx.fillRect(0, 0, 300, 200);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(150, 100, 60, 0, Math.PI * 2);
      ctx.fill();
      const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], name, { type: mime }));
      window.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
    },
    { name, mime },
  );
}

test('粘贴：⌘V 把剪贴板里的图片放进当前选中的坑位', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-slot="0"]').waitFor();
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'false');

  await pasteImage(page);
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true', { timeout: 15_000 });
  // 拖拽区让位给画布，说明素材真的进来了
  await expect(page.locator('[data-slot="0"] .slot__canvas')).toBeVisible();
});

test('粘贴：进的是当前选中的那个坑位，不是永远第 0 个', async ({ page }) => {
  await page.goto('/');
  await useFourSlots(page);

  // 选中第 3 个坑位再粘
  await page.locator('[data-slot="2"]').click();
  await pasteImage(page);
  await expect(page.locator('[data-slot="2"]')).toHaveAttribute('data-rendered', 'true', { timeout: 15_000 });
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'false');
});

test('粘贴：剪贴板里只有文字时不接管，提示一句', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-slot="0"]').waitFor();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '一段文字');
    window.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
  });
  await expect(page.getByRole('status')).toContainText('剪贴板里没有图片或视频');
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'false');
});

test('删除：hover 才露出清空按钮，点一下坑位回到空态', async ({ page }) => {
  await page.goto('/');
  await dropSyntheticImage(page);

  const slot = page.locator('[data-slot="0"]');
  const remove = page.getByTestId('slot-remove-0');
  // 挂在 DOM 上但没显形，也点不到
  await expect(remove).toHaveCSS('opacity', '0');
  await expect(remove).toHaveCSS('pointer-events', 'none');

  await slot.hover();
  await expect(remove).toHaveCSS('opacity', '1');
  await expect(remove).toHaveCSS('pointer-events', 'auto');

  await remove.click();
  await expect(slot).toHaveAttribute('data-rendered', 'false');
  await expect(slot.locator('.slot__canvas')).toHaveCount(0);
  await expect(slot.locator('.dropzone')).toBeVisible();
  // 空坑位不给清空按钮
  await expect(remove).toHaveCount(0);
});

test('删除：清空之后还能再粘一张进来', async ({ page }) => {
  await page.goto('/');
  await dropSyntheticImage(page);
  await page.locator('[data-slot="0"]').hover();
  await page.getByTestId('slot-remove-0').click();
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'false');

  await pasteImage(page);
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true', { timeout: 15_000 });
});
