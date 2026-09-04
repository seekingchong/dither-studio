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
