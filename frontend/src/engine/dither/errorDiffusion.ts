import { bool, num, str } from '@/params';
import { hash2 } from '../util/random';
import type { AlgorithmDef, DitherInput } from './types';
import { levelValue, quantize } from './quantize';

/** 扩散核：taps 为 [dx, dy, weight]，dx 沿扫描方向，dy 为后续行；weight 除以 divisor */
export interface DiffusionKernel {
  id: string;
  label: string;
  divisor: number;
  taps: Array<[number, number, number]>;
}

export const KERNELS: DiffusionKernel[] = [
  { id: 'floyd-steinberg', label: 'Floyd–Steinberg', divisor: 16, taps: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] },
  { id: 'atkinson', label: 'Atkinson', divisor: 8, taps: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] },
  {
    id: 'jjn',
    label: 'Jarvis–Judice–Ninke',
    divisor: 48,
    taps: [[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3], [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]],
  },
  {
    id: 'stucki',
    label: 'Stucki',
    divisor: 42,
    taps: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]],
  },
  { id: 'burkes', label: 'Burkes', divisor: 32, taps: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2]] },
  {
    id: 'sierra3',
    label: 'Sierra（3 行）',
    divisor: 32,
    taps: [[1, 0, 5], [2, 0, 3], [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2], [-1, 2, 2], [0, 2, 3], [1, 2, 2]],
  },
  { id: 'sierra2', label: 'Sierra（2 行）', divisor: 16, taps: [[1, 0, 4], [2, 0, 3], [-2, 1, 1], [-1, 1, 2], [0, 1, 3], [1, 1, 2], [2, 1, 1]] },
  { id: 'sierra-lite', label: 'Sierra Lite', divisor: 4, taps: [[1, 0, 2], [-1, 1, 1], [0, 1, 1]] },
  {
    id: 'stevenson-arce',
    label: 'Stevenson–Arce',
    divisor: 200,
    taps: [[2, 0, 32], [-3, 1, 12], [-1, 1, 26], [1, 1, 30], [3, 1, 16], [-2, 2, 12], [0, 2, 26], [2, 2, 12], [-3, 3, 5], [-1, 3, 12], [1, 3, 12], [3, 3, 5]],
  },
  { id: 'false-fs', label: 'False Floyd–Steinberg', divisor: 8, taps: [[1, 0, 3], [0, 1, 3], [1, 1, 2]] },
  { id: 'shiau-fan', label: 'Shiau–Fan', divisor: 8, taps: [[1, 0, 4], [-3, 1, 1], [-2, 1, 1], [-1, 1, 2]] },
];

/**
 * Ostromoukhov 变系数（2001）。三个抽头：右 (1,0)、左下 (-1,1)、下 (0,1)。
 * 表按输入亮度 0..127 索引，128..255 镜像。前 44 级按论文表重建，其后按论文趋势
 * 从 (4,1,4) 平滑过渡到中灰的 (7,3,5)，未逐项核对（见 DEV_PLAN 第 6 节第 9 条）。
 */
const OSTRO_KEY: Array<[number, number, number]> = [
  [13, 0, 5], [13, 0, 5], [21, 0, 10], [7, 0, 4], [8, 0, 5], [47, 3, 28], [23, 3, 13], [15, 3, 8], [22, 6, 11], [43, 15, 20],
  [7, 3, 3], [501, 224, 211], [249, 116, 103], [165, 80, 67], [123, 62, 49], [489, 256, 191], [81, 44, 31], [483, 272, 181], [60, 35, 22], [53, 32, 19],
  [237, 148, 83], [471, 304, 161], [3, 2, 1], [481, 314, 185], [354, 226, 155], [1389, 866, 685], [227, 138, 125], [267, 158, 163], [327, 188, 220], [61, 34, 45],
  [627, 338, 505], [1227, 638, 1075], [20, 10, 19], [1937, 1000, 1823], [1017, 508, 1029], [68, 33, 71], [187, 88, 200], [1197, 550, 1285], [24, 10, 27], [297, 118, 335],
  [65, 24, 73], [47, 16, 53], [83, 27, 91], [1231, 384, 1235], [4, 1, 4],
];

