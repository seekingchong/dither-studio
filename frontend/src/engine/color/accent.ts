import { BLUE_NOISE_SIZE, blueNoise128 } from '../dither/bluenoise128';
import { quantize } from '../dither/quantize';
import { sobelMagnitude } from '../preprocess/filters';
import type { CellFrame } from '../types';
import { hash2 } from '../util/random';
import { hexToRgb } from './srgb';

export type AccentPlacement = 'random' | 'bluenoise' | 'level' | 'overflow' | 'edge';
export type AccentTarget = 'foreground' | 'background' | 'all';

export interface AccentColor {
  rgb: [number, number, number];
  weight: number;
}

export interface AccentOptions {
  enabled: boolean;
  colors: AccentColor[];
  /** 被替换像素比例 0..1 */
  density: number;
  placement: AccentPlacement;
  /** 仅某灰阶档：目标等级索引 */
  level: number;
  target: AccentTarget;
  /** 最小间距（格子） */
  spacing: number;
  /** 连锁概率 0..1：放下一个强调点后继续向右延伸 */
  chain: number;
  seed: number;
}

/** 强调层需要的量化上下文 */
export interface AccentContext {
  width: number;
  height: number;
  /** 每个格子的等级（或按亮度排序的调色板索引） */
  levels: Uint8Array;
  levelCount: number;
  /** 量化前的亮度（含偏置），用于溢出与边缘判定 */
  gray: Float32Array;
}

/** 解析 "#RRGGBB:权重" 列表，权重省略为 1，最多 6 色 */
export function parseAccentColors(text: string): AccentColor[] {
  const out: AccentColor[] = [];
  for (const tok of text.split(/[\s,;，；]+/)) {
    if (!tok) continue;
    const [hex, w] = tok.split(':');
    const m = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(hex);
    if (!m) continue;
    const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
    const weight = Number(w);
    out.push({ rgb: hexToRgb(`#${h}`), weight: Number.isFinite(weight) && weight > 0 ? weight : 1 });
    if (out.length >= 6) break;
  }
  return out;
}

/** 在已着色的格子上叠加强调色层 */
export function applyAccent(cells: CellFrame, ctx: AccentContext, opts: AccentOptions): CellFrame {
  if (!opts.enabled || opts.colors.length === 0 || opts.density <= 0) return cells;
  const { width, height, levels, levelCount, gray } = ctx;
  const out = new Uint8ClampedArray(cells.data);
  const seed = opts.seed;
  const placed = new Uint8Array(width * height);
  const spacing = Math.max(0, Math.round(opts.spacing));
  const totalWeight = opts.colors.reduce((s, c) => s + c.weight, 0);

  const half = levelCount / 2;
  const eligible = (i: number): boolean => {
    switch (opts.target) {
      case 'foreground':
        return levels[i] < half;
      case 'background':
        return levels[i] >= half;
      default:
        return true;
    }
  };

  let candidate: (x: number, y: number, i: number) => boolean;
  switch (opts.placement) {
    case 'bluenoise': {
      const tex = blueNoise128();
      const n = BLUE_NOISE_SIZE;
      candidate = (x, y) => (tex[(y % n) * n + (x % n)] + 0.5) / 256 < opts.density;
      break;
    }
    case 'level':
      candidate = (x, y, i) => levels[i] === opts.level && hash2(x, y, seed) < opts.density;
      break;
    case 'overflow':
      // 抖动改变了朴素量化结果的格子：误差"溢出"的位置
      candidate = (x, y, i) => quantize(gray[i], levelCount) !== levels[i] && hash2(x, y, seed) < opts.density;
      break;
    case 'edge': {
      const mag = sobelMagnitude(gray, width, height);
      candidate = (x, y, i) => mag[i] > 0.6 && hash2(x, y, seed) < opts.density;
      break;
    }
    case 'random':
    default:
      candidate = (x, y) => hash2(x, y, seed) < opts.density;
  }

  const tooClose = (x: number, y: number): boolean => {
    if (spacing === 0) return false;
    for (let dy = -spacing; dy <= spacing; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= height) continue;
      for (let dx = -spacing; dx <= spacing; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= width) continue;
        if (placed[yy * width + xx]) return true;
      }
    }
    return false;
  };

  const pickColor = (x: number, y: number): [number, number, number] => {
    let r = hash2(x, y, seed + 2) * totalWeight;
    for (const c of opts.colors) {
      r -= c.weight;
      if (r <= 0) return c.rgb;
    }
    return opts.colors[opts.colors.length - 1].rgb;
  };

  const paint = (x: number, y: number, i: number) => {
    const [r, g, b] = pickColor(x, y);
    const j = i * 4;
    out[j] = r;
    out[j + 1] = g;
    out[j + 2] = b;
    placed[i] = 1;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (placed[i] || !eligible(i) || !candidate(x, y, i) || tooClose(x, y)) continue;
      paint(x, y, i);
      // 连锁：向右延伸成短线
      let cx = x + 1;
      let run = 0;
      while (cx < width && run < 6 && hash2(cx, y, seed + 1) < opts.chain) {
        const ci = y * width + cx;
        if (!eligible(ci) || placed[ci]) break;
        paint(cx, y, ci);
        cx++;
        run++;
      }
    }
  }
  return { width, height, data: out };
}
