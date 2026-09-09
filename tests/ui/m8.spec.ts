import { expect, test, type Page } from '@playwright/test';
import { openSection, sectionLabels } from './helpers';

async function dropImage(page: Page, slot = 0) {
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
    dt.items.add(new File([blob], `sample-${slot}.png`, { type: 'image/png' }));
    document.querySelector(`[data-slot="${slot}"]`)!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, slot);
  await expect(page.locator(`[data-slot="${slot}"]`)).toHaveAttribute('data-rendered', 'true');
}

async function pick(page: Page, paramId: string, optionLabel: string) {
  await page.locator(`[data-param="${paramId}"]`).click();
  await page.getByRole('option', { name: optionLabel, exact: true }).click();
}

const familyValue = (page: Page) => page.locator('[data-param="dither.family"] .tda-select__value');
const matrixValue = (page: Page) => page.locator('[data-param="dither.ordered.matrix"] .tda-select__value');

test('预设模块在参数上方：选方案、微调、保存为我的预设、历史页编辑，并跨刷新保留', async ({ page }) => {
  await page.goto('/');
  await dropImage(page);
  // 参数页里：预设模块在上、参数模块在下，没有单独的"预设"tab
  await expect(page.getByRole('tab', { name: '预设' })).toHaveCount(0);
  const picker = page.getByTestId('preset-picker');
  await expect(picker).toBeVisible();
  // 卡片最多露三行：这个栏宽下一排三张，11 套内置里先露 9 张，其余折起来
  await expect(page.locator('.preset-card')).toHaveCount(9);
  await expect(page.getByTestId('preset-more')).toHaveText('还有 2 个');
  await page.getByTestId('preset-more').click();
  await expect(page.locator('.preset-card')).toHaveCount(11);
  await expect(page.getByTestId('preset-more')).toHaveText('收起');
  const pickerBox = await picker.boundingBox();
  const paramsBox = await page.getByTestId('params-module').boundingBox();
  expect(pickerBox!.y).toBeLessThan(paramsBox!.y);
  await expect(page.locator('[data-preset="default"]')).toHaveClass(/is-active/);
  await expect(page.getByTestId('preset-status')).toHaveText('当前预设：默认');

  // 选 Game Boy：参数跟着变，且只露出这套方案具备的分组（没有网格 / 特效）
  await page.locator('[data-preset="gameboy"]').click();
  await expect(page.locator('[data-preset="gameboy"]')).toHaveClass(/is-active/);
  await expect(familyValue(page)).toHaveText('有序');
  await expect(page.locator('[data-param="color.mode"] .tda-select__value')).toHaveText('Palette');
  // 分节可折叠、排成一列；画布不在左栏（在预览区的「画布」菜单里）
  await expect(sectionLabels(page)).toHaveText(['基础', '颜色', '影调']);
  await expect(page.locator('[data-group="canvas"]')).toHaveCount(0);
  await page.locator('[data-preset="dot-matrix"]').click();
  await expect(sectionLabels(page)).toHaveText(['基础', '颜色', '影调', '网格']);
  await page.locator('[data-preset="default"]').click();
  await expect(sectionLabels(page)).toHaveText(['基础', '颜色', '影调', '网格', '特效']);

  // 在 Game Boy 基础上微调 → 状态显示已微调，可还原
  await page.locator('[data-preset="gameboy"]').click();
  await openSection(page, 'tone');
  const brightness = page.locator('[data-param="tone.brightness"] input[type="range"]');
  await brightness.fill('20');
  await expect(page.getByTestId('preset-status')).toHaveText('当前预设：Game Boy · 已微调');
  await expect(page.locator('[data-preset="gameboy"]')).toHaveClass(/is-active/);
  await page.getByRole('button', { name: '还原' }).click();
  await expect(page.getByTestId('preset-status')).toHaveText('当前预设：Game Boy');
  await expect(page.getByRole('button', { name: '还原' })).toBeDisabled();

  // 分节标题右端的「重置」只退这一节：影调与基础各改一处，重置影调后基础的改动还在
  await brightness.fill('20');
  const pixel = page.locator('[data-param="pixel.size"] .tda-slider__input');
  await pixel.fill('8');
  await pixel.press('Enter');
  await expect(page.getByTestId('reset-tone')).toBeEnabled();
  await expect(page.getByTestId('reset-color')).toBeDisabled();
  await page.getByTestId('reset-tone').click();
  await expect(page.locator('[data-param="tone.brightness"] input[type="range"]')).toHaveValue('0');
  await expect(page.getByTestId('reset-tone')).toBeDisabled();
  // 影调退回的是 Game Boy 自己的值（对比 +15），不是 schema 默认值
  await expect(page.locator('[data-param="tone.contrast"] input[type="range"]')).toHaveValue('15');
  await expect(page.locator('[data-param="pixel.size"] .tda-slider__range')).toHaveValue('8');
  await page.getByTestId('reset-basic').click();
  await expect(page.locator('[data-param="pixel.size"] .tda-slider__range')).toHaveValue('4');
  await expect(page.getByTestId('preset-status')).toHaveText('当前预设：Game Boy');

  await brightness.fill('20');

  // 保存预设在左栏操作行：点开浮层，名字已经预填成「当前方案 副本」，改个名再存
  await expect(page.locator('.pane--params .pane-actions').getByTestId('preset-save-button')).toBeVisible();
  await page.getByTestId('preset-save-button').click();
  await expect(page.getByLabel('新预设名称')).toHaveValue('Game Boy 副本');
  await page.getByLabel('新预设名称').fill('我的 GB');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByTestId('preset-save-menu')).toHaveCount(0);
  // 存下来的方案排在内置方案前面，成为当前方案；来源是 Game Boy
  await expect(page.locator('.preset-card').first()).toHaveClass(/preset-card--user/);
  await expect(page.locator('.preset-card--user')).toHaveCount(1);
  await expect(page.locator('.preset-card--user')).toContainText('我的 GB');
  await expect(page.locator('.preset-card--user')).toContainText('基于 Game Boy');
  await expect(page.locator('.preset-card--user')).toHaveClass(/is-active/);
  await expect(page.getByTestId('preset-status')).toHaveText('当前预设：我的 GB');
  await expect(sectionLabels(page)).toHaveText(['基础', '颜色', '影调']);

  // 预设不进历史：历史里是「素材 + 参数」的方案，得走预览头的「保存」
  await page.getByRole('tab', { name: '历史' }).click();
  await expect(page.getByTestId('history-pane')).toBeVisible();
  await expect(page.locator('.history-item')).toHaveCount(0);
  await page.getByTestId('save-history').click();
  await expect(page.locator('.tda-toast')).toContainText('已保存方案');
  // 一条记录：名字「素材名 · 预设名」，带缩略图、素材、来源与摘要
  await expect(page.locator('.history-item')).toHaveCount(1);
  await expect(page.locator('.history-item__name')).toContainText('sample-0 · 我的 GB');
  await expect(page.locator('.history-item__media')).toHaveText('sample-0.png（图片）');
  await expect(page.locator('.history-item__meta')).toHaveText(/基于 我的 GB · 有序 · Bayer 4×4 · Palette · 像素 4/);
  await expect(page.locator('.history-item__thumb img')).toHaveAttribute('src', /^data:image\/png/);
  await expect(page.locator('.history-item__tag')).toHaveText('使用中');

  // 刷新后仍在（web 端存 localStorage）：预设与方案各存各的
  await page.reload();
  await page.locator('[data-slot="0"]').waitFor();
  await expect(page.locator('.preset-card--user')).toHaveCount(1);
  // 参数本身不持久化：回到默认 Bayer 2×2
  await expect(matrixValue(page)).toHaveText('Bayer 2×2');

  // 从历史页应用：回到参数页，参数与来源预设都恢复；素材还没放回来，方案先只套参数
  await page.getByRole('tab', { name: '历史' }).click();
  await expect(page.locator('.history-item')).toHaveCount(1);
  await page.locator('.history-item').getByRole('button', { name: '应用', exact: true }).click();
  await expect(page.getByTestId('preset-picker')).toBeVisible();
  await expect(page.locator('.tda-toast')).toContainText('放入素材后再看效果');
  await expect(familyValue(page)).toHaveText('有序');
  await expect(matrixValue(page)).toHaveText('Bayer 4×4');
  await openSection(page, 'tone');
  await expect(page.locator('[data-param="tone.brightness"] input[type="range"]')).toHaveValue('20');
  await expect(page.getByTestId('preset-status')).toHaveText('当前预设：我的 GB');
  // 素材没回来算动过；同一份素材放回来就不算
  await page.getByRole('tab', { name: '历史' }).click();
  await expect(page.locator('.history-item__tag')).toHaveText('使用中 · 已微调');
  await dropImage(page);
  await expect(page.locator('.history-item__tag')).toHaveText('使用中');
  await expect(page.locator('.history-item__chip')).toHaveText('当前素材');

  // 微调后在历史页"更新"写回，再重命名与删除
  await page.getByRole('tab', { name: '抖动' }).click();
  await openSection(page, 'tone');
  await page.locator('[data-param="tone.brightness"] input[type="range"]').fill('30');
  await page.getByRole('tab', { name: '历史' }).click();
  await expect(page.locator('.history-item__tag')).toHaveText('使用中 · 已微调');
  await page.locator('.history-item').getByRole('button', { name: '更新' }).click();
  await expect(page.locator('.history-item__tag')).toHaveText('使用中');
  await page.getByRole('button', { name: '重命名' }).click();
  await page.getByLabel('方案名称', { exact: true }).fill('GB 改名');
  await page.getByLabel('方案名称', { exact: true }).press('Enter');
  await expect(page.locator('.history-item')).toContainText('GB 改名');
  await page.getByRole('button', { name: '删除' }).click();
  await expect(page.locator('.history-item')).toHaveCount(0);
  // 删除正在用的方案：参数保留，预设「我的 GB」不受影响（相对它有微调）
  await page.getByRole('tab', { name: '抖动' }).click();
  await expect(page.locator('[data-param="tone.brightness"] input[type="range"]')).toHaveValue('30');
  await expect(page.getByTestId('preset-status')).toHaveText('当前预设：我的 GB · 已微调');
  await page.reload();
  await page.locator('[data-slot="0"]').waitFor();
  await expect(page.locator('.preset-card--user')).toHaveCount(1);
  await page.getByRole('tab', { name: '历史' }).click();
  await expect(page.locator('.history-item')).toHaveCount(0);

  // 预设模块自己的「重置」= 退回「默认」；已经在默认且没微调时置灰
  await page.getByRole('tab', { name: '抖动' }).click();
  await page.locator('[data-preset="gameboy"]').click();
  await expect(page.getByTestId('reset-preset')).toBeEnabled();
  await page.getByTestId('reset-preset').click();
  await expect(page.locator('[data-preset="default"]')).toHaveClass(/is-active/);
  await expect(page.getByTestId('preset-status')).toHaveText('当前预设：默认');
  await expect(page.getByTestId('reset-preset')).toBeDisabled();
});

