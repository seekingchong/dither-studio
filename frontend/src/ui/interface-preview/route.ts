/**
 * 界面预览窗口的地址约定。
 * Electron 主进程（tsconfig 里只有 ES2022，没有 DOM）也要用它来放行新窗口，
 * 所以这个文件只用基本类型，别往里加任何 DOM 相关的东西。
 */

/** 主窗口地址加上这个 hash 就是界面预览窗口 */
export const PREVIEW_ROUTE = '#interface-preview';

/** 一个坑位一扇窗：窗口名按坑位区分，再次双击同一个坑位复用同一扇窗而不是又开一个 */
export const previewWindowName = (slot: number) => `dither-interface-preview-${slot}`;

/** 这个地址是不是界面预览窗口（主进程放行 window.open 时按它判断） */
export function isPreviewUrl(url: string): boolean {
  const at = url.indexOf('#');
  if (at < 0) return false;
  const hash = url.slice(at);
  return hash === PREVIEW_ROUTE || hash.startsWith(`${PREVIEW_ROUTE}?`);
}

/** 从 hash 里解析坑位号；不是预览地址返回 null，没带坑位号当 0 */
export function previewSlotFromHash(hash: string): number | null {
  if (hash !== PREVIEW_ROUTE && !hash.startsWith(`${PREVIEW_ROUTE}?`)) return null;
  const match = /[?&]slot=(\d+)/.exec(hash.slice(PREVIEW_ROUTE.length));
  return match ? Number(match[1]) : 0;
}
