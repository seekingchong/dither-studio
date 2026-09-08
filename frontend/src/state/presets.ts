import { FAMILY_PARAM, type DitherFamily } from '@/engine';
import {
  DITHER_FAMILIES,
  GROUP_STYLE,
  PARAM_SCHEMA,
  defaultParams,
  getParamDef,
  glyphColorId,
  glyphShapeId,
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
  /** 星标：预设模块里排在其它我的预设前面 */
  starred?: boolean;
}

const effects = (stack: unknown[]) => JSON.stringify(stack);

export const DEFAULT_PRESET_ID = 'default';
/** 排线风格的「默认」：切到排线页签时预设模块的「重置」退回这一套 */
export const HATCH_DEFAULT_PRESET_ID = 'hatch-classic';
/** 网点风格的「默认」 */
export const HALFTONE_DEFAULT_PRESET_ID = 'halftone-default';
/** 符号风格的「默认」 */
export const GLYPH_DEFAULT_PRESET_ID = 'glyph-default';

export const ALL_GROUPS: readonly ParamGroup[] = ['style', 'pixel', 'tone', 'dither', 'color', 'hatch', 'halftone', 'screen', 'ink', 'glyph', 'tile', 'canvas', 'grid', 'effects'];
/**
 * 大多数风格预设具备的分组：像素化、影调、算法自身参数、颜色、排线、画布尺寸。
 * 抖动与排线的分组都在里面——两种风格的参数本来就按页签互斥显示，一起露出才能在任一预设上切换页签。
 */
const CORE: readonly ParamGroup[] = ['style', 'pixel', 'tone', 'dither', 'color', 'hatch', 'canvas'];
/** 网点预设一律露出自己的全部分组：参数本来就不多，藏起来反而找不到；影调 / 画布 / 特效共用 */
const HT: readonly ParamGroup[] = ['style', 'halftone', 'screen', 'ink', 'tone', 'canvas', 'effects'];
/** 符号预设同理 */
const GL: readonly ParamGroup[] = ['style', 'glyph', 'tile', 'tone', 'canvas', 'effects'];

