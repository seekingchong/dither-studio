/** sRGB 与线性光的互转。 */

export function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

const LUT_SIZE = 4096;
const TO_LINEAR = new Float32Array(LUT_SIZE + 1);
for (let i = 0; i <= LUT_SIZE; i++) TO_LINEAR[i] = srgbToLinear(i / LUT_SIZE);

/** 查表版：输入 0..1 的 sRGB 浮点，输出线性光 */
export function srgbToLinearFast(v: number): number {
  const i = v <= 0 ? 0 : v >= 1 ? LUT_SIZE : Math.round(v * LUT_SIZE);
  return TO_LINEAR[i];
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}
