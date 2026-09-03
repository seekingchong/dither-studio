import { num } from '@/params';
import { bayerInts } from './ordered';
import { levelValue, quantize } from './quantize';
import type { AlgorithmDef, DitherInput } from './types';

/** Knuth 1987 的 8×8 类矩阵 */
const KNUTH_CLASS = [
  34, 48, 40, 32, 29, 15, 23, 31,
  42, 58, 56, 53, 21, 5, 7, 10,
  50, 62, 61, 45, 13, 1, 2, 18,
  38, 46, 54, 37, 25, 9, 17, 27,
  28, 14, 22, 30, 35, 49, 41, 33,
  20, 4, 6, 11, 43, 59, 57, 52,
  12, 0, 3, 19, 51, 63, 60, 44,
  26, 8, 16, 24, 39, 47, 55, 36,
];

export interface ClassMatrix {
  size: number;
  classes: Int32Array;
}

export function classMatrixFor(id: string): ClassMatrix {
  return id === 'lippens' ? lippensMatrix() : knuthMatrix();
}

function knuthMatrix(): ClassMatrix {
  return { size: 8, classes: Int32Array.from(KNUTH_CLASS) };
}

/** Lippens–Philips 变体：用更大的分散类矩阵（Bayer 16×16 的秩）减少 8×8 网格伪影 */
function lippensMatrix(): ClassMatrix {
  return { size: 16, classes: bayerInts(16) };
}

export const DOT_NEIGHBORS: Array<[number, number, number]> = [
  [1, 0, 2], [-1, 0, 2], [0, 1, 2], [0, -1, 2],
  [1, 1, 1], [-1, 1, 1], [1, -1, 1], [-1, -1, 1],
];

/** 点扩散：按类矩阵顺序处理像素，误差只扩散给类号更大的邻居（正交权 2、对角权 1） */
export function dotDiffuse(input: DitherInput, matrix: ClassMatrix, strength = 1): Uint8Array {
  const { width, height, gray, levels } = input;
  const n = matrix.size;
  const buf = new Float32Array(gray);
  const out = new Uint8Array(gray.length);
  const count = n * n;
  // 按类号排序的单元内位置
  const positions: Array<[number, number]> = new Array(count);
  for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) positions[matrix.classes[cy * n + cx]] = [cx, cy];
  const classAt = (x: number, y: number) => matrix.classes[(((y % n) + n) % n) * n + (((x % n) + n) % n)];

  for (let c = 0; c < count; c++) {
    const [cx, cy] = positions[c];
    for (let y = cy; y < height; y += n) {
      for (let x = cx; x < width; x += n) {
        const i = y * width + x;
        const old = buf[i];
        const q = quantize(old, levels);
        out[i] = q;
        const err = (old - levelValue(q, levels)) * strength;
        if (err === 0) continue;
        let wsum = 0;
        for (const [dx, dy, w] of DOT_NEIGHBORS) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (classAt(nx, ny) > c) wsum += w;
        }
        if (wsum === 0) continue;
        for (const [dx, dy, w] of DOT_NEIGHBORS) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (classAt(nx, ny) > c) buf[ny * width + nx] += (err * w) / wsum;
        }
      }
    }
  }
  return out;
}

export const DOT_DIFFUSION_ALGORITHMS: AlgorithmDef[] = [
  {
    id: 'knuth',
    family: 'search',
    label: '点扩散（Knuth）',
    run: (input, params) => dotDiffuse(input, knuthMatrix(), num(params, 'dither.search.strength') / 100),
  },
  {
    id: 'lippens',
    family: 'search',
    label: '点扩散（Lippens）',
    run: (input, params) => dotDiffuse(input, lippensMatrix(), num(params, 'dither.search.strength') / 100),
  },
];

export function isDotDiffusion(id: string): boolean {
  return id === 'knuth' || id === 'lippens';
}

