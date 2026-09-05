import { FAMILY_PARAM, type DitherFamily } from '@/engine';
import {
  DITHER_FAMILIES,
  GROUP_STYLE,
  PARAM_SCHEMA,
  defaultParams,
  getParamDef,
  hasParam,
  sanitizeParams,
  styleOf,
  type ParamDef,
  type ParamGroup,
  type Params,
  type StyleKind,
} from '@/params';

/**
 * 预设 = 一整套方案。用户先选一套预设，参数面板只列出这套方案"具备"的参数供微调，
 * 调好后可存成自己的预设（记住来源预设，沿用它的参数范围）。
 */
export interface BuiltinPreset {
  id: string;
  name: string;
  hint: string;
  /** 相对默认值的覆盖 */
  params: Partial<Params>;
  /** 这套方案具备的参数：分组 id（整组）或单个参数 id。不在其中的参数不在面板里出现 */
  exposes: readonly string[];
}

export interface UserPreset {
  id: string;
  name: string;
  params: Params;
  createdAt: number;
  /** 最近一次用当前参数覆盖的时间 */
  updatedAt?: number;
  /** 来源内置预设 id，决定参数面板露出哪些参数；缺省按「默认」处理 */
  base?: string;
  /** 保存时的结果缩略图（PNG data URL），没有媒体时缺省 */
  thumbnail?: string;
}

const effects = (stack: unknown[]) => JSON.stringify(stack);

export const DEFAULT_PRESET_ID = 'default';
/** 排线风格的「默认」：切到排线页签时预设模块的「重置」退回这一套 */
export const HATCH_DEFAULT_PRESET_ID = 'hatch-classic';
/** 网点风格的「默认」 */
export const HALFTONE_DEFAULT_PRESET_ID = 'halftone-default';

export const ALL_GROUPS: readonly ParamGroup[] = ['style', 'pixel', 'tone', 'dither', 'color', 'hatch', 'halftone', 'screen', 'ink', 'canvas', 'grid', 'effects'];
/**
 * 大多数风格预设具备的分组：像素化、影调、算法自身参数、颜色、排线、画布尺寸。
 * 抖动与排线的分组都在里面——两种风格的参数本来就按页签互斥显示，一起露出才能在任一预设上切换页签。
 */
const CORE: readonly ParamGroup[] = ['style', 'pixel', 'tone', 'dither', 'color', 'hatch', 'canvas'];
/** 网点预设一律露出自己的全部分组：参数本来就不多，藏起来反而找不到；影调 / 画布 / 特效共用 */
const HT: readonly ParamGroup[] = ['style', 'halftone', 'screen', 'ink', 'tone', 'canvas', 'effects'];

