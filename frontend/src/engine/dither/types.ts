import type { Params } from '@/params';
import type { Palette } from '../color/palettes';

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

/** 真彩调色板量化的输入：三通道 sRGB 0..1 与目标调色板 */
export interface ColorDitherInput {
  width: number;
  height: number;
  rgb: Float32Array;
  palette: Palette;
  seed: number;
}

/** 阈值场：每个像素一个 0..1 的阈值，越小越早变暗；amplitude 为扩散幅度倍率 */
export interface ThresholdField {
  field: (x: number, y: number) => number;
  amplitude: number;
}

export interface AlgorithmDef {
  /** 全局唯一 id，与参数 schema 中对应族的选项值一致 */
  id: string;
  family: DitherFamily;
  label: string;
  /** 输出每个格子的灰阶索引 0..levels-1 */
  run(input: DitherInput, params: Params): Uint8Array;
  /** 阈值场类算法暴露场函数，供真彩量化复用 */
  field?(params: Params, width: number, height: number): ThresholdField;
  /** 真彩调色板量化：输出调色板索引（按亮度升序） */
  runColor?(input: ColorDitherInput, params: Params): Uint8Array;
}
