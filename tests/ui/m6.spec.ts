import { expect, test, type Page } from '@playwright/test';
import { openSection } from './helpers';

async function dropImage(page: Page) {
  await page.locator('[data-slot="0"]').waitFor();
  await page.evaluate(async () => {
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
    document.querySelector('[data-slot="0"]')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true');
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

test('特效栈：添加、堆叠、排序、关闭、删除', async ({ page }) => {
  await page.goto('/');
  await dropImage(page);
  await openSection(page, 'effects');
  await expect(page.getByTestId('effects-editor')).toContainText('还没有特效');
  // 特效选项全部露出为芯片，不是下拉
  const chips = page.getByTestId('effects-add').getByRole('button');
  await expect(chips).toHaveCount(12);
  await expect(page.locator('[data-param="effects.add"]')).toHaveCount(0);
  const base = await canvasHash(page);

  await page.getByTestId('effects-add').getByRole('button', { name: '扫描线 / CRT' }).click();
  await expect(page.locator('[data-effect-add="scanlines"]')).toHaveClass(/is-used/);
  await expect(page.locator('.effect-card')).toHaveCount(1);
  await expect(page.locator('.effect-card').first()).toContainText('扫描线 / CRT');
  await expect.poll(() => canvasHash(page)).not.toBe(base);
  const withScan = await canvasHash(page);

  await page.getByTestId('effects-add').getByRole('button', { name: '波形' }).click();
  await expect(page.locator('.effect-card')).toHaveCount(2);
  await expect.poll(() => canvasHash(page)).not.toBe(withScan);
  const scanThenWave = await canvasHash(page);

  // 上移波形：顺序变为 波形 → 扫描线，结果不同
  await page.locator('.effect-card').nth(1).getByRole('button', { name: '上移' }).click();
  await expect(page.locator('.effect-card').first()).toContainText('波形');
  await expect.poll(() => canvasHash(page)).not.toBe(scanThenWave);

  // 关闭扫描线后只剩波形
  await page.locator('.effect-card').nth(1).locator('.effect-card__switch').click();
  await expect(page.locator('.effect-card').nth(1)).toHaveClass(/is-disabled/);
  await expect.poll(() => canvasHash(page)).not.toBe(scanThenWave);

  // 改波形振幅
  const amp = page.locator('.effect-card').first().locator('[data-param="effect.amplitude"] .tda-slider__input');
  await amp.fill('40');
  await amp.press('Enter');
  const bigWave = await canvasHash(page);
  expect(bigWave).not.toBe(scanThenWave);

  // 删除两个特效后回到原始画面
  await page.locator('.effect-card').first().getByRole('button', { name: '删除' }).click();
  await page.locator('.effect-card').first().getByRole('button', { name: '删除' }).click();
  await expect(page.locator('.effect-card')).toHaveCount(0);
  await expect.poll(() => canvasHash(page)).toBe(base);
  await expect(page.locator('.tda-toast--error')).toHaveCount(0);
});

test('灰度块描边：阶数跟随风格，各阶芯片可开关，底色只在「只留描边」下露出', async ({ page }) => {
  await page.goto('/');
  await dropImage(page);
  await openSection(page, 'effects');
  const base = await canvasHash(page);

  await page.getByTestId('effects-add').getByRole('button', { name: '灰度块描边' }).click();
  const card = page.locator('.effect-card[data-effect="levelOutline"]');
  await expect(card).toHaveCount(1);
  // 默认方案是单色，两阶，芯片就是两枚
  await expect(card.locator('.level-mask__chip')).toHaveCount(2);
  await expect(card.locator('.level-mask__chip[aria-pressed="true"]')).toHaveCount(2);
  await expect.poll(() => canvasHash(page)).not.toBe(base);

  // 灰阶数改 4 → 四枚芯片
  const levels = card.locator('[data-param="effect.levels"] .tda-slider__input');
  await levels.fill('4');
  await levels.press('Enter');
  await expect(card.locator('.level-mask__chip')).toHaveCount(4);

  // 四阶全关：没有线，画面回到原样
  for (let i = 0; i < 4; i++) await card.locator('.level-mask__chip').nth(i).click();
  await expect(card.locator('.level-mask__chip[aria-pressed="true"]')).toHaveCount(0);
  await expect.poll(() => canvasHash(page)).toBe(base);
  // 再开最暗一阶，线回来了
  await card.locator('.level-mask__chip').nth(3).click();
  await expect(card.locator('.level-mask__chip[aria-pressed="true"]')).toHaveCount(1);
  await expect.poll(() => canvasHash(page)).not.toBe(base);

  // 底色只在「只留描边」下露出
  await expect(card.locator('[data-param="effect.paper"]')).toHaveCount(0);
  await pick(page, 'effect.fill', '只留描边');
  await expect(card.locator('[data-param="effect.paper"]')).toHaveCount(1);
  await expect(page.locator('.tda-toast--error')).toHaveCount(0);
});

test('叠加随机方块：数量决定色块数，改样式露出字母，点色块改色转自定义', async ({ page }) => {
  await page.goto('/');
  await dropImage(page);
  await openSection(page, 'effects');
  const base = await canvasHash(page);
  await page.getByTestId('effects-add').getByRole('button', { name: '叠加随机方块' }).click();
  const card = page.locator('.effect-card').first();
  await expect(card).toContainText('叠加随机方块');
  await expect.poll(() => canvasHash(page)).not.toBe(base);
  // 默认 6 块，白色；数量改 3 就剩 3 块
  const swatches = card.locator('[data-param="effect.colors"] .swatch');
  await expect(swatches).toHaveCount(6);
  await expect(swatches.first()).toHaveAttribute('aria-label', '第 1 块 #FFFFFF');
  const count = card.locator('[data-param="effect.count"] .tda-slider__input');
  await count.fill('3');
  await count.press('Enter');
  await expect(swatches).toHaveCount(3);
  // 纯色块时没有字母框；切到「色块 + 字母」才露出
  await expect(card.locator('[data-param="effect.letters"]')).toHaveCount(0);
  await pick(page, 'effect.style', '色块 + 字母');
  await expect(card.locator('[data-param="effect.letters"] input')).toHaveValue('A');
  // 每块一个文字框，按字母串填满；单独改第二块（回车写回、清洗成大写），改「字母」再重新填满
  const texts = card.locator('[data-param="effect.texts"] input');
  await expect(texts).toHaveCount(3);
  await expect(texts.nth(1)).toHaveValue('A');
  await texts.nth(1).fill('ok');
  await texts.nth(1).press('Enter');
  await expect(texts.nth(1)).toHaveValue('OK');
  await expect(texts.nth(0)).toHaveValue('A');
  const letters = card.locator('[data-param="effect.letters"] input');
  await letters.fill('XY');
  await letters.press('Enter');
  await expect(texts.nth(0)).toHaveValue('X');
  await expect(texts.nth(1)).toHaveValue('Y');
  await expect(texts.nth(2)).toHaveValue('X');
  await expect(card.locator('[data-param="effect.letterHex"]')).toHaveCount(0);
  await pick(page, 'effect.letterColor', '自定义');
  await expect(card.locator('[data-param="effect.letterHex"]')).toHaveCount(1);
  // 配色换成黑白：块交替；点第二块改色后方案转为自定义
  await pick(page, 'effect.palette', '黑白');
  await expect(swatches.nth(1)).toHaveAttribute('aria-label', '第 2 块 #000000');
  await swatches.nth(1).click();
  const popover = page.locator('.color-popover');
  await expect(popover).toContainText('修改后会转为「自定义」配色');
  await popover.getByRole('button', { name: 'HEX' }).click();
  const hex = popover.locator('input[type="text"]').first();
  await hex.fill('#FF00FF');
  await hex.press('Enter');
  await expect(swatches.nth(1)).toHaveAttribute('aria-label', '第 2 块 #FF00FF');
  await expect(card.locator('[data-param="effect.palette"]')).toContainText('自定义');
  await page.screenshot({ path: process.env.BLOCKS_SHOT ?? 'test-results/blocks.png' });
  await expect(page.locator('.tda-toast--error')).toHaveCount(0);
});
