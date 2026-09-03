import { num, str } from '@/params';
import { curveOrder, type CurveType } from './curves';
import { levelValue, quantize } from './quantize';
import type { AlgorithmDef, DitherInput } from './types';

export interface RiemersmaOptions {
  /** 记住最近多少个误差 */
  history: number;
  /** 最新与最旧误差的权重比 */
  ratio: number;
  strength: number;
}

/**
 * Riemersma 抖动：沿曲线扫描，把最近 N 个像素的误差按指数衰减权重加到当前像素。
 * 权重归一化到和为 1，等价于每个像素的误差完整分给后续 N 个像素。
 */
export function riemersmaDither(input: DitherInput, order: Int32Array, opts: RiemersmaOptions): Uint8Array {
  const { gray, levels } = input;
  const n = Math.max(1, Math.round(opts.history));
  const ratio = Math.max(1, opts.ratio);
  const weights = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    weights[i] = n === 1 ? 1 : Math.exp((-Math.log(ratio) * i) / (n - 1));
    sum += weights[i];
  }
  for (let i = 0; i < n; i++) weights[i] = (weights[i] / sum) * opts.strength;

  const errors = new Float32Array(n);
  let head = 0;
  const out = new Uint8Array(gray.length);
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    let acc = 0;
    for (let j = 0; j < n; j++) acc += weights[j] * errors[(head - j + n) % n];
    const v = gray[i] + acc;
    const q = quantize(v, levels);
    out[i] = q;
    head = (head + 1) % n;
    errors[head] = v - levelValue(q, levels);
  }
  return out;
}

export function readRiemersmaOptions(params: Parameters<AlgorithmDef['run']>[1]): RiemersmaOptions {
  return {
    history: num(params, 'dither.curve.history'),
    ratio: num(params, 'dither.curve.ratio'),
    strength: num(params, 'dither.curve.strength') / 100,
  };
}

/** 归一化的指数衰减权重（含强度） */
export function riemersmaWeights(opts: RiemersmaOptions): Float32Array {
  const n = Math.max(1, Math.round(opts.history));
  const ratio = Math.max(1, opts.ratio);
  const weights = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    weights[i] = n === 1 ? 1 : Math.exp((-Math.log(ratio) * i) / (n - 1));
    sum += weights[i];
  }
  for (let i = 0; i < n; i++) weights[i] = (weights[i] / sum) * opts.strength;
  return weights;
}

export const CURVE_TYPES: Array<{ id: CurveType; label: string }> = [
  { id: 'hilbert', label: 'Riemersma（Hilbert）' },
  { id: 'peano', label: 'Peano 曲线' },
  { id: 'gosper', label: 'Gosper 曲线' },
  { id: 'fass', label: 'FASS 曲线' },
];

export const CURVE_ALGORITHMS: AlgorithmDef[] = CURVE_TYPES.map(({ id, label }) => ({
  id,
  family: 'curve',
  label,
  run: (input, params) =>
    riemersmaDither(input, curveOrder(str(params, 'dither.curve.type') as CurveType, input.width, input.height), readRiemersmaOptions(params)),
}));