/** 内置预设：一键风格。参数是相对默认值的覆盖。第一项「默认」就是全部默认值、全部参数可调。 */
export const BUILTIN_PRESETS: BuiltinPreset[] = [
  {
    id: DEFAULT_PRESET_ID,
    name: '默认',
    hint: 'Bayer 2×2 1-bit，全参数可调',
    params: {},
    exposes: ALL_GROUPS,
  },
  {
    id: 'gameboy',
    name: 'Game Boy',
    hint: 'Bayer 4×4 + 四级绿',
    params: { 'dither.family': 'ordered', 'dither.ordered.matrix': 'bayer4', 'pixel.size': 4, 'color.mode': 'palette', 'color.palette.preset': 'gameboy', 'tone.contrast': 15 },
    exposes: CORE,
  },
  {
    id: 'mac-classic',
    name: 'Mac Classic',
    hint: 'Atkinson 1-bit',
    params: { 'dither.family': 'error-diffusion', 'dither.ed.kernel': 'atkinson', 'pixel.size': 2, 'color.mode': 'palette', 'color.palette.preset': 'mac', 'tone.linear': false },
    exposes: CORE,
  },
  {
    id: 'newspaper',
    name: 'Newspaper',
    hint: '45° 圆点半调，报纸双色',
    params: {
      'dither.family': 'halftone',
      'dither.halftone.shape': 'round',
      'dither.halftone.period': 6,
      'dither.halftone.angle': 45,
      'pixel.size': 1,
      'color.mode': 'tint',
      'color.tint.dark': '#2B2B2B',
      'color.tint.light': '#F2EBDD',
      'tone.contrast': 10,
    },
    exposes: CORE,
  },
  {
    id: 'crt',
    name: 'CRT',
    hint: 'RGB 分通道 + 扫描线荧光',
    params: {
      'dither.family': 'ordered',
      'dither.ordered.matrix': 'bayer8',
      'pixel.size': 3,
      'color.mode': 'channels',
      'color.channels.space': 'rgb',
      'color.levels': 3,
      'effects.stack': effects([{ type: 'scanlines', enabled: true, params: { period: 3, darkness: 45, phosphor: 40, curvature: 25 } }]),
    },
    exposes: [...CORE, 'effects'],
  },
  {
    id: 'blueprint',
    name: 'Blueprint',
    hint: '蓝底白线，反相 + 描边',
    params: {
      'dither.family': 'noise',
      'dither.noise.type': 'blue',
      'pixel.size': 2,
      'color.mode': 'tint',
      'color.tint.dark': '#0D3B8C',
      'color.tint.light': '#DCE8FF',
      'tone.invert': true,
      'tone.outline': 60,
      'tone.outlineThreshold': 15,
    },
    exposes: CORE,
  },
  {
    id: 'risograph',
    name: 'Risograph',
    hint: '蓝噪声 + 专色三色 + 颗粒',
    params: {
      'dither.family': 'noise',
      'dither.noise.type': 'blue',
      'dither.noise.amplitude': 120,
      'pixel.size': 2,
      'color.mode': 'palette',
      'color.palette.preset': 'custom',
      'color.palette.custom': '#F7F1E1 #FF6A4D #0078BF #1D1D3A',
      'effects.stack': effects([{ type: 'grain', enabled: true, params: { amount: 25, size: 1, color: false, seed: 1 } }]),
    },
    exposes: [...CORE, 'effects'],
  },
  {
    id: 'obra-dinn',
    name: 'Obra Dinn',
    hint: '蓝噪声 1-bit，墨蓝配米白',
    params: {
      'dither.family': 'noise',
      'dither.noise.type': 'blue',
      'pixel.size': 2,
      'color.mode': 'tint',
      'color.tint.dark': '#1C1D2A',
      'color.tint.light': '#E6E2C6',
      'tone.contrast': 25,
      'tone.sharpen': 30,
      'tone.linear': false,
    },
    exposes: CORE,
  },
  {
    id: 'pico-pixel',
    name: 'Pixel Art',
    hint: 'Bayer 8×8 + PICO-8 十六色',
    params: { 'dither.family': 'ordered', 'dither.ordered.matrix': 'bayer8', 'pixel.size': 6, 'color.mode': 'palette', 'color.palette.preset': 'pico8', 'tone.saturation': 20 },
    exposes: CORE,
  },
  {
    id: 'zine',
    name: 'Zine',
    hint: 'Floyd–Steinberg 黑白 + 颗粒',
    params: {
      'dither.family': 'error-diffusion',
      'dither.ed.kernel': 'floyd-steinberg',
      'pixel.size': 2,
      'color.mode': 'mono',
      'tone.contrast': 30,
      'effects.stack': effects([{ type: 'grain', enabled: true, params: { amount: 20, size: 2, color: false, seed: 1 } }]),
    },
    exposes: [...CORE, 'effects'],
  },
  {
    id: 'dot-matrix',
    name: 'Dot Matrix',
    hint: 'Stucki + 融合圆点',
    params: {
      'dither.family': 'error-diffusion',
      'dither.ed.kernel': 'stucki',
      'pixel.size': 8,
      'grid.dot': 'euclidean',
      'grid.metaball': true,
      'grid.metaballRadius': 130,
      'color.mode': 'tint',
      'color.tint.dark': '#11192D',
      'color.tint.light': '#FFFFFF',
    },
    exposes: [...CORE, 'grid'],
  },

  // ---------- 排线 ----------
  // schema 默认值就是「Hatching」这一套：45° 斜线、14px 方格、6 档粗细、灰底黑线
  {
    id: HATCH_DEFAULT_PRESET_ID,
    name: 'Hatching',
    hint: '45° 斜线，越暗越粗，灰底黑线',
    params: { 'style.type': 'hatch' },
    exposes: ALL_GROUPS,
  },
  {
    id: 'hatch-pencil',
    name: 'Pencil',
    hint: '细密 60° 圆头排线，铅笔素描',
    params: {
      'style.type': 'hatch',
      'hatch.angle': 60,
      'hatch.spacingX': 8,
      'hatch.spacingY': 8,
      'hatch.levels': 8,
      'hatch.length': 95,
      'hatch.maxWidth': 55,
      'hatch.minWidth': 6,
      'hatch.roundness': 100,
      'hatch.ink': '#3A3A3A',
      'hatch.paper': '#F4F1EA',
      'tone.contrast': 10,
    },
    exposes: CORE,
  },
  {
    id: 'hatch-engraving',
    name: 'Engraving',
    hint: '连续线条粗细起伏，铜版画',
    params: {
      'style.type': 'hatch',
      'hatch.angle': 45,
      'hatch.spacingX': 9,
      'hatch.spacingY': 9,
      'hatch.levels': 10,
      'hatch.length': 100,
      'hatch.maxWidth': 100,
      'hatch.minWidth': 0,
      'hatch.roundness': 0,
      'hatch.link': 'stroke',
      'hatch.linkWidth': 1,
      'hatch.linkColor': '#1A1A1A',
      'hatch.ink': '#1A1A1A',
      'hatch.paper': '#FFFFFF',
    },
    exposes: CORE,
  },
  {
    id: 'hatch-crosshatch',
    name: 'Crosshatch',
    hint: '暗部叠一层垂直线，交叉排线',
    params: {
      'style.type': 'hatch',
      'hatch.angle': 45,
      'hatch.spacingX': 10,
      'hatch.spacingY': 10,
      'hatch.levels': 8,
      'hatch.length': 100,
      'hatch.maxWidth': 45,
      'hatch.minWidth': 8,
      'hatch.roundness': 100,
      'hatch.cross': true,
      'hatch.crossStart': 45,
      'hatch.ink': '#222222',
      'hatch.paper': '#F7F4EC',
    },
    exposes: CORE,
  },
  {
    id: 'hatch-woodcut',
    name: 'Woodcut',
    hint: '三档方头粗线，木刻版画',
    params: {
      'style.type': 'hatch',
      'hatch.angle': 30,
      'hatch.spacingX': 16,
      'hatch.spacingY': 16,
      'hatch.levels': 3,
      'hatch.length': 100,
      'hatch.maxWidth': 110,
      'hatch.minWidth': 0,
      'hatch.roundness': 0,
      'hatch.ink': '#141414',
      'hatch.paper': '#EFE6D3',
      'tone.contrast': 25,
    },
    exposes: CORE,
  },
  {
    id: 'hatch-rain',
    name: 'Rain',
    hint: '竖向圆头短划，细雨',
    params: {
      'style.type': 'hatch',
      'hatch.angle': 90,
      'hatch.spacingX': 7,
      'hatch.spacingY': 16,
      'hatch.levels': 6,
      'hatch.length': 70,
      'hatch.maxWidth': 75,
      'hatch.minWidth': 0,
      'hatch.roundness': 100,
      'hatch.ink': '#1E2A44',
      'hatch.paper': '#E9EEF5',
    },
    exposes: CORE,
  },
  {
    id: 'hatch-beads',
    name: 'Beads',
    hint: '短笔画串在横线上，珠串',
    params: {
      'style.type': 'hatch',
      'hatch.angle': 45,
      'hatch.spacingX': 14,
      'hatch.spacingY': 14,
      'hatch.levels': 5,
      'hatch.length': 50,
      'hatch.maxWidth': 90,
      'hatch.minWidth': 20,
      'hatch.roundness': 100,
      'hatch.link': 'row',
      'hatch.linkWidth': 1,
      'hatch.linkColor': '#A0A0A0',
      'hatch.ink': '#202020',
      'hatch.paper': '#E4E4E4',
    },
    exposes: CORE,
  },
  {
    id: 'hatch-blueprint',
    name: 'Blueprint Lines',
    hint: '蓝底白线，反相排线',
    params: {
      'style.type': 'hatch',
      'hatch.angle': 45,
      'hatch.spacingX': 10,
      'hatch.spacingY': 10,
      'hatch.levels': 6,
      'hatch.length': 90,
      'hatch.maxWidth': 60,
      'hatch.minWidth': 5,
      'hatch.roundness': 20,
      'hatch.ink': '#DCE8FF',
      'hatch.paper': '#0D3B8C',
      'tone.invert': true,
    },
    exposes: CORE,
  },
  {
    id: 'hatch-brick',
    name: 'Brick',
    hint: '横向短划错行排布，砖纹',
    params: {
      'style.type': 'hatch',
      'hatch.angle': 0,
      'hatch.spacingX': 12,
      'hatch.spacingY': 8,
      'hatch.stagger': 50,
      'hatch.levels': 6,
      'hatch.length': 85,
      'hatch.maxWidth': 70,
      'hatch.minWidth': 10,
      'hatch.roundness': 100,
      'hatch.ink': '#2B2B2B',
      'hatch.paper': '#EDE7DC',
    },
    exposes: CORE,
  },

  // ---------- 网点 ----------
  // schema 默认值就是这一套：圆点 12px 方格、墨色配白纸、背景留 10% 的小点
  {
    id: HALFTONE_DEFAULT_PRESET_ID,
    name: '默认',
    hint: '圆点 12px 方格，墨色配白纸',
    params: { 'style.type': 'halftone' },
    exposes: HT,
  },
  {
    id: 'ht-poster',
    name: 'Poster',
    hint: '海报红圆点，分 8 档，背景留细点',
    params: {
      'style.type': 'halftone',
      'halftone.shape': 'circle',
      'halftone.size': 105,
      'halftone.minSize': 12,
      'halftone.stepped': true,
      'halftone.levels': 8,
      'screen.pitchX': 14,
      'screen.pitchY': 14,
      'screen.angle': 0,
      'ink.dot': '#E4002B',
      'ink.paper': '#F5F3EE',
      'tone.contrast': 15,
    },
    exposes: HT,
  },
  {
    id: 'ht-newsprint',
    name: 'Newsprint',
    hint: '45° 细圆点，报纸油墨配新闻纸',
    params: {
      'style.type': 'halftone',
      'halftone.shape': 'circle',
      'halftone.size': 100,
      'halftone.minSize': 0,
      'halftone.mapping': 'area',
      'screen.pitchX': 7,
      'screen.pitchY': 7,
      'screen.angle': 45,
      'ink.dot': '#1F1B18',
      'ink.paper': '#EDE6D6',
      'tone.contrast': 10,
    },
    exposes: HT,
  },
  {
    id: 'ht-comic',
    name: 'Comic',
    hint: 'Ben-Day 圆点四档，漫画红配米白',
    params: {
      'style.type': 'halftone',
      'halftone.shape': 'circle',
      'halftone.size': 90,
      'halftone.minSize': 18,
      'halftone.stepped': true,
      'halftone.levels': 4,
      'halftone.mapping': 'linear',
      'screen.pitchX': 9,
      'screen.pitchY': 9,
      'screen.angle': 30,
      'ink.dot': '#D7263D',
      'ink.paper': '#FFF6E5',
      'tone.contrast': 20,
    },
    exposes: HT,
  },
  {
    id: 'ht-cmyk',
    name: 'CMYK Print',
    hint: '青品黄黑四层网点按印刷角度叠印',
    params: {
      'style.type': 'halftone',
      'ink.mode': 'cmyk',
      'halftone.shape': 'circle',
      'halftone.size': 100,
      'halftone.minSize': 0,
      'screen.pitchX': 10,
      'screen.pitchY': 10,
      'screen.angle': 0,
      'ink.paper': '#FFFFFF',
      'tone.saturation': 15,
    },
    exposes: HT,
  },
  {
    id: 'ht-blob',
    name: 'Ink Blob',
    hint: '大圆点带融合，暗处的点粘成墨团',
    params: {
      'style.type': 'halftone',
      'halftone.shape': 'circle',
      'halftone.size': 100,
      'halftone.minSize': 6,
      'halftone.mapping': 'linear',
      'halftone.merge': 50,
      'screen.pitchX': 16,
      'screen.pitchY': 16,
      'screen.angle': 0,
      'ink.dot': '#11192D',
      'ink.paper': '#F9F9F9',
    },
    exposes: HT,
  },
  {
    id: 'ht-lines',
    name: 'Line Screen',
    hint: '粗细随明暗的线网，像铜版雕刻',
    params: {
      'style.type': 'halftone',
      'halftone.shape': 'line',
      'halftone.size': 100,
      'halftone.minSize': 8,
      'halftone.mapping': 'linear',
      'screen.pitchX': 4,
      'screen.pitchY': 7,
      'screen.angle': 20,
      'ink.dot': '#1B1B1B',
      'ink.paper': '#FFFFFF',
      'tone.contrast': 10,
    },
    exposes: HT,
  },
  {
    id: 'ht-mosaic',
    name: 'Mosaic',
    hint: '圆角方块六档，蓝色数码马赛克',
    params: {
      'style.type': 'halftone',
      'halftone.shape': 'roundsquare',
      'halftone.size': 90,
      'halftone.minSize': 20,
      'halftone.stepped': true,
      'halftone.levels': 6,
      'screen.pitchX': 12,
      'screen.pitchY': 12,
      'screen.angle': 0,
      'ink.dot': '#005BBB',
      'ink.paper': '#F4F7FB',
    },
    exposes: HT,
  },
  {
    id: 'ht-triangles',
    name: 'Triangles',
    hint: '交错三角，米白点配墨蓝底',
    params: {
      'style.type': 'halftone',
      'halftone.shape': 'triangle',
      'halftone.size': 100,
      'halftone.minSize': 10,
      'screen.lattice': 'hex',
      'screen.pitchX': 12,
      'screen.pitchY': 11,
      'screen.angle': 0,
      'ink.dot': '#F4F1EA',
      'ink.paper': '#11192D',
      'tone.invert': true,
    },
    exposes: HT,
  },
  {
    id: 'ht-color-dots',
    name: 'Color Dots',
    hint: '每颗点取原图颜色，交错排列像灯珠',
    params: {
      'style.type': 'halftone',
      'ink.mode': 'source',
      'halftone.shape': 'circle',
      'halftone.size': 100,
      'halftone.minSize': 30,
      'screen.lattice': 'hex',
      'screen.pitchX': 12,
      'screen.pitchY': 10,
      'screen.angle': 0,
      'ink.paper': '#FFFFFF',
      'tone.saturation': 20,
    },
    exposes: HT,
  },
  {
    id: 'ht-honeycomb',
    name: 'Honeycomb',
    hint: '六边形配交错排列，铺成蜂窝',
    params: {
      'style.type': 'halftone',
      'halftone.shape': 'hexagon',
      'halftone.size': 100,
      'halftone.minSize': 22,
      'screen.lattice': 'hex',
      'screen.pitchX': 12,
      'screen.pitchY': 10,
      'screen.angle': 0,
      'ink.dot': '#1E2A38',
      'ink.paper': '#F2EFE9',
    },
    exposes: HT,
  },
];

