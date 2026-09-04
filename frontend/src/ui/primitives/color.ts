/** #RRGGBB ⇄ RGB ⇄ HSB（H 0–360，S / B 0–100）。取色层的两种输入模式共用。 */

export interface Hsb {
  h: number;
  s: number;
  b: number;
}

const clamp = (v: number, min: number, max: number) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min);

export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [0, 0, 0];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const hex = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
}

export function rgbToHsb(r: number, g: number, b: number): Hsb {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h: Math.round(h), s: Math.round(max === 0 ? 0 : (d / max) * 100), b: Math.round((max / 255) * 100) };
}

export function hsbToRgb({ h, s, b }: Hsb): [number, number, number] {
  const hh = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 100) / 100;
  const val = clamp(b, 0, 100) / 100;
  const c = val * sat;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = val - c;
  const [r1, g1, b1] =
    hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  return [(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255];
}

export const hexToHsb = (hex: string): Hsb => rgbToHsb(...hexToRgb(hex));
export const hsbToHex = (hsb: Hsb): string => rgbToHex(...hsbToRgb(hsb));

/** 各通道的取值范围，用于输入框的 min / max 与钳位 */
export const HSB_RANGE: Record<keyof Hsb, { max: number; label: string; unit: string }> = {
  h: { max: 360, label: '色相', unit: '°' },
  s: { max: 100, label: '饱和度', unit: '%' },
  b: { max: 100, label: '明度', unit: '%' },
};

export const clampHsb = (channel: keyof Hsb, value: number): number => Math.round(clamp(value, 0, HSB_RANGE[channel].max));
