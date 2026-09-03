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
}

export interface EffectDef {
  id: string;
  label: string;
  hint?: string;
  params: EffectParamDef[];
  apply(frame: RGBAFrame, params: EffectParamValues): RGBAFrame;
}

/** 栈里的一个实例 */
export interface EffectInstance {
  type: string;
  enabled: boolean;
  params: EffectParamValues;
}
