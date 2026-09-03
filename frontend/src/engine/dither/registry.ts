import { str, type Params } from '@/params';
import { CURVE_ALGORITHMS } from './curve';
import { DBS_ALGORITHMS } from './dbs';
import { DOT_DIFFUSION_ALGORITHMS } from './dotDiffusion';
import { ERROR_DIFFUSION_ALGORITHMS } from './errorDiffusion';
import { HALFTONE_ALGORITHMS } from './halftone';
import { NOISE_ALGORITHMS } from './noise';
import { ORDERED_ALGORITHMS } from './ordered';
import { PATTERN_ALGORITHMS } from './pattern';
import { THRESHOLD_ALGORITHMS } from './threshold';
import type { AlgorithmDef, DitherFamily } from './types';

/** 每个算法族用哪个参数选择具体算法 */
export const FAMILY_PARAM: Record<DitherFamily, string> = {
  threshold: 'dither.threshold.method',
  noise: 'dither.noise.type',
  ordered: 'dither.ordered.matrix',
  halftone: 'dither.halftone.shape',
  'error-diffusion': 'dither.ed.kernel',
  curve: 'dither.curve.type',
  search: 'dither.search.method',
  pattern: 'dither.pattern.type',
};

export const ALGORITHMS: AlgorithmDef[] = [
  ...THRESHOLD_ALGORITHMS,
  ...NOISE_ALGORITHMS,
  ...ORDERED_ALGORITHMS,
  ...HALFTONE_ALGORITHMS,
  ...ERROR_DIFFUSION_ALGORITHMS,
  ...CURVE_ALGORITHMS,
  ...DOT_DIFFUSION_ALGORITHMS,
  ...DBS_ALGORITHMS,
  ...PATTERN_ALGORITHMS,
];

const byFamily = new Map<string, AlgorithmDef>();
for (const algo of ALGORITHMS) byFamily.set(`${algo.family}/${algo.id}`, algo);

export function findAlgorithm(family: DitherFamily, id: string): AlgorithmDef | undefined {
  return byFamily.get(`${family}/${id}`);
}

export function algorithmsOf(family: DitherFamily): AlgorithmDef[] {
  return ALGORITHMS.filter((a) => a.family === family);
}

/** 按当前参数解析出要执行的算法；未知组合回退到固定阈值 */
export function resolveAlgorithm(params: Params): AlgorithmDef {
  const family = str(params, 'dither.family') as DitherFamily;
  const paramId = FAMILY_PARAM[family];
  const id = paramId ? str(params, paramId) : '';
  return findAlgorithm(family, id) ?? THRESHOLD_ALGORITHMS[0];
}