/** 符号风格里从亮到暗每一阶的形状 / 颜色，写成一批参数覆盖 */
const glyphShapes = (ids: string[]): Partial<Params> => Object.fromEntries(ids.map((id, k) => [glyphShapeId(k + 1), id]));
const glyphColors = (hexes: string[]): Partial<Params> => Object.fromEntries(hexes.map((hex, k) => [glyphColorId(k + 1), hex]));

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
  // Line Screen 的线一格一段，粗细在格子边界上打台阶；这一套换成「平滑线」——整行连成一条带子，
  // 相邻格子之间按单调三次曲线过渡，连续变粗变细的几格是一整条平滑的坡，像钞票上的雕刻线
  {
    id: 'ht-line-flow',
    name: 'Line Flow',
    hint: '线网粗细顺滑起伏、不打台阶，像钞票上的雕刻线',
    params: {
      'style.type': 'halftone',
      'halftone.shape': 'smoothline',
      'halftone.size': 100,
      'halftone.minSize': 8,
      'halftone.mapping': 'linear',
      'screen.pitchX': 6,
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
  // 参考图三：音乐节海报——黑色圆点配亮黄底，点不在齐整的方格上：网格被几处圆形波推歪，亮部的小点沿干涉弧线排开，
  // 主体处大点相接读成一块；亮处只剩针尖小点
  {
    id: 'ht-yellow-pop',
    name: 'Yellow Pop',
    hint: '涟漪推歪的黑圆点配亮黄底，小点排成弧线，主体大点相接',
    params: {
      'style.type': 'halftone',
      'halftone.shape': 'circle',
      'halftone.size': 96,
      'halftone.minSize': 5,
      'halftone.mapping': 'area',
      'halftone.gain': 10,
      'screen.pitchX': 14,
      'screen.pitchY': 14,
      'screen.angle': 0,
      'screen.warp': 'ripple',
      'screen.warpAmount': 60,
      'screen.warpScale': 12,
      'screen.warpSeed': 1,
      'ink.dot': '#111111',
      'ink.paper': '#FFF200',
      'tone.contrast': 20,
    },
    exposes: HT,
  },

  // ---------- 符号 ----------
  // schema 默认值就是这一套：草图序列 5 阶、12px 方格、墨色配白纸
  {
    id: GLYPH_DEFAULT_PRESET_ID,
    name: '默认',
    hint: '草图序列 5 阶，12px 方格，墨色配白纸',
    params: { 'style.type': 'glyph' },
    exposes: GL,
  },
  // 从网点风格挪过来的两套：参考图一——点阵天空 → 斜线 → 十字 → 网格 → 斜线上的大圆点，交界处掺杂、点缀圆圈三角。
  // 顺序按参考图排，不是墨量序（圆点靠亮部缩小才排在最前），所以存成自定义序列
  {
    id: 'glyph-sketch',
    name: 'Symbol Sketch',
    hint: '亮处小点、中间调斜线、暗处十字与网格，点缀圆圈三角',
    params: {
      'style.type': 'glyph',
      'glyph.ramp': 'custom',
      'glyph.levels': 5,
      ...glyphShapes(['dot', 'slash', 'plus', 'hash', 'dotslash']),
      // 最大符号留一点缝，暗部大圆点之间的斜线才露得出来；最亮一阶的点缩到 28%
      'glyph.size': 88,
      'glyph.taper': 68,
      'glyph.stroke': 12,
      'glyph.mix': 35,
      'glyph.accent': 5,
      'tile.pitchX': 13,
      'tile.pitchY': 13,
      'glyph.ink': '#111111',
      'glyph.paper': '#FFFFFF',
      'tone.contrast': 10,
    },
    exposes: GL,
  },
  // 参考图二：打字机字符画——留白 → 横线 → 4 → 6 → % → 实心点 → 实心三角，字符一样大，米色纸，交界处大量掺杂
  {
    id: 'glyph-typewriter',
    name: 'Typewriter',
    hint: '打字机字符：横线、4、6、%、实心点、三角，米色纸',
    params: {
      'style.type': 'glyph',
      'glyph.ramp': 'custom',
      'glyph.levels': 7,
      ...glyphShapes(['blank', 'dash', 'four', 'six', 'percent', 'dot', 'tri']),
      'glyph.size': 72,
      'glyph.taper': 0,
      'glyph.stroke': 14,
      'glyph.mix': 60,
      'glyph.accent': 0,
      'tile.pitchX': 11,
      'tile.pitchY': 13,
      'glyph.ink': '#1A1A1A',
      'glyph.paper': '#F6F1E3',
      'tone.contrast': 20,
    },
    exposes: GL,
  },
  {
    id: 'glyph-terminal',
    name: 'Terminal',
    hint: '字符画 8 阶，荧光绿配黑底，竖长的等宽字符格',
    params: {
      'style.type': 'glyph',
      'glyph.ramp': 'ascii',
      'glyph.levels': 8,
      'glyph.size': 85,
      'glyph.stroke': 14,
      'glyph.mix': 20,
      'glyph.accent': 0,
      'tile.pitchX': 9,
      'tile.pitchY': 14,
      'glyph.ink': '#3DF56B',
      'glyph.paper': '#06110A',
      'tone.invert': true,
      'tone.contrast': 15,
    },
    exposes: GL,
  },
  {
    id: 'glyph-mesh',
    name: 'Line Mesh',
    hint: '短横、斜线、十字到密网，线条越密越暗，蓝黑线配米纸',
    params: {
      'style.type': 'glyph',
      'glyph.ramp': 'mesh',
      'glyph.levels': 6,
      'glyph.size': 90,
      'glyph.stroke': 10,
      'glyph.mix': 25,
      'glyph.accent': 0,
      'tile.pitchX': 10,
      'tile.pitchY': 10,
      'glyph.ink': '#1B2A41',
      'glyph.paper': '#F4F1EA',
      'tone.contrast': 10,
    },
    exposes: GL,
  },
  {
    id: 'glyph-geo',
    name: 'Geo Poster',
    hint: '菱框到实心方 6 阶，每阶一色：黄、橙、红、紫到藏青',
    params: {
      'style.type': 'glyph',
      'glyph.ramp': 'geometric',
      'glyph.levels': 6,
      'glyph.size': 92,
      'glyph.stroke': 16,
      'glyph.mix': 0,
      'glyph.accent': 0,
      'tile.pitchX': 16,
      'tile.pitchY': 16,
      'glyph.colorMode': 'levels',
      ...glyphColors(['#F2C14E', '#F58F29', '#E4572E', '#C8354D', '#7B2D8B', '#29335C']),
      'glyph.paper': '#F7F3EA',
      'tone.contrast': 10,
    },
    exposes: GL,
  },
  // 深底亮符号：反相之后亮部落在暗的阶，配色从最亮一阶的暗紫排到最暗一阶的亮黄，暗底上越亮的地方符号越密越亮
  {
    id: 'glyph-neon',
    name: 'Neon Levels',
    hint: '点阵序列 7 阶，深紫底上从暗紫到亮黄，越亮越密',
    params: {
      'style.type': 'glyph',
      'glyph.ramp': 'dots',
      'glyph.levels': 7,
      'glyph.size': 85,
      'glyph.stroke': 14,
      'glyph.mix': 30,
      'glyph.accent': 0,
      'tile.pitchX': 12,
      'tile.pitchY': 12,
      'tile.lattice': 'hex',
      'glyph.colorMode': 'levels',
      ...glyphColors(['#3A2A5E', '#5B3B9E', '#8A4DCF', '#C45BE0', '#FF6FB5', '#FFB86B', '#FFF6C8']),
      'glyph.paper': '#0E0B16',
      'tone.invert': true,
      'tone.contrast': 15,
    },
    exposes: GL,
  },
  {
    id: 'glyph-confetti',
    name: 'Confetti',
    hint: '记号序列取原图色，交错排列、交界掺杂，像撒了彩纸',
    params: {
      'style.type': 'glyph',
      'glyph.ramp': 'marks',
      'glyph.levels': 6,
      'glyph.size': 90,
      'glyph.stroke': 14,
      'glyph.mix': 50,
      'glyph.accent': 10,
      'tile.pitchX': 12,
      'tile.pitchY': 12,
      'tile.lattice': 'hex',
      'glyph.colorMode': 'source',
      'glyph.paper': '#FFFFFF',
      'tone.saturation': 25,
      'tone.contrast': 10,
    },
    exposes: GL,
  },
  {
    id: 'glyph-letterpress',
    name: 'Letterpress',
    hint: '字母 1、T、Z、N、M 五阶，红墨配牛皮纸，活版印刷',
    params: {
      'style.type': 'glyph',
      'glyph.ramp': 'letters',
      'glyph.levels': 5,
      'glyph.size': 84,
      'glyph.stroke': 16,
      'glyph.mix': 15,
      'glyph.accent': 0,
      'tile.pitchX': 14,
      'tile.pitchY': 14,
      'glyph.ink': '#B0302A',
      'glyph.paper': '#F3E9D2',
      'tone.contrast': 20,
    },
    exposes: GL,
  },
  {
    id: 'glyph-ripple',
    name: 'Ripple Type',
    hint: '打字机序列 6 阶，网格被涟漪推歪，字符沿弧线排开',
    params: {
      'style.type': 'glyph',
      'glyph.ramp': 'typewriter',
      'glyph.levels': 6,
      'glyph.size': 78,
      'glyph.stroke': 13,
      'glyph.mix': 40,
      'glyph.accent': 0,
      'tile.pitchX': 12,
      'tile.pitchY': 12,
      'tile.warp': 'ripple',
      'tile.warpAmount': 50,
      'tile.warpScale': 10,
      'glyph.ink': '#1A1A1A',
      'glyph.paper': '#FFFFFF',
      'tone.contrast': 15,
    },
    exposes: GL,
  },
  {
    id: 'glyph-blueprint',
    name: 'Blueprint Marks',
    hint: '记号序列 6 阶，蓝底白线，反相',
    params: {
      'style.type': 'glyph',
      'glyph.ramp': 'marks',
      'glyph.levels': 6,
      'glyph.size': 82,
      'glyph.stroke': 12,
      'glyph.mix': 20,
      'glyph.accent': 0,
      'tile.pitchX': 12,
      'tile.pitchY': 12,
      'glyph.ink': '#DCE8FF',
      'glyph.paper': '#0D3B8C',
      'tone.invert': true,
      'tone.contrast': 10,
    },
    exposes: GL,
  },
  // 参考图三：黑底荧光绿的电路板——暗处一粒小点、短斜线、十字、小叉，亮处同心圆、圆角框、四叶草越来越粗大；
  // 深底亮符号所以反相；亮部缩小让小记号真的小、大符号真的大；交界处大量掺杂，像元件随手排上去的
  {
    id: 'glyph-circuit',
    name: 'Lime Circuit',
    hint: '黑底荧光绿：小点、斜线、十字、叉到同心圆、圆角框、四叶草',
    params: {
      'style.type': 'glyph',
      'glyph.ramp': 'custom',
      'glyph.levels': 8,
      ...glyphShapes(['blank', 'pip', 'slashshort', 'plus', 'xmark', 'rings', 'roundbox', 'clover']),
      'glyph.size': 90,
      'glyph.taper': 55,
      'glyph.stroke': 15,
      'glyph.mix': 45,
      'glyph.accent': 0,
      'tile.pitchX': 16,
      'tile.pitchY': 16,
      'glyph.ink': '#C8FF1A',
      'glyph.paper': '#0A0A0A',
      'tone.invert': true,
      'tone.contrast': 15,
    },
    exposes: GL,
  },
  // 参考图四：墨绿底的「Checkmate」——淡紫小点与折线、中绿的六瓣花、薄荷绿的竖纹、棋盘格与城堡，每阶一色；
  // 100% 大小让棋盘格与竖纹在邻格之间接得上；深底亮符号所以反相
  {
    id: 'glyph-checkmate',
    name: 'Checkmate',
    hint: '墨绿底：淡紫点与折线、六瓣花、竖纹、棋盘格到薄荷绿城堡',
    params: {
      'style.type': 'glyph',
      'glyph.ramp': 'custom',
      'glyph.levels': 7,
      ...glyphShapes(['blank', 'pip', 'flower', 'zigzag', 'stripes', 'checker', 'rook']),
      'glyph.size': 100,
      'glyph.taper': 0,
      'glyph.stroke': 13,
      'glyph.mix': 15,
      'glyph.accent': 0,
      'tile.pitchX': 18,
      'tile.pitchY': 18,
      'glyph.colorMode': 'levels',
      ...glyphColors(['#9C9FE9', '#9C9FE9', '#2F9E6B', '#9C9FE9', '#5EE6A2', '#5EE6A2', '#5EE6A2']),
      'glyph.paper': '#0F5C3F',
      'tone.invert': true,
      'tone.contrast': 15,
    },
    exposes: GL,
  },
  // 参考图五：黑底上青与荧光绿两色的字符画，像终端里滚出来的一屏字——暗处零星的逗号与冒号，
  // 中间调 C K % Ø 一路加密，最亮的一阶整格填实，像屏幕上的反白块。用新的「终端」序列。
  // 分级配色让青与荧光绿逐阶交替，交界混合开到 85%：同一片明暗里两三种字符、两种颜色掺在一起，
  // 既有参考图那种密密麻麻的字符感，又不像它那样乱。10×13 的格子是终端的字符比例，一行行读得出来；
  // 深底亮字所以反相，再叠一层很轻的扫描线，像隔着屏幕拍下来的
  {
    id: 'glyph-petscii',
    name: 'PETSCII Glitch',
    hint: '黑底青绿两色终端字符：逗号、冒号、C K % Ø 到整格实心块',
    params: {
      'style.type': 'glyph',
      'glyph.ramp': 'terminal',
      'glyph.levels': 8,
      'glyph.size': 100,
      'glyph.taper': 0,
      'glyph.stroke': 17,
      'glyph.mix': 85,
      'glyph.accent': 0,
      'tile.pitchX': 10,
      'tile.pitchY': 13,
      'glyph.colorMode': 'levels',
      ...glyphColors(['#1E7F8C', '#1E7F8C', '#29C8E0', '#C3E82B', '#29C8E0', '#C3E82B', '#29C8E0', '#C3E82B']),
      'glyph.paper': '#05070B',
      'tone.invert': true,
      'tone.contrast': 15,
      'effects.stack': effects([{ type: 'scanlines', enabled: true, params: { period: 4, darkness: 26, phosphor: 0, curvature: 0 } }]),
    },
    exposes: GL,
  },
  // 参考图六：荧光柠檬绿底上的墨色「密文」——亮处一粒小点、短斜线、十字，中间调圆圈与叉号，暗处靶心、圈十、圈叉，
  // 像终端屏幕上一行行等宽字符。八阶按墨量单调递增，全都从符号库里取；符号接近等大（只让最亮的小点缩一点），
  // 12px 方格、交界处大量掺杂让阶与阶之间像信号噪点一样过渡；浅底深符号，不反相
  {
    id: 'glyph-cipher',
    name: 'Acid Cipher',
    hint: '柠檬绿底墨色 8 阶：小点、短斜线、十字、圆圈、叉号到靶心、圈十、圈叉',
    params: {
      'style.type': 'glyph',
      'glyph.ramp': 'custom',
      'glyph.levels': 8,
      ...glyphShapes(['pip', 'slashshort', 'plus', 'ring', 'xmark', 'ringdot', 'circleplus', 'circlex']),
      'glyph.size': 74,
      'glyph.taper': 30,
      'glyph.stroke': 12,
      'glyph.mix': 45,
      'glyph.accent': 0,
      'tile.pitchX': 12,
      'tile.pitchY': 12,
      'glyph.ink': '#0E150A',
      'glyph.paper': '#C9F52C',
      'tone.contrast': 20,
    },
    exposes: GL,
  },
  // 参考图七：白纸上的「失步」海报——主体被拆成粗细分档的横向扫描线与黑色像素块，
  // 黑块里冲出一粒粒纸色的孔，荧光黄绿的块夹在暗调里，几行整体错位像信号丢帧。
  // 亮到暗：留白 → 短横（不出格，断成一节节的虚线）→ 细板 → 横板（越暗越粗的横条，邻格接成长线）
  //       → 穿孔块（黄绿）→ 实心方（黄绿）→ 穿孔块（黑）→ 实心方（黑）；
  // 黄绿占两阶，成片而不是一条细边；穿孔块与实心方交替，黑块与黄绿块里都留着纸色的孔。
  // 符号大小 140% 配亮部缩小 35%：短横那一阶缩到 98% 断成虚线；实心方的边长是符号的 85%，要 ≥ 118% 才盖满格子，
  // 最暗那四阶（穿孔块与实心方）正好都在这条线以上，成片时邻格之间不留纸缝。
  // 特效栈两条：「扫描行位移」带高与格子等高，整行的块一起挪、不切碎符号；一点「胶片颗粒」给纸面上一层印刷的糙感
  {
    id: 'glyph-desync',
    name: 'Desync',
    hint: '白纸黑块：越暗越粗的横板、冲出纸色小孔的黑块，荧光黄绿成片夹在暗调里，扫描行错位',
    params: {
      'style.type': 'glyph',
      'glyph.ramp': 'custom',
      'glyph.levels': 8,
      ...glyphShapes(['blank', 'minus', 'slabthin', 'slab', 'blockhole', 'square', 'blockhole', 'square']),
      'glyph.size': 140,
      'glyph.taper': 35,
      'glyph.stroke': 22,
      'glyph.mix': 80,
      'glyph.accent': 0,
      'tile.pitchX': 11,
      'tile.pitchY': 11,
      'glyph.colorMode': 'levels',
      ...glyphColors(['#111111', '#111111', '#111111', '#111111', '#D6FF1A', '#D6FF1A', '#111111', '#111111']),
      'glyph.paper': '#F2F2EE',
      'tone.contrast': 30,
      'tone.midtones': 12,
      'effects.stack': effects([
        { type: 'rowShift', enabled: true, params: { probability: 7, maxShift: 36, band: 11, rgbSplit: 0, seed: 3 } },
        { type: 'grain', enabled: true, params: { amount: 10, size: 1, color: false, seed: 1 } },
      ]),
    },
    exposes: GL,
  },
  // 参考图八：米白纸上的丝网海报——大片黑色的叠圈与短竖笔触打底，中间零星的绿圆点与橙三角点缀，像 riso 三色套印。
  // 8 阶自定义序列 空 → 小点 → 三角 → 圆点 → 圆圈 → 叠圈 → 短竖纹 → 圆点：黑色占了 6 阶（最亮的小点、圈、叠圈、
  // 短竖纹到最暗的实心圆点），只把第 3 阶给橙、第 4 阶给绿，两种彩色各占一阶，画面就还是黑白打底、彩色点缀。
  // 亮部缩小 42% 让橙三角小、绿圆点中等、暗处的黑圆点满格；96% 大小让最暗一阶的圆点刚好挨上而不糊成一团。
  // 交界混合 70% 把相邻两阶掺开，彩色不会连成整块；点缀 12% 再撒一些圆圈与三角框；胶片颗粒当纸纹
  {
    id: 'glyph-riso',
    name: 'Riso Signal',
    hint: '米白纸上黑色的圆圈、叠圈与短竖纹打底，绿圆点与橙三角点缀',
    params: {
      'style.type': 'glyph',
      'glyph.ramp': 'custom',
      'glyph.levels': 8,
      ...glyphShapes(['blank', 'pip', 'tri', 'dot', 'ring', 'ringpair', 'comb', 'dot']),
      'glyph.size': 96,
      'glyph.taper': 42,
      'glyph.stroke': 13,
      'glyph.mix': 70,
      'glyph.accent': 12,
      'tile.pitchX': 18,
      'tile.pitchY': 18,
      'glyph.colorMode': 'levels',
      ...glyphColors(['#1A1A1A', '#1A1A1A', '#F0562C', '#3FAF6B', '#1A1A1A', '#1A1A1A', '#1A1A1A', '#1A1A1A']),
      'glyph.paper': '#EDEAE3',
      'tone.contrast': 12,
      'effects.stack': effects([{ type: 'grain', enabled: true, params: { amount: 18, size: 1, color: false, seed: 1 } }]),
    },
    exposes: GL,
  },
  // 参考图九：黑底上一幅假彩色的扫描图，整幅盖着一层等距的竖线栅（像隔着显像管的荫罩栅拍下来的）——
  // 亮的地方栅线又粗又亮，暗的地方细得几乎看不见，颜色从近黑的靛蓝一路升到蓝、青绿、柠檬黄，最亮的核心烧成一片暖白。
  // 所以这套预设不靠换形状、而靠「同一个栅距下越来越粗的竖带」分阶：竖栅一家五档（微 / 细 / 中 / 粗 / 满）粗细等差、
  // 栅距不变，邻格接上后整幅画面是一片连续的竖栅；最暗一阶留空（黑底透出来），最亮一阶用实心格烧成整块。
  // 竖带的粗细写死在符号里，不跟线粗走，细带也不会被抗锯齿冲淡成灰——颜色才够艳。
  // 深底亮符号所以反相；关掉线性空间，7 个阶才均匀铺在明暗上，不然大半画面挤在最亮那一阶。
  {
    id: 'glyph-grille',
    name: 'Aperture Grille',
    hint: '黑底竖栅：等距竖带越亮越粗，深靛、蓝、青绿、柠檬黄到暖白核心',
    params: {
      'style.type': 'glyph',
      'glyph.ramp': 'custom',
      'glyph.levels': 7,
      ...glyphShapes(['blank', 'grillehair', 'grillefine', 'grillemid', 'grillebold', 'grillefull', 'block']),
      // 竖带不吃符号大小，100% 是留给换成方块 / 棋盘那类符号时能与邻格接上
      'glyph.size': 100,
      'glyph.taper': 0,
      'glyph.mix': 45,
      'glyph.accent': 0,
      'tile.pitchX': 16,
      'tile.pitchY': 16,
      'glyph.colorMode': 'levels',
      ...glyphColors(['#08121F', '#0E2B57', '#12579F', '#0F9AD8', '#27D2BE', '#D6E84A', '#FFF6E2']),
      'glyph.paper': '#04070C',
      'tone.invert': true,
      'tone.linear': false,
      'tone.contrast': 15,
    },
    exposes: GL,
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
  return style === 'hatch' ? HATCH_DEFAULT_PRESET_ID : style === 'halftone' ? HALFTONE_DEFAULT_PRESET_ID : style === 'glyph' ? GLYPH_DEFAULT_PRESET_ID : DEFAULT_PRESET_ID;
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
 * 排线是 角度 · 像素尺寸 · 色阶，网点是 形状 · 间距 · 颜色模式，符号是 序列 · 阶数 · 间距。横纵不等时像素尺寸写成 7×16。
 */
export function summarizeParams(params: Params): string {
  if (styleOf(params) === 'glyph') {
    const px = params['tile.pitchX'];
    const py = params['tile.pitchY'];
    return ['符号', optionLabel('glyph.ramp', params['glyph.ramp']), `${params['glyph.levels']} 阶`, px === py ? `${px}px` : `${px}×${py}px`].join(' · ');
  }
  if (styleOf(params) === 'halftone') {
    const px = params['screen.pitchX'];
    const py = params['screen.pitchY'];
    return ['网点', optionLabel('halftone.shape', params['halftone.shape']), px === py ? `${px}px` : `${px}×${py}px`, optionLabel('ink.mode', params['ink.mode'])].join(' · ');
  }
  if (styleOf(params) === 'hatch') {
    const sx = params['hatch.spacingX'];
    const sy = params['hatch.spacingY'];
    return `排线 · ${params['hatch.angle']}° · 像素 ${sx === sy ? sx : `${sx}×${sy}`} · ${params['hatch.levels']} 级`;
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
    if (rec.starred === true) preset.starred = true;
    out.push(preset);
  }
  return out;
}

/** 副本的名字：「原名 副本」，重名就往后排号。存预设的预填名与卡片上的「复制」共用一套叫法 */
export function copyPresetName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const stem = `${base} 副本`.slice(0, 60);
  if (!used.has(stem)) return stem;
  for (let i = 2; i < 1000; i++) {
    const next = `${stem} ${i}`.slice(0, 60);
    if (!used.has(next)) return next;
  }
  return `${stem} ${Date.now()}`.slice(0, 60);
}

export function newPresetId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
