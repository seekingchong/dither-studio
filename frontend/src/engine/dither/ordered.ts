import { num, str } from '@/params';
import type { AlgorithmDef, DitherInput } from './types';
import { quantize } from './quantize';

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

export function normalizeMatrix(ints: ArrayLike<number>, size: number): ThresholdMatrix {
  const count = size * size;
  const data = new Float32Array(count);
  for (let i = 0; i < count; i++) data[i] = (ints[i] + 0.5) / count;
  return { size, data };
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
    case 'bayer4':
    default:
      m = normalizeMatrix(bayerInts(4), 4);
  }
  cache.set(id, m);
  return m;
}

/** 有序抖动：gray + (m - 0.5) / (levels - 1) 后量化 */
export function orderedDither(input: DitherInput, matrix: ThresholdMatrix, scale = 1): Uint8Array {
  const { width, height, gray, levels } = input;
  const out = new Uint8Array(gray.length);
  const n = matrix.size;
  const m = matrix.data;
  const amp = 1 / (levels - 1);
  const s = Math.max(1, Math.floor(scale));
  for (let y = 0; y < height; y++) {
    const my = Math.floor(y / s) % n;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const mx = Math.floor(x / s) % n;
      out[row + x] = quantize(gray[row + x] + (m[my * n + mx] - 0.5) * amp, levels);
    }
  }
  return out;
}

const MATRIX_IDS = ['bayer2', 'bayer3', 'bayer4', 'bayer8', 'bayer16', 'bayer32'] as const;

export const ORDERED_ALGORITHMS: AlgorithmDef[] = MATRIX_IDS.map((id) => ({
  id,
  family: 'ordered',
  label: id,
  run: (input, params) => orderedDither(input, getMatrix(str(params, 'dither.ordered.matrix')), num(params, 'dither.ordered.scale')),
}));
