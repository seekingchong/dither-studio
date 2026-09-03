/** RGB (0..1) ↔ CMYK (0..1)，标准朴素转换 */

export function rgbToCmyk(r: number, g: number, b: number): [number, number, number, number] {
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 1];
  const inv = 1 / (1 - k);
  return [(1 - r - k) * inv, (1 - g - k) * inv, (1 - b - k) * inv, k];
}

export function cmykToRgb(c: number, m: number, y: number, k: number): [number, number, number] {
  return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
}
