import { expect, type Page } from '@playwright/test';

/** 左栏参数分节：展开指定的一节（已经展开就不动） */
export async function openSection(page: Page, id: string): Promise<void> {
  const section = page.locator(`[data-section="${id}"]`);
  await section.waitFor();
  if ((await section.getAttribute('data-open')) !== 'true') await section.locator('.section__toggle').click();
  await expect(section).toHaveAttribute('data-open', 'true');
}

/** 当前露出的分节标题 */
export const sectionLabels = (page: Page) => page.getByTestId('params-module').locator('.section__label');

/** 缩放档位在预览区右上角的「画布」菜单里：没开就先打开，选完按 Esc 把菜单收起来，别挡着后面的操作 */
export async function setZoom(page: Page, label: string): Promise<void> {
  if ((await page.getByTestId('canvas-menu').count()) === 0) await page.getByTestId('canvas-menu-button').click();
  await page.locator('.preview-zoom').click();
  await page.getByRole('option', { name: label, exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('canvas-menu')).toHaveCount(0);
}