export const PRESETS_STORAGE_KEY = 'presets';
export const SETTINGS_STORAGE_KEY = 'settings';

const builtinById = new Map(BUILTIN_PRESETS.map((p) => [p.id, p]));

export function findBuiltinPreset(id: string): BuiltinPreset | undefined {
  return builtinById.get(id);
}

/** 一套参数（完整或相对默认值的覆盖）属于哪种风格 */
export function presetStyle(params: Partial<Params>): StyleKind {
  return styleOf(params);
}

/** 预设（内置或用户）的风格；不存在的 id 返回 null */
export function presetStyleById(id: string, userPresets: readonly UserPreset[]): StyleKind | null {
  const builtin = builtinById.get(id);
  if (builtin) return presetStyle(builtin.params);
  const user = userPresets.find((p) => p.id === id);
  return user ? presetStyle(user.params) : null;
}

/** 某种风格的内置预设，「默认」在最前 */
export function builtinPresetsOf(style: StyleKind): BuiltinPreset[] {
  return BUILTIN_PRESETS.filter((p) => presetStyle(p.params) === style);
}

/** 某种风格的「默认」预设：预设模块的「重置」按当前页签退回它 */
export function defaultPresetIdFor(style: StyleKind): string {
  return style === 'hatch' ? HATCH_DEFAULT_PRESET_ID : style === 'halftone' ? HALFTONE_DEFAULT_PRESET_ID : DEFAULT_PRESET_ID;
}

