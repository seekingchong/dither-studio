/** 像素尺寸默认值按输入分辨率自适应：小图 2、中图 3、大图 4（PRD：默认 2–4） */
export function suggestPixelSize(width: number, height: number): number {
  const longSide = Math.max(width, height);
  if (longSide >= 2000) return 4;
  if (longSide >= 1000) return 3;
  return 2;
}