test('撤销 / 重做只走快捷键，滑块拖动合并', async ({ page }) => {
  await page.goto('/');
  await dropImage(page);
  // 面板上没有撤销 / 重做 / 打开 / 复制按钮
  await expect(page.getByRole('button', { name: '撤销' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '重做' })).toHaveCount(0);
  await pick(page, 'dither.family', '误差扩散');
  await expect(familyValue(page)).toHaveText('误差扩散');

  // 键盘：Ctrl+Z / Shift+Ctrl+Z / Ctrl+Y
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect(familyValue(page)).toHaveText('有序');
  await page.keyboard.press('Control+Shift+z');
  await expect(familyValue(page)).toHaveText('误差扩散');
  await page.keyboard.press('Control+z');
  await expect(familyValue(page)).toHaveText('有序');
  await page.keyboard.press('Control+y');
  await expect(familyValue(page)).toHaveText('误差扩散');

  // 拖动滑块的连续变化只算一步
  const range = page.locator('[data-param="pixel.size"] .tda-slider__range');
  const box = (await range.boundingBox())!;
  await page.mouse.move(box.x + 8, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + 8 + i * 6, box.y + box.height / 2);
  await page.mouse.up();
  const after = await range.inputValue();
  expect(Number(after)).toBeGreaterThan(4);
  await page.keyboard.press('Control+z');
  await expect(range).toHaveValue('4');
  await expect(familyValue(page)).toHaveText('误差扩散');
});