/**
 * 两套参数在当前风格看得见的范围内是否有差别：只比共用参数与这种风格自己的参数，
 * 风格本身与别的风格的参数不算——在网点页签里改过抖动那边的东西不算网点方案被动过。
 */
export function paramsDiffer(a: Params, b: Params, style: StyleKind): boolean {
  return PARAM_SCHEMA.some((def) => {
    if (def.group === 'style') return false;
    const owner = GROUP_STYLE[def.group];
    if (owner && owner !== style) return false;
    return a[def.id] !== b[def.id];
  });
}

/** 内置预设展开成完整参数 */
export function builtinPresetParams(preset: BuiltinPreset): Params {
  return sanitizeParams({ ...defaultParams(), ...preset.params });
}

/** 一个预设（内置或用户）的来源内置预设：用户预设看 base，找不到按它自身风格的「默认」 */
export function resolveBase(id: string, userPresets: readonly UserPreset[]): BuiltinPreset {
  const builtin = builtinById.get(id);
  if (builtin) return builtin;
  const user = userPresets.find((p) => p.id === id);
  return (user?.base && builtinById.get(user.base)) || builtinById.get(user ? defaultPresetIdFor(presetStyle(user.params)) : DEFAULT_PRESET_ID)!;
}

/**
 * 当前方案"没微调过"时该有的那套参数：用户预设取它自己存下的，内置预设取展开值。
 * 「还原」「重置某一节」和"是否已微调"都以它为准。
 */
