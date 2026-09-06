/**
 * 坑位号 → 取这个坑位「全画布尺寸」画面的函数。
 * 界面预览窗口要帧时主窗口照这张表取，不用每帧满 DOM 找；画布卸载时自己注销。
 *
 * 登记的是函数而不是元素：预览缩到 100% 以下时屏幕上那块 canvas 的后备存储只有屏幕物理像素那么大
 * （帧已经缩过），拿去当帧源会糊；这时由画布自己给一份全尺寸的副本。
 */
export type SlotCanvasProvider = () => HTMLCanvasElement | null;

const providers = new Map<number, SlotCanvasProvider>();

/** 登记一个坑位的画面来源，返回注销函数 */
export function registerSlotCanvas(slot: number, provide: SlotCanvasProvider): () => void {
  providers.set(slot, provide);
  return () => {
    // 坑位的画布可能已经被下一次挂载换掉了，只撤自己这一份
    if (providers.get(slot) === provide) providers.delete(slot);
  };
}

/** 该坑位当前画面的全尺寸画布（画布尺寸 × 1），没有就 null */
export function slotCanvas(slot: number): HTMLCanvasElement | null {
  return providers.get(slot)?.() ?? null;
}
