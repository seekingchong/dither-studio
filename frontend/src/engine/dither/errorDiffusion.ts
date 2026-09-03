import { bool, num } from '@/params';
import type { AlgorithmDef, DitherInput } from './types';
import { levelValue, quantize } from './quantize';

/** 扩散核：taps 为 [dx, dy, weight]，weight 除以 divisor */
export interface DiffusionKernel {
  id: string;
  label: string;
  divisor: number;
  taps: Array<[number, number, number]>;
}

export const KERNELS: DiffusionKernel[] = [
  {
    id: 'floyd-steinberg',
    label: 'Floyd–Steinberg',
    divisor: 16,
    taps: [
      [1, 0, 7],
      [-1, 1, 3],
      [0, 1, 5],
      [1, 1, 1],
    ],
  },
];

export interface DiffusionOptions {
  /** 误差强度 0..1 */
  strength: number;
  /** 蛇形扫描：奇数行反向并镜像核 */
  serpentine: boolean;
}

export function errorDiffuse(input: DitherInput, kernel: DiffusionKernel, opts: DiffusionOptions): Uint8Array {
  const { width, height, gray, levels } = input;
  const buf = new Float32Array(gray);
  const out = new Uint8Array(gray.length);
  const taps = kernel.taps.map(([dx, dy, w]) => [dx, dy, (w / kernel.divisor) * opts.strength] as const);

  for (let y = 0; y < height; y++) {
    const reverse = opts.serpentine && (y & 1) === 1;
    const row = y * width;
    for (let k = 0; k < width; k++) {
      const x = reverse ? width - 1 - k : k;
      const i = row + x;
      const old = buf[i];
      const q = quantize(old, levels);
      out[i] = q;
      const err = old - levelValue(q, levels);
      if (err === 0) continue;
      for (const [dx, dy, w] of taps) {
        const tx = x + (reverse ? -dx : dx);
        const ty = y + dy;
        if (tx < 0 || tx >= width || ty >= height) continue;
        buf[ty * width + tx] += err * w;
      }
    }
  }
  return out;
}

export const ERROR_DIFFUSION_ALGORITHMS: AlgorithmDef[] = KERNELS.map((kernel) => ({
  id: kernel.id,
  family: 'error-diffusion',
  label: kernel.label,
  run: (input, params) =>
    errorDiffuse(input, kernel, {
      strength: num(params, 'dither.ed.strength') / 100,
      serpentine: bool(params, 'dither.ed.serpentine'),
    }),
}));