export function presetReferenceParams(id: string, userPresets: readonly UserPreset[]): Params {
  const user = userPresets.find((p) => p.id === id);
  if (user) return sanitizeParams(user.params);
  return builtinPresetParams(findBuiltinPreset(id) ?? resolveBase(id, userPresets));
}

/** 这个参数是否在预设的参数范围内（整组露出，或单独点名） */
export function isParamExposed(def: ParamDef, exposes: readonly string[]): boolean {
  return exposes.includes(def.group) || exposes.includes(def.id);
}

const optionLabel = (id: string, value: unknown): string => {
  const def = getParamDef(id);
  return def.type === 'select' ? def.options.find((o) => o.value === value)?.label ?? String(value) : String(value);
};

/**
 * 方案摘要，用于历史列表与卡片说明：抖动是 算法族 · 算法 · 颜色模式 · 像素尺寸，
 * 排线是 角度 · 间距 · 色阶，网点是 形状 · 间距 · 颜色模式。
 */
export function summarizeParams(params: Params): string {
  if (styleOf(params) === 'halftone') {
    const px = params['screen.pitchX'];
    const py = params['screen.pitchY'];
    return ['网点', optionLabel('halftone.shape', params['halftone.shape']), px === py ? `${px}px` : `${px}×${py}px`, optionLabel('ink.mode', params['ink.mode'])].join(' · ');
  }
  if (styleOf(params) === 'hatch') {
    return `排线 · ${params['hatch.angle']}° · 间距 ${params['hatch.spacingX']}×${params['hatch.spacingY']} · ${params['hatch.levels']} 级`;
  }
  const family = String(params['dither.family']) as DitherFamily;
  const familyLabel = DITHER_FAMILIES.find((f) => f.value === family)?.label ?? family;
  const algoId = FAMILY_PARAM[family];
  const parts = [familyLabel];
  if (algoId && hasParam(algoId)) {
    const def = getParamDef(algoId);
    if (def.type === 'select') parts.push(def.options.find((o) => o.value === params[algoId])?.label ?? String(params[algoId]));
  }
  const modeDef = getParamDef('color.mode');
  if (modeDef.type === 'select') parts.push(modeDef.options.find((o) => o.value === params['color.mode'])?.label ?? String(params['color.mode']));
  parts.push(`像素 ${params['pixel.size']}`);
  return parts.join(' · ');
}

/** 从存储读出的用户预设做基本校验 */
export function sanitizeUserPresets(input: unknown): UserPreset[] {
  if (!Array.isArray(input)) return [];
  const out: UserPreset[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.id !== 'string' || typeof rec.name !== 'string' || !rec.params || typeof rec.params !== 'object') continue;
    const preset: UserPreset = { id: rec.id, name: rec.name.slice(0, 60), params: rec.params as Params, createdAt: typeof rec.createdAt === 'number' ? rec.createdAt : 0 };
    if (typeof rec.updatedAt === 'number') preset.updatedAt = rec.updatedAt;
    if (typeof rec.base === 'string' && builtinById.has(rec.base)) preset.base = rec.base;
    if (typeof rec.thumbnail === 'string' && rec.thumbnail.startsWith('data:image/')) preset.thumbnail = rec.thumbnail;
    out.push(preset);
  }
  return out;
}

export function newPresetId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
