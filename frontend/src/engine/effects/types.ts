import type { ParamValue } from '@/params';
import type { RGBAFrame } from '../types';

export type EffectParamValues = Record<string, ParamValue>;

export interface EffectParamDef {
  id: string;
  label: string;
  /**
   * color：#RRGGBB；
   * levels：逐阶开关，值是 '0' / '1' 组成的串（第 i 位是第 i 阶，0 最亮），缺位视为开，阶数取自 countFrom 指的那个参数
   */
  type: 'number' | 'select' | 'boolean' | 'color' | 'levels';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: Array<{ value: string; label: string }>;
  /** levels 型：阶数取自同一实例里的哪个参数 */
  countFrom?: string;
  /** 只在同一实例的某个参数等于某值时露出 */
  visibleWhen?: { id: string; equals: ParamValue };
  default: ParamValue;
}

/** 风格自己怎么分阶：round 是四舍五入到最近一级（抖动、网点分级），floor 是等宽分档（排线、符号） */
export type ToneBins = 'round' | 'floor';

/**
 * 风格量化前的明暗分布：按格子分辨率的亮度，附带格子到画布像素的映射。
 * 「灰度块描边」这类要认格子的特效靠它把线画在格子边上，而不是抖动出来的噪点边上。
 */
export interface ToneMap {
  width: number;
  height: number;
  /** 每格亮度 0..1 */
  gray: Float32Array;
  /** 格子 (i, j) 覆盖画布像素 x ∈ [originX + i*cellW, originX + (i+1)*cellW)，y 同理 */
  cellW: number;
  cellH: number;
  originX: number;
  originY: number;
  bins: ToneBins;
}

/** 流水线交给特效阶段的上下文；直接调 applyEffects 时可以不给，特效各自回退 */
export interface EffectContext {
  tone?: ToneMap;
}

export interface EffectDef {
  id: string;
  label: string;
  hint?: string;
  params: EffectParamDef[];
  /** 添加到栈里时按当前参数给的初始值（如描边的阶数跟随风格的灰阶数），之后仍按定义收敛 */
  init?(params: Record<string, ParamValue>): Partial<EffectParamValues>;
  apply(frame: RGBAFrame, params: EffectParamValues, ctx?: EffectContext): RGBAFrame;
}

/** 栈里的一个实例 */
export interface EffectInstance {
  type: string;
  enabled: boolean;
  params: EffectParamValues;
}
