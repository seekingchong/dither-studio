import { createPerlin, hash2 } from '../util/random';

/**
 * 网格扰动：把每颗网点从它格子的中心推开一点，规则网格就成了一张被水波推歪的网。
 * 位移是一个平滑的向量场（涟漪 / 波浪 / 流动）或每点独立的随机量（随机），
 * 单位是"格"——强度 1 就是最多挪一格，换间距不用重调；采样、光栅、SVG 都用同一份位移。
 * 位移只挪点的位置，不改点的大小与形状。
 */

export type WarpKind = 'none' | 'ripple' | 'wave' | 'noise' | 'jitter';

export interface WarpSettings {
  warp: WarpKind;
  /** 最大位移，占格距 0..1 */
  warpAmount: number;
  /** 波长 / 噪声尺度，单位是格 */
  warpScale: number;
  warpSeed: number;
}

export interface WarpField {
  /** 每格沿网格 x / y 轴的位移，单位是格 */
  dx: Float32Array;
  dy: Float32Array;
  /** 最大 |位移|（格），渲染据此多看几圈邻格 */
  max: number;
}

/** 涟漪的波源个数、波浪的波数：三处圆形波源叠出来的干涉弧线最像海报那种 */
const RIPPLE_SOURCES = 3;
const WAVE_COUNT = 2;
/** 2D Perlin 的幅值大约在 ±0.7 */
const PERLIN_RANGE = 0.7;

const clamp1 = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);

/**
 * 算一张网格的位移场。`cells` 是网格范围（格下标从 i0 / j0 起），`shiftOf(j)` 给交错排列的半格错位。
 * 波源位置、波的方向与相位都由种子决定；同一种子在画布变大时已有格子的位移不变（用绝对格坐标算）。
 */
export function buildWarp(cells: { cols: number; rows: number; i0: number; j0: number }, shiftOf: (j: number) => number, opts: WarpSettings): WarpField | undefined {
  if (opts.warp === 'none' || opts.warpAmount <= 0) return undefined;
  const { cols, rows, i0, j0 } = cells;
  const n = cols * rows;
  const dx = new Float32Array(n);
  const dy = new Float32Array(n);
  const A = opts.warpAmount;
  const scale = Math.max(1, opts.warpScale);
  const seed = opts.warpSeed;
  const field = makeField(opts.warp, cells, scale, seed);
  let max = 0;
  for (let jj = 0; jj < rows; jj++) {
    const j = j0 + jj;
    const gv = j + 0.5;
    const shift = shiftOf(j);
    for (let ii = 0; ii < cols; ii++) {
      const i = i0 + ii;
      const [fx, fy] = field(i + 0.5 + shift, gv, i, j);
      const k = jj * cols + ii;
      const ox = A * clamp1(fx);
      const oy = A * clamp1(fy);
      dx[k] = ox;
      dy[k] = oy;
      const m = Math.max(Math.abs(ox), Math.abs(oy));
      if (m > max) max = m;
    }
  }
  return { dx, dy, max };
}

type Field = (gu: number, gv: number, i: number, j: number) => [number, number];

/** 各种扰动的单位场（分量在 -1..1 之间），乘上强度就是位移 */
function makeField(kind: WarpKind, cells: { cols: number; rows: number; i0: number; j0: number }, scale: number, seed: number): Field {
  switch (kind) {
    case 'ripple': {
      // 几处波源分布在网格范围里，每处一圈圈往外的圆形波，位移沿径向；叠加后再除以波源数，总位移不超过强度
      const sources: Array<{ x: number; y: number; lambda: number; phase: number }> = [];
      for (let s = 0; s < RIPPLE_SOURCES; s++) {
        sources.push({
          x: cells.i0 + hash2(s, 1, seed) * cells.cols,
          y: cells.j0 + hash2(s, 2, seed) * cells.rows,
          lambda: scale * (0.8 + 0.4 * hash2(s, 3, seed)),
          phase: hash2(s, 4, seed) * Math.PI * 2,
        });
      }
      const inv = 1 / RIPPLE_SOURCES;
      return (gu, gv) => {
        let fx = 0;
        let fy = 0;
        for (const s of sources) {
          const rx = gu - s.x;
          const ry = gv - s.y;
          const r = Math.sqrt(rx * rx + ry * ry);
          if (r < 1e-6) continue;
          const w = Math.sin((Math.PI * 2 * r) / s.lambda + s.phase);
          fx += (w * rx) / r;
          fy += (w * ry) / r;
        }
        return [fx * inv, fy * inv];
      };
    }
    case 'wave': {
      // 几道方向不同的平面波，位移沿波的传播方向（疏密波），叠起来是斜着的干涉条纹
      const waves: Array<{ cx: number; cy: number; lambda: number; phase: number }> = [];
      for (let s = 0; s < WAVE_COUNT; s++) {
        const theta = hash2(s, 1, seed) * Math.PI;
        waves.push({ cx: Math.cos(theta), cy: Math.sin(theta), lambda: scale * (0.85 + 0.3 * hash2(s, 2, seed)), phase: hash2(s, 3, seed) * Math.PI * 2 });
      }
      const inv = 1 / WAVE_COUNT;
      return (gu, gv) => {
        let fx = 0;
        let fy = 0;
        for (const w of waves) {
          const s = Math.sin((Math.PI * 2 * (gu * w.cx + gv * w.cy)) / w.lambda + w.phase);
          fx += s * w.cx;
          fy += s * w.cy;
        }
        return [fx * inv, fy * inv];
      };
    }
    case 'noise': {
      // 两张 Perlin 噪声当 x / y 分量，网点跟着一股平滑的流走
      const px = createPerlin(seed);
      const py = createPerlin(seed + 7919);
      const inv = 1 / PERLIN_RANGE;
      return (gu, gv) => [px(gu / scale, gv / scale) * inv, py(gu / scale + 31.7, gv / scale + 17.3) * inv];
    }
    case 'jitter':
      // 每颗点独立的均匀随机位移，与邻居无关
      return (_gu, _gv, i, j) => [hash2(i, j, seed) * 2 - 1, hash2(i, j, seed + 4099) * 2 - 1];
    default:
      return () => [0, 0];
  }
}
