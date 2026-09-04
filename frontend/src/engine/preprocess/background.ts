import type { GrayFrame, RGBFrame } from '../types';
import { createGray } from '../types';

export type BgScope = 'connected' | 'all';
export type BgReference = 'auto' | 'manual';
export type BgPolarity = 'auto' | 'light' | 'dark';

/**
 * 强制背景：把干净的背景换成一片规则的点，前景与高光原样保留。
 * 背景靠"与画面边缘相连的同色区域"判定（不是靠亮度），所以颜色和背景一样的高光不会被当成背景。
 */
export interface ForcedBackgroundOptions {
  enabled: boolean;
  /** 背景里带点的格子比例 0..1 */
  density: number;
  /** 点是暗点还是亮点：auto 按背景亮度判断 */
  polarity: BgPolarity;
  /** 替换程度 0..1：1 把背景完全铺平，点最规则 */
  strength: number;
  /** 前景四周留白的格子数 */
  margin: number;
  /** connected：只算与画面边缘相连的区域；all：全图同色都算 */
  scope: BgScope;
  reference: BgReference;
  /** 手动参考色，sRGB 0..1 */
  color: [number, number, number];
  /** 与参考色允许的最大色差 0..1 */
  tolerance: number;
  /** 相邻格子之间允许的色差 0..1，决定蒙版能否沿淡渐变生长 */
  smooth: number;
}

export const DEFAULT_FORCED_BG: ForcedBackgroundOptions = {
  enabled: false,
  density: 0.25,
  polarity: 'auto',
  strength: 1,
  margin: 0,
  scope: 'connected',
  reference: 'auto',
  color: [1, 1, 1],
  tolerance: 0.3,
  smooth: 0.06,
};

/** 两个 sRGB 0..1 颜色的距离 0..1（三通道均方根） */
function colorDistance(data: Float32Array, i: number, r: number, g: number, b: number): number {
  const dr = data[i] - r;
  const dg = data[i + 1] - g;
  const db = data[i + 2] - b;
  return Math.sqrt((dr * dr + dg * dg + db * db) / 3);
}

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  return values[values.length >> 1];
}

/** 画面边缘一圈格子的中位色，作为自动参考色；主体碰到边缘时中位数仍偏向背景 */
export function borderMedianColor(rgb: RGBFrame): [number, number, number] {
  const { width, height, data } = rgb;
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  const take = (i: number) => {
    r.push(data[i * 3]);
    g.push(data[i * 3 + 1]);
    b.push(data[i * 3 + 2]);
  };
  for (let x = 0; x < width; x++) {
    take(x);
    if (height > 1) take((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    take(y * width);
    if (width > 1) take(y * width + width - 1);
  }
  return [median(r), median(g), median(b)];
}

/**
 * 背景蒙版（1 = 背景格子）。
 * connected：从画面边缘洪泛，每一步要求与相邻格子色差 ≤ smooth（容忍淡渐变），
 * 同时与参考色色差 ≤ tolerance（防止顺着柔和边缘渗进主体）。
 * all：不看连通性，全图与参考色接近的格子都算背景。
 */
export function backgroundMask(rgb: RGBFrame, opts: ForcedBackgroundOptions): Uint8Array {
  const { width, height, data } = rgb;
  const count = width * height;
  const mask = new Uint8Array(count);
  const [rr, rg, rb] = opts.reference === 'manual' ? opts.color : borderMedianColor(rgb);
  const tol = Math.max(0, opts.tolerance);
  const near = (i: number) => colorDistance(data, i * 3, rr, rg, rb) <= tol;

  if (opts.scope === 'all') {
    for (let i = 0; i < count; i++) if (near(i)) mask[i] = 1;
  } else {
    const smooth = Math.max(0, opts.smooth);
    const stack = new Int32Array(count);
    let sp = 0;
    const seed = (i: number) => {
      if (!mask[i] && near(i)) {
        mask[i] = 1;
        stack[sp++] = i;
      }
    };
    for (let x = 0; x < width; x++) {
      seed(x);
      seed((height - 1) * width + x);
    }
    for (let y = 0; y < height; y++) {
      seed(y * width);
      seed(y * width + width - 1);
    }
    while (sp > 0) {
      const i = stack[--sp];
      const j = i * 3;
      const r = data[j];
      const g = data[j + 1];
      const b = data[j + 2];
      const x = i % width;
      const grow = (k: number) => {
        if (mask[k]) return;
        if (colorDistance(data, k * 3, r, g, b) <= smooth && near(k)) {
          mask[k] = 1;
          stack[sp++] = k;
        }
      };
      if (x > 0) grow(i - 1);
      if (x < width - 1) grow(i + 1);
      if (i >= width) grow(i - width);
      if (i + width < count) grow(i + width);
    }
  }

  return opts.margin > 0 ? erodeMask(mask, width, height, Math.round(opts.margin)) : mask;
}

/** 把蒙版向内收缩 radius 格（前景向外膨胀），用可分离的方形窗口 */
export function erodeMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return mask;
  const pass = (src: Uint8Array, stepX: number, stepY: number, lenA: number, lenB: number): Uint8Array => {
    const out = new Uint8Array(src.length);
    for (let a = 0; a < lenA; a++) {
      const base = a * stepY;
      for (let b = 0; b < lenB; b++) {
        let keep = 1;
        const lo = Math.max(0, b - radius);
        const hi = Math.min(lenB - 1, b + radius);
        for (let k = lo; k <= hi; k++) {
          if (!src[base + k * stepX]) {
            keep = 0;
            break;
          }
        }
        out[base + b * stepX] = keep;
      }
    }
    return out;
  };
  const horizontal = pass(mask, 1, width, height, width);
  return pass(horizontal, width, 1, width, height);
}

/** 蒙版内亮度均值 ≥ 0.5 视为亮底；空蒙版按亮底处理 */
export function isLightBackground(gray: Float32Array, mask: Uint8Array): boolean {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      sum += gray[i];
      n++;
    }
  }
  return n === 0 || sum / n >= 0.5;
}

/**
 * 背景的目标亮度：纸色（或墨色）加上 density 比例的相邻一级。
 * 1-bit 时就是 1 - density（亮底）或 density（暗底）；多级时点用相邻一级的颜色，背景仍以纸色为主。
 */
export function backgroundTarget(light: boolean, density: number, levels: number): number {
  const step = 1 / Math.max(1, levels - 1);
  const d = Math.min(1, Math.max(0, density));
  return light ? 1 - d * step : d * step;
}

/** 蒙版内的亮度按 strength 向目标靠拢；蒙版外原样 */
export function forceBackgroundGray(gray: GrayFrame, mask: Uint8Array, target: number, strength: number): GrayFrame {
  const out = createGray(gray.width, gray.height);
  const s = gray.data;
  const d = out.data;
  const k = Math.min(1, Math.max(0, strength));
  for (let i = 0; i < s.length; i++) d[i] = mask[i] ? s[i] + (target - s[i]) * k : s[i];
  return out;
}

/** 三通道版本：蒙版内换成中性灰 value（与 rgb 同一色彩空间），返回新数组 */
export function forceBackgroundRgb(rgb: Float32Array, mask: Uint8Array, value: number, strength: number): Float32Array {
  const out = new Float32Array(rgb);
  const k = Math.min(1, Math.max(0, strength));
  for (let i = 0, j = 0; i < mask.length; i++, j += 3) {
    if (!mask[i]) continue;
    out[j] += (value - out[j]) * k;
    out[j + 1] += (value - out[j + 1]) * k;
    out[j + 2] += (value - out[j + 2]) * k;
  }
  return out;
}
