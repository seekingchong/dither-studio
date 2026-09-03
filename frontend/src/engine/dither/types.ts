import type { Params } from '@/params';

export type DitherFamily = 'threshold' | 'noise' | 'ordered' | 'halftone' | 'error-diffusion' | 'curve' | 'search' | 'pattern';

/** 抖动阶段的输入：已加阈值偏置的亮度，取值可略超出 0..1 */
export interface DitherInput {
  width: number;
  height: number;
  gray: Float32Array;
  /** 量化级数（1-bit 为 2） */
  levels: number;
  /** 随机种子，确定性算法忽略 */
  seed: number;
}

export interface AlgorithmDef {
  /** 全局唯一 id，与参数 schema 中对应族的选项值一致 */
  id: string;
  family: DitherFamily;
  label: string;
  /** 输出每个格子的灰阶索引 0..levels-1 */
  run(input: DitherInput, params: Params): Uint8Array;
}
