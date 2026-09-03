import { num } from '@/params';
import { KERNELS, errorDiffuse } from './errorDiffusion';
import type { AlgorithmDef, DitherInput } from './types';

export interface DbsOptions {
  iterations: number;
  /** 视觉模型高斯滤波 σ（像素） */
  sigma: number;
}

/**
 * 直接二值搜索（Lieberman & Allebach 的高效实现）：
 * 以 Floyd–Steinberg 结果起步，反复尝试翻转像素或与 8 邻交换，
 * 只要感知误差 ||h ⊛ (b - g)||² 下降就接受。用滤波器自相关 cpp 与误差互相关 cpe 做 O(1) 评估。
 */
export function dbsDither(input: DitherInput, opts: DbsOptions): Uint8Array {
  const { width, height, gray } = input;
  const n = width * height;
  const sigma = Math.max(0.5, opts.sigma);
  const r = Math.ceil(sigma * 3);
  const size = 2 * r + 1;
  const filter = new Float32Array(size * size);
  let fs = 0;
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const v = Math.exp(-(x * x + y * y) / (2 * sigma * sigma));
      filter[(y + r) * size + x + r] = v;
      fs += v;
    }
  }
  for (let i = 0; i < filter.length; i++) filter[i] /= fs;

  // 自相关 cpp，半径 2r
  const R = 2 * r;
  const S = 2 * R + 1;
  const cpp = new Float32Array(S * S);
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      let s = 0;
      for (let y = -r; y <= r; y++) {
        const yy = y + dy;
        if (yy < -r || yy > r) continue;
        for (let x = -r; x <= r; x++) {
          const xx = x + dx;
          if (xx < -r || xx > r) continue;
          s += filter[(y + r) * size + x + r] * filter[(yy + r) * size + xx + r];
        }
      }
      cpp[(dy + R) * S + dx + R] = s;
    }
  }
  const cpp0 = cpp[R * S + R];

  const target = new Float32Array(n);
  for (let i = 0; i < n; i++) target[i] = gray[i] < 0 ? 0 : gray[i] > 1 ? 1 : gray[i];
  const b = errorDiffuse({ ...input, gray: target }, KERNELS[0], { strength: 1, serpentine: true, clamp: 1, direction: 'ltr' });

  // cpe = cpp ⊛ e，e = b - g
  const cpe = new Float32Array(n);
  const addCpp = (x0: number, y0: number, a: number) => {
    for (let dy = -R; dy <= R; dy++) {
      const y = y0 + dy;
      if (y < 0 || y >= height) continue;
      const row = y * width;
      const crow = (dy + R) * S + R;
      for (let dx = -R; dx <= R; dx++) {
        const x = x0 + dx;
        if (x < 0 || x >= width) continue;
        cpe[row + x] += a * cpp[crow + dx];
      }
    }
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const e = b[y * width + x] - target[y * width + x];
      if (e !== 0) addCpp(x, y, e);
    }
  }

  const NB: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  const iterations = Math.max(1, Math.round(opts.iterations));
  for (let it = 0; it < iterations; it++) {
    let changed = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const a = b[i] === 1 ? -1 : 1; // 翻转方向
        let bestDelta = a * a * cpp0 + 2 * a * cpe[i];
        let bestMode = -1; // -1 翻转，0..7 交换
        for (let k = 0; k < NB.length; k++) {
          const nx = x + NB[k][0];
          const ny = y + NB[k][1];
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = ny * width + nx;
          if (b[j] === b[i]) continue;
          const cppMN = cpp[(NB[k][1] + R) * S + NB[k][0] + R];
          const delta = 2 * cpp0 - 2 * cppMN + 2 * a * (cpe[i] - cpe[j]);
          if (delta < bestDelta) {
            bestDelta = delta;
            bestMode = k;
          }
        }
        if (bestDelta >= -1e-9) continue;
        changed++;
        b[i] = b[i] === 1 ? 0 : 1;
        addCpp(x, y, a);
        if (bestMode >= 0) {
          const nx = x + NB[bestMode][0];
          const ny = y + NB[bestMode][1];
          const j = ny * width + nx;
          b[j] = b[j] === 1 ? 0 : 1;
          addCpp(nx, ny, -a);
        }
      }
    }
    if (changed === 0) break;
  }
  return b;
}

export const DBS_ALGORITHMS: AlgorithmDef[] = [
  {
    id: 'dbs',
    family: 'search',
    label: 'DBS（直接二值搜索）',
    run: (input, params) => {
      if (input.levels !== 2) {
        return errorDiffuse(input, KERNELS[0], { strength: 1, serpentine: true, clamp: 1, direction: 'ltr' });
      }
      return dbsDither(input, { iterations: num(params, 'dither.search.iterations'), sigma: num(params, 'dither.search.sigma') });
    },
  },
];