const OSTRO_TABLE: Float32Array = (() => {
  const table = new Float32Array(128 * 3);
  const norm = (a: number, b: number, c: number): [number, number, number] => {
    const s = a + b + c;
    return [a / s, b / s, c / s];
  };
  for (let i = 0; i < 128; i++) {
    let w: [number, number, number];
    if (i < OSTRO_KEY.length) {
      w = norm(...OSTRO_KEY[i]);
    } else {
      const t = (i - (OSTRO_KEY.length - 1)) / (127 - (OSTRO_KEY.length - 1));
      const a = norm(4, 1, 4);
      const b = norm(7, 3, 5);
      w = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }
    table[i * 3] = w[0];
    table[i * 3 + 1] = w[1];
    table[i * 3 + 2] = w[2];
  }
  return table;
})();

function ostroIndex(v: number): number {
  const l = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
  return l < 128 ? l : 255 - l;
}

export type ScanDirection = 'ltr' | 'rtl' | 'ttb' | 'btt';

export interface DiffusionOptions {
  /** 误差强度 0..1 */
  strength: number;
  /** 蛇形扫描：奇数行反向并镜像核 */
  serpentine: boolean;
  /** 单像素最大误差绝对值（1 = 不截断） */
  clamp: number;
  direction: ScanDirection;
  /** 变系数：按当前像素亮度查 Ostromoukhov 表 */
  variable?: 'ostromoukhov' | 'zhou-fang';
  seed?: number;
}

const DEFAULT_OPTS: DiffusionOptions = { strength: 1, serpentine: true, clamp: 1, direction: 'ltr' };

/** Zhou–Fang 阈值调制强度（按亮度 0..127），近似论文曲线：暗部与 1/4、1/3、1/2 附近较强 */
function zhouFangModulation(idx: number): number {
  const g = (c: number, w: number) => Math.exp(-((idx - c) * (idx - c)) / (2 * w * w));
  return Math.min(0.9, 0.35 * Math.exp(-idx / 30) + 0.25 * g(32, 5) + 0.18 * g(42, 4) + 0.2 * g(64, 6) + 0.12 * g(85, 4));
}

/**
 * 通用误差扩散。扫描方向决定主轴：ltr/rtl 逐行，ttb/btt 逐列；核的 dx 沿主轴、dy 指向后续行（列）。
 */
export function errorDiffuse(input: DitherInput, kernel: DiffusionKernel, options: Partial<DiffusionOptions> = {}): Uint8Array {
  const opts = { ...DEFAULT_OPTS, ...options };
  const { width, height, gray, levels } = input;
  const buf = new Float32Array(gray);
  const out = new Uint8Array(gray.length);
  const taps = kernel.taps.map(([dx, dy, w]) => [dx, dy, (w / kernel.divisor) * opts.strength] as const);
  const vertical = opts.direction === 'ttb' || opts.direction === 'btt';
  const reverseMain = opts.direction === 'rtl' || opts.direction === 'btt';
  const mainLen = vertical ? height : width;
  const crossLen = vertical ? width : height;
  const clampAbs = opts.clamp >= 1 ? Infinity : opts.clamp;
  const variable = opts.variable;
  const seed = opts.seed ?? 1;

  const index = (main: number, cross: number) => (vertical ? main * width + cross : cross * width + main);

  for (let c = 0; c < crossLen; c++) {
    const flip = (opts.serpentine && (c & 1) === 1) !== reverseMain;
    for (let k = 0; k < mainLen; k++) {
      const m = flip ? mainLen - 1 - k : k;
      const i = index(m, c);
      const old = buf[i];
      let q: number;
      if (variable === 'zhou-fang' && levels === 2) {
        const mod = zhouFangModulation(ostroIndex(old));
        const t = 0.5 + (hash2(m, c, seed) - 0.5) * mod;
        q = old >= t ? 1 : 0;
      } else {
        q = quantize(old, levels);
      }
      out[i] = q;
      let err = old - levelValue(q, levels);
      if (err === 0) continue;
      if (err > clampAbs) err = clampAbs;
      else if (err < -clampAbs) err = -clampAbs;

      if (variable) {
        const oi = ostroIndex(old) * 3;
        const wr = OSTRO_TABLE[oi] * opts.strength;
        const wbl = OSTRO_TABLE[oi + 1] * opts.strength;
        const wb = OSTRO_TABLE[oi + 2] * opts.strength;
        const dir = flip ? -1 : 1;
        const mr = m + dir;
        if (mr >= 0 && mr < mainLen) buf[index(mr, c)] += err * wr;
        if (c + 1 < crossLen) {
          const ml = m - dir;
          if (ml >= 0 && ml < mainLen) buf[index(ml, c + 1)] += err * wbl;
          buf[index(m, c + 1)] += err * wb;
        }
        continue;
      }

      for (const [dx, dy, w] of taps) {
        const tm = m + (flip ? -dx : dx);
        const tc = c + dy;
        if (tm < 0 || tm >= mainLen || tc >= crossLen) continue;
        buf[index(tm, tc)] += err * w;
      }
    }
  }
  return out;
}

