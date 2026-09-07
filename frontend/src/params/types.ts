export type ParamValue = number | string | boolean;

export type ParamGroup = 'style' | 'canvas' | 'pixel' | 'tone' | 'dither' | 'color' | 'grid' | 'effects' | 'hatch' | 'halftone' | 'screen' | 'ink' | 'glyph' | 'tile';

/**
 * 艺术风格：抖动（现有整条抖动流水线）、排线（斜线粗细表现明暗）、网点（规则网格上按明暗放大缩小的点）
 * 或符号（同样的网格，但用格子里画的形状区分明暗）
 */
export type StyleKind = 'dither' | 'hatch' | 'halftone' | 'glyph';

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
  /** 由专用编辑器渲染（如符号风格每一阶的形状与颜色），不在参数栅格里单独出现 */
  custom?: boolean;
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
