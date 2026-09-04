/**
 * 坑位号 → 预览画布元素。
 * 界面预览窗口要帧时主窗口照这张表取画布，不用每帧满 DOM 找；画布卸载时自己注销。
 */
const canvases = new Map<number, HTMLCanvasElement>();

/** 注册一个坑位的画布，返回注销函数 */
export function registerSlotCanvas(slot: number, canvas: HTMLCanvasElement): () => void {
  canvases.set(slot, canvas);
  return () => {
    // 坑位的画布可能已经被下一次挂载换掉了，只撤自己这一份
    if (canvases.get(slot) === canvas) canvases.delete(slot);
  };
}

export function slotCanvas(slot: number): HTMLCanvasElement | null {
  return canvases.get(slot) ?? null;
}
