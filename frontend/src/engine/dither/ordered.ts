import { num, str } from '@/params';
import type { AlgorithmDef, DitherInput } from './types';
import { mod, rotator, thresholdDither } from './quantize';

export interface ThresholdMatrix {
  size: number;
  /** 归一化阈值 (0, 1)，行主序 */
  data: Float32Array;
}

/** 递归生成 n×n Bayer 矩阵（n 为 2 的幂），返回 0..n²-1 的整数矩阵 */
export function bayerInts(n: number): Int32Array {
  if (n === 1) return new Int32Array([0]);
  const half = bayerInts(n / 2);
  const h = n / 2;
  const out = new Int32Array(n * n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < h; x++) {
      const v = half[y * h + x] * 4;
      out[y * n + x] = v;
      out[y * n + x + h] = v + 2;
      out[(y + h) * n + x] = v + 3;
      out[(y + h) * n + x + h] = v + 1;
    }
  }
  return out;
}

/** 已是 0..n²-1 排列的矩阵直接归一化 */
export function normalizeMatrix(ints: ArrayLike<number>, size: number): ThresholdMatrix {
  const count = size * size;
  const data = new Float32Array(count);
  for (let i = 0; i < count; i++) data[i] = (ints[i] + 0.5) / count;
  return { size, data };
}

/** 任意实数矩阵按秩归一化（相同值按索引先后），得到 0..n²-1 的排列再归一化 */
export function rankMatrix(values: ArrayLike<number>, size: number): ThresholdMatrix {
  const count = size * size;
  const idx = Array.from({ length: count }, (_, i) => i);
  idx.sort((a, b) => values[a] - values[b] || a - b);
  const ranks = new Int32Array(count);
  idx.forEach((i, r) => (ranks[i] = r));
  return normalizeMatrix(ranks, size);
}

/** 经典 4×4 聚簇点 */
const CLUSTER4 = [12, 5, 6, 13, 4, 0, 1, 7, 11, 3, 2, 8, 15, 10, 9, 14];

/** 经典 8×8 聚簇点（两个相位相反的螺旋） */
const CLUSTER8 = [
  24, 10, 12, 26, 35, 47, 49, 37,
  8, 0, 2, 14, 45, 59, 61, 51,
  22, 6, 4, 16, 43, 57, 63, 53,
  30, 20, 18, 28, 33, 41, 55, 39,
  34, 46, 48, 36, 25, 11, 13, 27,
  44, 58, 60, 50, 9, 1, 3, 15,
  42, 56, 62, 52, 23, 7, 5, 17,
  32, 40, 54, 38, 31, 21, 19, 29,
];

/** 圆点：按到单元中心的距离排秩，中心先变暗（ImageMagick c5×5 ~ c7×7 的重建） */
function circleMatrix(n: number): ThresholdMatrix {
  const c = (n - 1) / 2;
  const values = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = x - c;
      const dy = y - c;
      // 距离为主，角度为次，避免同距离的格子按索引成排
      values[y * n + x] = Math.hypot(dx, dy) * 1000 + (Math.atan2(dy, dx) + Math.PI) * 10;
    }
  }
  return rankMatrix(values, n);
}

/** 非矩形：Bayer 4×4 放到 45° 旋转的格点上（菱形晶格） */
function nonRectMatrix(): ThresholdMatrix {
  const base = bayerInts(4);
  const n = 8;
  const values = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = mod(x + y, 4);
      const v = mod(x - y, 4);
      values[y * n + x] = base[u * 4 + v] * 64 + ((x * 5 + y * 3) % 8);
    }
  }
  return rankMatrix(values, n);
}

/** 中心白点：把聚簇点反相，亮点从单元中心长出 */
function centerWhiteMatrix(): ThresholdMatrix {
  return normalizeMatrix(CLUSTER8.map((v) => 63 - v), 8);
}

/** 对角线：沿 45° 条带渐进填充 */
function diagonalMatrix(): ThresholdMatrix {
  const n = 8;
  const b = bayerInts(8);
  const values = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) values[y * n + x] = ((x + y) % n) * 64 + (b[y * n + x] % 8);
  }
  return rankMatrix(values, n);
}

const cache = new Map<string, ThresholdMatrix>();

