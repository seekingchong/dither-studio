import type { ParamValue } from '@/params';
import type { RGBAFrame } from '../types';

export type EffectParamValues = Record<string, ParamValue>;

/** 只在同一实例的另一个参数等于某值（equals）或属于某集合（in）时露出，如模糊半径只在开了模糊时显示 */
export interface EffectVisibleWhen {
  id: string;
  equals?: ParamValue;
  in?: ParamValue[];
}

export interface EffectParamDef {
  id: string;
  label: string;
  /**
   * number / select / boolean 是常规控件；text 是单行文本；color 是 #RRGGBB；
   * colors 是一排色块——值是空格分隔的色值列表，由 `resolve` 展开成实际生效的每一块、`edit` 写回改动；
   * texts 是一排逐块的文本框——值是 JSON 字符串数组，同样由 `resolve` 展开、`edit` 写回；
   * levels 是逐阶开关，值是 '0' / '1' 组成的串（第 i 位是第 i 阶，0 最亮），缺位视为开，阶数取自 countFrom 指的那个参数
   */
  type: 'number' | 'select' | 'boolean' | 'text' | 'color' | 'colors' | 'texts' | 'levels';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: Array<{ value: string; label: string }>;
  default: ParamValue;
  /** 标签上的解读浮层文案；特效子参数不进 PARAM_HELP，写在这里 */
  hint?: string;
  placeholder?: string;
  /** text 的最长字符数，默认 200；texts 是每一块的最长字符数，默认 8 */
  maxLength?: number;
  /** levels 型：阶数取自同一实例里的哪个参数 */
  countFrom?: string;
  /** 一个或多个条件，都满足才露出（如模糊半径只在开了模糊时显示、底色只在「只留描边」时显示） */
  visibleWhen?: EffectVisibleWhen | EffectVisibleWhen[];
  /** colors / texts：按当前实例参数算出实际生效的每一块（配色方案 / 字母串展开到每一块） */
  resolve?: (params: EffectParamValues) => string[];
  /** colors / texts：改第 index 块（色值 / 文字）后要写回的参数补丁 */
  edit?: (params: EffectParamValues, index: number, value: string) => EffectParamValues;
  /** colors / texts：每一块叫什么（默认「第 N 块」） */
  swatchTitle?: (index: number) => string;
  /** colors：在非自定义方案下改色时的提示 */
  editHint?: (params: EffectParamValues) => string | null;
  /** 改这个参数时要一起写回的补丁（如改批量字母时清掉逐块文字）；没有就只写这一个参数 */
  patch?: (params: EffectParamValues, value: ParamValue) => EffectParamValues;
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

/**
 * 当前风格的「格子」在成品里有多大、网格从哪里起。
 * 抖动是像素尺寸的方格，排线是横纵间距，网点 / 符号是网格间距；格子 (i, j) 覆盖像素 x ∈ [i·cellW − offsetX, (i+1)·cellW − offsetX)。
 */
export interface GridUnit {
  cellW: number;
  cellH: number;
  offsetX: number;
  offsetY: number;
}

export const DEFAULT_GRID_UNIT: GridUnit = { cellW: 1, cellH: 1, offsetX: 0, offsetY: 0 };

/** 0–255 的 RGB 三元组 */
export type RGBTriple = [number, number, number];

/** 特效运行时能拿到的上下文：除了当前帧之外的素材；直接调 applyEffects 时可以不给，需要的特效各自回退 */
export interface EffectContext {
  /** 适配到画布尺寸的原图（视频则是当前帧），与成品同尺寸（「叠加原图」用） */
  source?: RGBAFrame;
  /**
   * 当前风格的底色（纸）与主墨色：抖动是最亮 / 最暗那一级（反向时对调），排线 / 网点 / 符号是各自的纸色与墨色。
   * 「叠加原图」靠它们分出成品里哪些像素是背景、哪些是前景，把原图垫在两者之间。
   */
  paper?: RGBTriple;
  ink?: RGBTriple;
  /** 风格量化前的明暗分布（「灰度块描边」用） */
  tone?: ToneMap;
  /** 当前风格的格子（「叠加随机方块」按它对齐、以它为单位）；没有就按 1px 方格 */
  grid?: GridUnit;
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
