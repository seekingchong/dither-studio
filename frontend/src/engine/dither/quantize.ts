/** 把 0..1 的值量化成 0..levels-1 的索引（四舍五入到最近一级） */
export function quantize(v: number, levels: number): number {
  const max = levels - 1;
  const q = Math.round(v * max);
  return q < 0 ? 0 : q > max ? max : q;
}

/** 索引对应的亮度 0..1 */
export function levelValue(index: number, levels: number): number {
  return index / (levels - 1);
}