test('深色主题与 4 坑位预览', async ({ page }) => {
  await page.goto('/');
  await dropImage(page);
  await page.getByTestId('settings-button').click();
  await pick(page, 'settings.theme', '深色');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.pane--params')!).backgroundColor);
  expect(bg).not.toBe('rgb(255, 255, 255)');

  await pick(page, 'settings.slotCount', '4 个媒体');
  await page.keyboard.press('Escape');
  await expect(page.locator('.slot')).toHaveCount(4);
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-rendered', 'true');
  await dropImage(page, 2);
  await expect(page.locator('[data-slot="2"]')).toHaveClass(/is-active/);
  await expect(page).toHaveScreenshot('m8-dark-4slots.png', { maxDiffPixelRatio: 0.02 });

  // 设置跨刷新保留
  await page.reload();
  await page.locator('[data-slot="0"]').waitFor();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.slot')).toHaveCount(4);
  await page.getByTestId('settings-button').click();
  await pick(page, 'settings.theme', '浅色');
  await pick(page, 'settings.slotCount', '1 个媒体');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('我的预设卡片右上角：复制 / 星标 / 删除，鼠标移上去才露出，删除要二次确认', async ({ page }) => {
  await page.goto('/');
  await dropImage(page);

  // 先存一套我的预设
  await page.locator('[data-preset="gameboy"]').click();
  await page.getByTestId('preset-save-button').click();
  await page.getByLabel('新预设名称').fill('甲');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.preset-card--user')).toHaveCount(1);

  // 内置方案的卡片上没有这排图标——只有自己存的才能改
  await expect(page.locator('[data-preset="gameboy"] .preset-card__action')).toHaveCount(0);

  // 平时藏着，鼠标移到卡片上才露出三个
  const jia = page.locator('.preset-card--user').first();
  await expect(jia.getByTestId('preset-card-duplicate')).toBeHidden();
  await jia.hover();
  await expect(jia.getByTestId('preset-card-duplicate')).toBeVisible();
  await expect(jia.getByTestId('preset-card-star')).toBeVisible();
  await expect(jia.getByTestId('preset-card-remove')).toBeVisible();

  // 复制：多出一张「甲 副本」排在原件后面，当前用哪套不变（点图标不算点卡片）
  await jia.getByTestId('preset-card-duplicate').click();
  await expect(page.locator('.preset-card--user')).toHaveCount(2);
  await expect(page.locator('.preset-card--user').nth(1)).toContainText('甲 副本');
  await expect(page.locator('.preset-card--user').nth(1)).toContainText('基于 Game Boy');
  await expect(page.getByTestId('preset-status')).toHaveText('当前预设：甲');

  // 星标：排到我的预设最前面，那颗星不 hover 也一直亮着
  const copy = page.locator('.preset-card--user').nth(1);
  await copy.hover();
  await copy.getByTestId('preset-card-star').click();
  await expect(page.locator('.preset-card--user').first()).toContainText('甲 副本');
  // 鼠标移开、焦点也挪走：星标那张只剩星还亮着，没星标的那张整排都收回去
  await page.getByTestId('preset-status').hover();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(page.locator('.preset-card--user').first().getByTestId('preset-card-star')).toBeVisible();
  await expect(page.locator('.preset-card--user').first().getByTestId('preset-card-duplicate')).toBeHidden();
  await expect(page.locator('.preset-card--user').nth(1).getByTestId('preset-card-star')).toBeHidden();

  // 删除先弹气泡问一句：取消就什么也不删
  const jiaNow = page.locator('.preset-card--user').nth(1);
  await jiaNow.hover();
  await jiaNow.getByTestId('preset-card-remove').click();
  await expect(page.getByTestId('preset-delete-confirm')).toBeVisible();
  await expect(page.getByTestId('preset-delete-confirm')).toContainText('删除预设「甲」？');
  await page.getByTestId('preset-delete-cancel').click();
  await expect(page.getByTestId('preset-delete-confirm')).toHaveCount(0);
  await expect(page.locator('.preset-card--user')).toHaveCount(2);

  // Esc 也能把气泡收掉（气泡收掉后鼠标落在卡片外，图标跟着收回去，得重新移上去）
  await jiaNow.hover();
  await jiaNow.getByTestId('preset-card-remove').click();
  await expect(page.getByTestId('preset-delete-confirm')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('preset-delete-confirm')).toHaveCount(0);

  // 确认了才真删；删掉的是正在用的那套，参数保留、来源退回它所基于的 Game Boy
  await jiaNow.hover();
  await jiaNow.getByTestId('preset-card-remove').click();
  await page.getByTestId('preset-delete-confirm-ok').click();
  await expect(page.locator('.preset-card--user')).toHaveCount(1);
  await expect(page.locator('.preset-card--user')).toContainText('甲 副本');
  await expect(page.getByTestId('preset-status')).toHaveText('当前预设：Game Boy');

  // 星标跨刷新保留
  await page.reload();
  await page.locator('[data-slot="0"]').waitFor();
  await expect(page.locator('.preset-card--user')).toHaveCount(1);
  await expect(page.locator('.preset-card--user').getByTestId('preset-card-star')).toBeVisible();
});