export function getMatrix(id: string): ThresholdMatrix {
  const hit = cache.get(id);
  if (hit) return hit;
  let m: ThresholdMatrix;
  switch (id) {
    case 'bayer2':
      m = normalizeMatrix(bayerInts(2), 2);
      break;
    case 'bayer3':
      m = normalizeMatrix([0, 7, 3, 6, 5, 2, 4, 1, 8], 3);
      break;
    case 'bayer8':
      m = normalizeMatrix(bayerInts(8), 8);
      break;
    case 'bayer16':
      m = normalizeMatrix(bayerInts(16), 16);
      break;
    case 'bayer32':
      m = normalizeMatrix(bayerInts(32), 32);
      break;
    case 'cluster4':
      m = normalizeMatrix(CLUSTER4, 4);
      break;
    case 'cluster8':
      m = normalizeMatrix(CLUSTER8, 8);
      break;
    case 'nonrect':
      m = nonRectMatrix();
      break;
    case 'centerwhite':
      m = centerWhiteMatrix();
      break;
    case 'diagonal':
      m = diagonalMatrix();
      break;
    case 'circle5':
      m = circleMatrix(5);
      break;
    case 'circle6':
      m = circleMatrix(6);
      break;
    case 'circle7':
      m = circleMatrix(7);
      break;
    case 'bayer4':
    default:
      m = normalizeMatrix(bayerInts(4), 4);
  }
  cache.set(id, m);
  return m;
}

export interface OrderedOptions {
  /** 图案缩放：每个矩阵格子覆盖 scale×scale 像素 */
  scale: number;
  /** 图案角度（度） */
  angle: number;
  offsetX: number;
  offsetY: number;
}

/** 有序阈值场：矩阵按缩放、角度、偏移铺满平面 */
export function orderedField(matrix: ThresholdMatrix, opts: Partial<OrderedOptions> = {}): (x: number, y: number) => number {
  const n = matrix.size;
  const m = matrix.data;
  const s = Math.max(1, opts.scale ?? 1);
  const angle = opts.angle ?? 0;
  const ox = opts.offsetX ?? 0;
  const oy = opts.offsetY ?? 0;
  if (angle === 0) {
    return (x, y) => m[mod(Math.floor((y + oy) / s), n) * n + mod(Math.floor((x + ox) / s), n)];
  }
  const rot = rotator(angle);
  return (x, y) => {
    const [rx, ry] = rot(x + 0.5 + ox, y + 0.5 + oy);
    return m[mod(Math.floor(ry / s), n) * n + mod(Math.floor(rx / s), n)];
  };
}

/** 有序抖动：gray + (m - 0.5) / (levels - 1) 后量化 */
export function orderedDither(input: DitherInput, matrix: ThresholdMatrix, opts: Partial<OrderedOptions> = {}): Uint8Array {
  return thresholdDither(input, orderedField(matrix, opts));
}

function orderedOptions(params: Parameters<AlgorithmDef['run']>[1]): OrderedOptions {
  return {
    scale: num(params, 'dither.ordered.scale'),
    angle: num(params, 'dither.ordered.angle'),
    offsetX: num(params, 'dither.ordered.offsetX'),
    offsetY: num(params, 'dither.ordered.offsetY'),
  };
}

export const ORDERED_MATRICES: Array<{ id: string; label: string }> = [
  { id: 'bayer2', label: 'Bayer 2×2' },
  { id: 'bayer3', label: 'Bayer 3×3' },
  { id: 'bayer4', label: 'Bayer 4×4' },
  { id: 'bayer8', label: 'Bayer 8×8' },
  { id: 'bayer16', label: 'Bayer 16×16' },
  { id: 'bayer32', label: 'Bayer 32×32' },
  { id: 'cluster4', label: '聚簇点 4×4' },
  { id: 'cluster8', label: '聚簇点 8×8' },
  { id: 'nonrect', label: '非矩形' },
  { id: 'centerwhite', label: '中心白点' },
  { id: 'diagonal', label: '对角矩阵' },
  { id: 'circle5', label: '圆点 5×5' },
  { id: 'circle6', label: '圆点 6×6' },
  { id: 'circle7', label: '圆点 7×7' },
];

export const ORDERED_ALGORITHMS: AlgorithmDef[] = ORDERED_MATRICES.map(({ id, label }) => ({
  id,
  family: 'ordered',
  label,
  run: (input, params) => orderedDither(input, getMatrix(str(params, 'dither.ordered.matrix')), orderedOptions(params)),
  field: (params) => ({ field: orderedField(getMatrix(str(params, 'dither.ordered.matrix')), orderedOptions(params)), amplitude: 1 }),
}));
