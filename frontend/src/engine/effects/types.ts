import type { ParamValue } from '@/params';
import type { RGBAFrame } from '../types';

export type EffectParamValues = Record<string, ParamValue>;

export interface EffectParamDef {
  id: string;
  label: string;
  type: 'number' | 'select' | 'boolean';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: Array<{ value: string; label: string }>;
  default: ParamValue;
  /** 只在同一实例的另一个参数等于某值时露出（如模糊半径只在开了模糊时显示） */
  visibleWhen?: { id: string; equals: ParamValue };
}

/** 特效运行时能拿到的上下文：除了当前帧之外的素材 */
export interface EffectContext {
  /** 适配到画布尺寸的原图（视频则是当前帧），与成品同尺寸；单独调用特效时可以没有 */
  source?: RGBAFrame;
}

export interface EffectDef {
  id: string;
  label: string;
  hint?: string;
  params: EffectParamDef[];
  apply(frame: RGBAFrame, params: EffectParamValues, ctx?: EffectContext): RGBAFrame;
}

/** 栈里的一个实例 */
export interface EffectInstance {
  type: string;
  enabled: boolean;
  params: EffectParamValues;
}
