import { bool, num, str } from '@/params';
import { fract, rotator, thresholdDither } from './quantize';
import type { AlgorithmDef, DitherInput } from './types';

/** 网点函数：单元内坐标 u, v ∈ [-1, 1]，返回 0..1，1 为网点中心（最先变暗） */
export type SpotFunction = (u: number, v: number) => number;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const SPOT_FUNCTIONS: Record<string, SpotFunction> = {
  round: (u, v) => clamp01(1 - (u * u + v * v)),
  // PostScript Euclidean composite：半调 50% 处圆点与反圆点交接，避免棋盘断裂
  euclidean: (u, v) => {
    const au = Math.abs(u);
    const av = Math.abs(v);
    const s = au + av > 1 ? (au - 1) * (au - 1) + (av - 1) * (av - 1) - 1 : 1 - (u * u + v * v);
    return clamp01((s + 1) / 2);
  },
  line: (_u, v) => clamp01(1 - Math.abs(v)),
  diamond: (u, v) => clamp01(1 - (Math.abs(u) + Math.abs(v)) / 2),
  cosine: (u, v) => clamp01((Math.cos(Math.PI * u) + Math.cos(Math.PI * v) + 2) / 4),
  square: (u, v) => clamp01(1 - Math.max(Math.abs(u), Math.abs(v))),
  ellipse: (u, v) => clamp01(1 - (0.6 * u * u + 1.4 * v * v) / 2),
  cross: (u, v) => clamp01(1 - Math.min(Math.abs(u), Math.abs(v))),
  star: (u, v) => {
    const r = Math.sqrt(Math.abs(u)) + Math.sqrt(Math.abs(v));
    return clamp01(1 - r / 2);
  },
};

export interface HalftoneOptions {
  shape: string;
  /** 网点周期（像素） */
  period: number;
  /** 网线角度（度） */
  angle: number;
  /** 网点增益 -1..1 */
  gain: number;
  /** 融合度 0..1：相邻网点像 metaball 一样粘连 */
  gooey: number;
  invert: boolean;
}

/** 六边形网格：最近的六边形中心，返回归一化距离 0（中心）..1（顶点） */
function hexDistance(x: number, y: number, period: number): number {
  const rowH = period * 0.8660254;
  const row = Math.floor(y / rowH);
  let best = Infinity;
  for (let r = row - 1; r <= row + 1; r++) {
    const cy = (r + 0.5) * rowH;
    const shift = (r & 1) === 0 ? 0 : period / 2;
    const col = Math.floor((x - shift) / period);
    for (let c = col - 1; c <= col + 1; c++) {
      const cx = (c + 0.5) * period + shift;
      const d = Math.hypot(x - cx, y - cy);
      if (d < best) best = d;
    }
  }
  return Math.min(1, best / (period / 1.7320508));
}

/** 方格网格上相邻网点中心的软化叠加，用于 gooey */
function blobField(fx: number, fy: number, spot: SpotFunction): number {
  // fx, fy 为单元坐标（浮点），中心在整数 + 0.5
  const cx = Math.floor(fx);
  const cy = Math.floor(fy);
  let sum = 0;
  for (let j = cy - 1; j <= cy + 1; j++) {
    for (let i = cx - 1; i <= cx + 1; i++) {
      const du = (fx - (i + 0.5)) * 2;
      const dv = (fy - (j + 0.5)) * 2;
      if (Math.abs(du) >= 2 || Math.abs(dv) >= 2) continue;
      const s = spot(du / 1.5, dv / 1.5);
      sum += s * s;
    }
  }
  return Math.min(1, Math.sqrt(sum));
}

export function halftoneDither(input: DitherInput, opts: HalftoneOptions): Uint8Array {
  const period = Math.max(2, opts.period);
  const rot = rotator(-opts.angle);
  const gamma = Math.exp(-opts.gain * 1.5);
  const gooey = Math.min(1, Math.max(0, opts.gooey));
  const spot = SPOT_FUNCTIONS[opts.shape];

  const field = (x: number, y: number): number => {
    const [rx, ry] = rot(x + 0.5, y + 0.5);
    let s: number;
    if (opts.shape === 'hexagon') {
      s = 1 - hexDistance(rx, ry, period);
    } else {
      const fx = rx / period;
      const fy = ry / period;
      const u = fract(fx) * 2 - 1;
      const v = fract(fy) * 2 - 1;
      s = spot(u, v);
      if (gooey > 0) s = s * (1 - gooey) + blobField(fx, fy, spot) * gooey;
    }
    s = Math.pow(clamp01(s), gamma);
    return opts.invert ? s : 1 - s;
  };
  return thresholdDither(input, field);
}

export const HALFTONE_SHAPES: Array<{ id: string; label: string }> = [
  { id: 'round', label: '圆点' },
  { id: 'euclidean', label: '欧几里得' },
  { id: 'line', label: '线' },
  { id: 'diamond', label: '菱形' },
  { id: 'cosine', label: '余弦' },
  { id: 'square', label: '方' },
  { id: 'ellipse', label: '椭圆' },
  { id: 'cross', label: '十字' },
  { id: 'star', label: '星形' },
  { id: 'hexagon', label: '六边形网格' },
];

export const HALFTONE_ALGORITHMS: AlgorithmDef[] = HALFTONE_SHAPES.map(({ id, label }) => ({
  id,
  family: 'halftone',
  label,
  run: (input, params) =>
    halftoneDither(input, {
      shape: str(params, 'dither.halftone.shape'),
      period: num(params, 'dither.halftone.period'),
      angle: num(params, 'dither.halftone.angle'),
      gain: num(params, 'dither.halftone.gain') / 100,
      gooey: num(params, 'dither.halftone.gooey') / 100,
      invert: bool(params, 'dither.halftone.invert'),
    }),
}));