/**
 * 解析自定义核文本。每行一排，空格分隔，各行按列对齐；X（或 *）标记当前像素，
 * "." 或 0 表示空位；末尾可写 "/N" 指定除数，否则用权重和。例（Floyd–Steinberg）：
 *   . X 7
 *   3 5 1
 */
export function parseCustomKernel(text: string): DiffusionKernel | null {
  const cleaned = text.replace(/[;，]/g, '\n');
  let divisor: number | null = null;
  const lines = cleaned
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => {
      const m = /^\/\s*(\d+(?:\.\d+)?)$/.exec(l);
      if (m) {
        divisor = Number(m[1]);
        return false;
      }
      return true;
    });
  if (lines.length === 0) return null;
  const rows = lines.map((l) => l.split(/[\s,]+/).filter(Boolean));
  let originX = -1;
  const first = rows[0];
  for (let i = 0; i < first.length; i++) {
    if (/^[xX*]$/.test(first[i])) {
      originX = i;
      break;
    }
  }
  if (originX < 0) return null;
  const taps: Array<[number, number, number]> = [];
  let sum = 0;
  rows.forEach((row, dy) => {
    row.forEach((tok, ix) => {
      if (/^[xX*]$/.test(tok)) return;
      const w = Number(tok);
      if (!Number.isFinite(w)) return;
      const dx = ix - originX;
      if (dy === 0 && dx <= 0) return;
      if (w === 0) return;
      taps.push([dx, dy, w]);
      sum += w;
    });
  });
  if (taps.length === 0 || sum <= 0) return null;
  return { id: 'custom', label: '自定义核', divisor: divisor ?? sum, taps };
}

const FS = KERNELS[0];

function readOptions(params: Parameters<AlgorithmDef['run']>[1]): DiffusionOptions {
  return {
    strength: num(params, 'dither.ed.strength') / 100,
    serpentine: bool(params, 'dither.ed.serpentine'),
    clamp: num(params, 'dither.ed.clamp') / 100,
    direction: str(params, 'dither.ed.direction') as ScanDirection,
    seed: Math.round(num(params, 'dither.ed.seed')),
  };
}

export const ERROR_DIFFUSION_ALGORITHMS: AlgorithmDef[] = [
  ...KERNELS.map((kernel) => ({
    id: kernel.id,
    family: 'error-diffusion' as const,
    label: kernel.label,
    run: (input: DitherInput, params: Parameters<AlgorithmDef['run']>[1]) => errorDiffuse(input, kernel, readOptions(params)),
  })),
  {
    id: 'ostromoukhov',
    family: 'error-diffusion',
    label: 'Ostromoukhov',
    run: (input, params) => errorDiffuse(input, FS, { ...readOptions(params), variable: 'ostromoukhov' }),
  },
  {
    id: 'zhou-fang',
    family: 'error-diffusion',
    label: 'Zhou–Fang（变系数）',
    run: (input, params) => errorDiffuse(input, FS, { ...readOptions(params), variable: 'zhou-fang' }),
  },
  {
    id: 'custom',
    family: 'error-diffusion',
    label: '自定义核',
    run: (input, params) => errorDiffuse(input, parseCustomKernel(str(params, 'dither.ed.custom')) ?? FS, readOptions(params)),
  },
];
