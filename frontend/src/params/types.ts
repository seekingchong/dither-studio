export type ParamValue = number | string | boolean;

/**
 * 参数分组。style 只有一个参数（风格），dither / pixel / color / grid 是 Dither 风格专属，
 * halftone / screen / ink 是 Halftone 风格专属，canvas / tone / effects 两种风格共用。
 */
export type ParamGroup = 'style' | 'canvas' | 'pixel' | 'tone' | 'dither' | 'color' | 'grid' | 'effects' | 'halftone' | 'screen' | 'ink';

/** 两种艺术风格：抖动（Dither）与网点（Halftone），在左栏以页签切换 */
export type StyleKind = 'dither' | 'halftone';

export interface ParamOption {
  value: string;
  label: string;
}

/** 可见性条件：目标参数等于某值、属于某集合，或大于某数 */
export interface VisibleWhen {
  id: string;
  equals?: ParamValue;
  in?: ParamValue[];
  gt?: number;
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

export interface TextParam extends ParamBase {
  type: 'text';
  default: string;
  multiline?: boolean;
  placeholder?: string;
}

/** 特效栈：值是实例列表的 JSON 字符串，由专用编辑器维护 */
export interface EffectsParam extends ParamBase {
  type: 'effects';
  default: string;
}

export type ParamDef = NumberParam | SelectParam | BooleanParam | ColorParam | TextParam | EffectsParam;

export type Params = Record<string, ParamValue>;
