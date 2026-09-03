export type ParamValue = number | string | boolean;

export type ParamGroup = 'canvas' | 'pixel' | 'tone' | 'dither' | 'color' | 'grid' | 'effects';

export interface ParamOption {
  value: string;
  label: string;
}

/** 可见性条件：目标参数等于某值或属于某集合 */
export interface VisibleWhen {
  id: string;
  equals?: ParamValue;
  in?: ParamValue[];
}

interface ParamBase {
  id: string;
  group: ParamGroup;
  label: string;
  /** 面板里的说明，可省略 */
  hint?: string;
  visibleWhen?: VisibleWhen | VisibleWhen[];
  /** 折叠在"更多"里，默认不露出 */
  advanced?: boolean;
}

export interface NumberParam extends ParamBase {
  type: 'number';
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
}

export interface SelectParam extends ParamBase {
  type: 'select';
  options: ParamOption[];
  default: string;
}

export interface BooleanParam extends ParamBase {
  type: 'boolean';
  default: boolean;
}

export interface ColorParam extends ParamBase {
  type: 'color';
  /** #RRGGBB */
  default: string;
}

export type ParamDef = NumberParam | SelectParam | BooleanParam | ColorParam;

export type Params = Record<string, ParamValue>;
