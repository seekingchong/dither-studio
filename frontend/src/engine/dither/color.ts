import { num } from '@/params';
import type { Params } from '@/params';
import { readRiemersmaOptions, riemersmaWeights } from './curve';
import { curveOrder, type CurveType } from './curves';
import { DOT_NEIGHBORS, classMatrixFor, type ClassMatrix } from './dotDiffusion';
import { kernelFor, ostroWeights, readDiffusionOptions, type DiffusionKernel, type DiffusionOptions } from './errorDiffusion';
import type { AlgorithmDef, ColorDitherInput } from './types';

/**
 * 真彩调色板量化路径。输出每个像素的调色板索引（调色板已按亮度升序）。
 * 阈值场类：c + (m - 0.5) × 扩散幅度后取最近色；
 * 误差扩散 / 曲线 / 点扩散：三通道误差；其余算法无颜色路径，流水线回退到亮度路径。
 */

export function thresholdDitherColor(input: ColorDitherInput, field: (x: number, y: number) => number, amplitude: number): Uint8Array {
  const { width, height, rgb, palette } = input;
  const out = new Uint8Array(width * height);
  const spread = amplitude * palette.lumGap;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const d = (field(x, y) - 0.5) * spread;
      const j = i * 3;
      out[i] = palette.nearest(rgb[j] + d, rgb[j + 1] + d, rgb[j + 2] + d);
    }
  }
  return out;
}

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export function errorDiffuseColor(input: ColorDitherInput, kernel: DiffusionKernel, opts: DiffusionOptions): Uint8Array {
  const { width, height, rgb, palette } = input;
  const buf = new Float32Array(rgb);
  const out = new Uint8Array(width * height);
  const taps = kernel.taps.map(([dx, dy, w]) => [dx, dy, (w / kernel.divisor) * opts.strength] as const);
  const vertical = opts.direction === 'ttb' || opts.direction === 'btt';
  const reverseMain = opts.direction === 'rtl' || opts.direction === 'btt';
  const mainLen = vertical ? height : width;
  const crossLen = vertical ? width : height;
  const clampAbs = opts.clamp >= 1 ? Infinity : opts.clamp;
  const colors = palette.colors;
  const index = (main: number, cross: number) => (vertical ? main * width + cross : cross * width + main);
  const clampErr = (e: number) => (e > clampAbs ? clampAbs : e < -clampAbs ? -clampAbs : e);

  for (let c = 0; c < crossLen; c++) {
    const flip = (opts.serpentine && (c & 1) === 1) !== reverseMain;
    for (let k = 0; k < mainLen; k++) {
      const m = flip ? mainLen - 1 - k : k;
      const i = index(m, c);
      const j = i * 3;
      const r = buf[j];
      const g = buf[j + 1];
      const b = buf[j + 2];
      const q = palette.nearest(r, g, b);
      out[i] = q;
      const er = clampErr(r - colors[q * 3]);
      const eg = clampErr(g - colors[q * 3 + 1]);
      const eb = clampErr(b - colors[q * 3 + 2]);
      if (er === 0 && eg === 0 && eb === 0) continue;
      const add = (mm: number, cc: number, w: number) => {
        if (mm < 0 || mm >= mainLen || cc < 0 || cc >= crossLen) return;
        const t = index(mm, cc) * 3;
        buf[t] += er * w;
        buf[t + 1] += eg * w;
        buf[t + 2] += eb * w;
      };
      if (opts.variable) {
        const [wr, wbl, wb] = ostroWeights(luma(r, g, b));
        const dir = flip ? -1 : 1;
        add(m + dir, c, wr * opts.strength);
        add(m - dir, c + 1, wbl * opts.strength);
        add(m, c + 1, wb * opts.strength);
        continue;
      }
      for (const [dx, dy, w] of taps) add(m + (flip ? -dx : dx), c + dy, w);
    }
  }
  return out;
}

export function riemersmaColor(input: ColorDitherInput, order: Int32Array, weights: Float32Array): Uint8Array {
  const { rgb, palette } = input;
  const n = weights.length;
  const errors = new Float32Array(n * 3);
  let head = 0;
  const out = new Uint8Array(rgb.length / 3);
  const colors = palette.colors;
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    let ar = 0;
    let ag = 0;
    let ab = 0;
    for (let s = 0; s < n; s++) {
      const e = ((head - s + n) % n) * 3;
      const w = weights[s];
      ar += w * errors[e];
      ag += w * errors[e + 1];
      ab += w * errors[e + 2];
    }
    const j = i * 3;
    const r = rgb[j] + ar;
    const g = rgb[j + 1] + ag;
    const b = rgb[j + 2] + ab;
    const q = palette.nearest(r, g, b);
    out[i] = q;
    head = (head + 1) % n;
    errors[head * 3] = r - colors[q * 3];
    errors[head * 3 + 1] = g - colors[q * 3 + 1];
    errors[head * 3 + 2] = b - colors[q * 3 + 2];
  }
  return out;
}

export function dotDiffuseColor(input: ColorDitherInput, matrix: ClassMatrix, strength: number): Uint8Array {
  const { width, height, rgb, palette } = input;
  const n = matrix.size;
  const buf = new Float32Array(rgb);
  const out = new Uint8Array(width * height);
  const count = n * n;
  const positions: Array<[number, number]> = new Array(count);
  for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) positions[matrix.classes[cy * n + cx]] = [cx, cy];
  const classAt = (x: number, y: number) => matrix.classes[(((y % n) + n) % n) * n + (((x % n) + n) % n)];
  const colors = palette.colors;

  for (let c = 0; c < count; c++) {
    const [cx, cy] = positions[c];
    for (let y = cy; y < height; y += n) {
      for (let x = cx; x < width; x += n) {
        const i = y * width + x;
        const j = i * 3;
        const q = palette.nearest(buf[j], buf[j + 1], buf[j + 2]);
        out[i] = q;
        const er = (buf[j] - colors[q * 3]) * strength;
        const eg = (buf[j + 1] - colors[q * 3 + 1]) * strength;
        const eb = (buf[j + 2] - colors[q * 3 + 2]) * strength;
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
          if (classAt(nx, ny) > c) {
            const t = (ny * width + nx) * 3;
            const f = w / wsum;
            buf[t] += er * f;
            buf[t + 1] += eg * f;
            buf[t + 2] += eb * f;
          }
        }
      }
    }
  }
  return out;
}

/** 按算法选择颜色路径；返回 null 表示该算法只有亮度路径 */
export function colorDither(algo: AlgorithmDef, input: ColorDitherInput, params: Params): Uint8Array | null {
  if (algo.runColor) return algo.runColor(input, params);
  if (algo.field) {
    const f = algo.field(params, input.width, input.height);
    return thresholdDitherColor(input, f.field, f.amplitude);
  }
  switch (algo.family) {
    case 'error-diffusion': {
      const { kernel, variable } = kernelFor(algo.id, params);
      return errorDiffuseColor(input, kernel, { ...readDiffusionOptions(params), variable });
    }
    case 'curve':
      return riemersmaColor(input, curveOrder(algo.id as CurveType, input.width, input.height), riemersmaWeights(readRiemersmaOptions(params)));
    case 'search':
      if (algo.id === 'dbs') return null;
      return dotDiffuseColor(input, classMatrixFor(algo.id), num(params, 'dither.search.strength') / 100);
    default:
      return null;
  }
}
