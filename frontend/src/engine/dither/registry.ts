import { str, type Params } from '@/params';
import { ERROR_DIFFUSION_ALGORITHMS } from './errorDiffusion';
import { ORDERED_ALGORITHMS } from './ordered';
import { THRESHOLD_ALGORITHMS } from './threshold';
import type { AlgorithmDef, DitherFamily } from './types';

/** 每个算法族用哪个参数选择具体算法 */
export const FAMILY_PARAM: Partial<Record<DitherFamily, string>> = {
  threshold: 'dither.threshold.method',
  ordered: 'dither.ordered.matrix',
  'error-diffusion': 'dither.ed.kernel',
};

export const ALGORITHMS: AlgorithmDef[] = [...THRESHOLD_ALGORITHMS, ...ORDERED_ALGORITHMS, ...ERROR_DIFFUSION_ALGORITHMS];

const byFamily = new Map<string, AlgorithmDef>();
for (const algo of ALGORITHMS) byFamily.set(`${algo.family}/${algo.id}`, algo);

export function findAlgorithm(family: DitherFamily, id: string): AlgorithmDef | undefined {
  return byFamily.get(`${family}/${id}`);
}

/** 按当前参数解析出要执行的算法；未知组合回退到固定阈值 */
export function resolveAlgorithm(params: Params): AlgorithmDef {
  const family = str(params, 'dither.family') as DitherFamily;
  const paramId = FAMILY_PARAM[family];
  const id = paramId ? str(params, paramId) : '';
  return findAlgorithm(family, id) ?? THRESHOLD_ALGORITHMS[0];
}
