import { parseColorList } from '../color/palettes';
import { hexToRgb } from '../color/srgb';
import type { RGBAFrame } from '../types';
import { mulberry32 } from '../util/random';
import { drawableChars, FONT_COLS, FONT_ROWS, glyphOf } from './font5x7';
import { DEFAULT_GRID_UNIT, type EffectDef, type EffectParamValues, type GridUnit } from './types';

/**
 * 叠加随机方块：在成品上按当前风格的网格随机撒几块实色块，像界面出错时掉出来的碎片。
 * 方块的尺寸以「格子」（抖动的像素尺寸、排线 / 网点 / 符号的间距）为最小单位，永远对齐网格；
 * 可以是纯色块，也可以在色块里放一个点阵字母；颜色按配色方案展开到每一块，每一块都能单独改。
 */

export const BLOCK_MAX_COUNT = 16;
/** 「尺寸」的上限：比例里 1 份最多对应几格 */
export const BLOCK_MAX_SIZE = 16;

export interface BlockRatio {
  value: string;
  label: string;
  w: number;
  h: number;
}

/** 宽 : 高。「尺寸」是 1 份对应几格：比例 1:2、尺寸 2 就是 2 × 4 格 */
export const BLOCK_RATIOS: readonly BlockRatio[] = [
  { value: '1:1', label: '1:1 方', w: 1, h: 1 },
  { value: '2:1', label: '2:1 横', w: 2, h: 1 },
  { value: '1:2', label: '1:2 竖', w: 1, h: 2 },
  { value: '3:1', label: '3:1 横', w: 3, h: 1 },
  { value: '1:3', label: '1:3 竖', w: 1, h: 3 },
  { value: '3:2', label: '3:2 横', w: 3, h: 2 },
  { value: '2:3', label: '2:3 竖', w: 2, h: 3 },
  { value: '4:3', label: '4:3 横', w: 4, h: 3 },
  { value: '3:4', label: '3:4 竖', w: 3, h: 4 },
  { value: '16:9', label: '16:9 横', w: 16, h: 9 },
  { value: '9:16', label: '9:16 竖', w: 9, h: 16 },
];

export interface BlockPalette {
  value: string;
  label: string;
  colors: string[];
}

/** 配色方案：方块按顺序轮流取这些颜色；「自定义」用 colors 参数里的列表 */
export const BLOCK_PALETTES: readonly BlockPalette[] = [
  { value: 'white', label: '白', colors: ['#FFFFFF'] },
  { value: 'black', label: '黑', colors: ['#000000'] },
  { value: 'bw', label: '黑白', colors: ['#FFFFFF', '#000000'] },
  { value: 'gray', label: '灰阶', colors: ['#FFFFFF', '#BFBFBF', '#808080', '#404040'] },
  { value: 'lime', label: '荧光黄绿', colors: ['#E5F56E'] },
  { value: 'neon', label: '荧光', colors: ['#E5F56E', '#5AFFB0', '#FF5AE8', '#5AD8FF'] },
  { value: 'cmy', label: '印刷三原色', colors: ['#00AEEF', '#EC008C', '#FFF200'] },
  { value: 'rgb', label: '光的三原色', colors: ['#FF0000', '#00FF00', '#0000FF'] },
  { value: 'pastel', label: '柔和', colors: ['#FFD6E0', '#C1E7FF', '#FFF5BA', '#D4F5D4'] },
  { value: 'custom', label: '自定义', colors: [] },
];

const n = (p: EffectParamValues, id: string, fallback: number) => (typeof p[id] === 'number' ? (p[id] as number) : fallback);
const s = (p: EffectParamValues, id: string, fallback: string) => (typeof p[id] === 'string' ? (p[id] as string) : fallback);
const b = (p: EffectParamValues, id: string, fallback: boolean) => (typeof p[id] === 'boolean' ? (p[id] as boolean) : fallback);
const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));
const luma = (r: number, g: number, bl: number) => 0.2126 * r + 0.7152 * g + 0.0722 * bl;

function blockCount(params: EffectParamValues): number {
  return clampInt(n(params, 'count', 6), 0, BLOCK_MAX_COUNT);
}

/** 当前实例实际生效的每一块颜色：按配色方案（或自定义列表）轮流取，正好 count 个 */
export function resolveBlockColors(params: EffectParamValues): string[] {
  const count = blockCount(params);
  const palette = s(params, 'palette', 'white');
  const custom = parseColorList(s(params, 'colors', ''));
  const preset = BLOCK_PALETTES.find((p) => p.value === palette);
  const base = palette === 'custom' || !preset ? (custom.length ? custom : ['#FFFFFF']) : preset.colors;
  return Array.from({ length: count }, (_, i) => base[i % base.length]);
}

/** 改第 index 块的颜色：把当前展开的列表整个写进 colors，方案转为「自定义」 */
export function editBlockColor(params: EffectParamValues, index: number, hex: string): EffectParamValues {
  const colors = resolveBlockColors(params);
  if (index < 0 || index >= colors.length) return params;
  const next = colors.slice();
  next[index] = hex.toUpperCase();
  return { ...params, palette: 'custom', colors: next.join(' ') };
}

export interface BlockRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** #RRGGBB */
  color: string;
  /** 放在块里的字，纯色块为 null */
  letter: string | null;
}

/** 字母怎么画：占块短边的比例，颜色（null 表示按块的明暗自动取黑或白） */
export interface LetterStyle {
  size: number;
  color: string | null;
}

export function letterStyleOf(params: EffectParamValues): LetterStyle {
  const size = clampInt(n(params, 'letterSize', 60), 20, 100) / 100;
  const color = s(params, 'letterColor', 'auto') === 'custom' ? s(params, 'letterHex', '#000000') : null;
  return { size, color };
}

/**
 * 算出每一块落在哪：随机种子决定位置与（打开大小随机时的）大小，
 * 位置只在网格线上取，块整个落在画布内；块比画布还大时贴着左上角放、超出的裁掉。
 * 每块固定消耗三个随机数（大小、横、纵），所以改尺寸、比例、大小随机时块的位置只是重新夹紧，不会整体洗牌。
 */
export function layoutBlocks(width: number, height: number, params: EffectParamValues, grid: GridUnit = DEFAULT_GRID_UNIT): BlockRect[] {
  const count = blockCount(params);
  if (count === 0 || width <= 0 || height <= 0) return [];
  const cellW = Math.max(1, Math.round(grid.cellW));
  const cellH = Math.max(1, Math.round(grid.cellH));
  const ox = ((Math.round(grid.offsetX) % cellW) + cellW) % cellW;
  const oy = ((Math.round(grid.offsetY) % cellH) + cellH) % cellH;
  const ratio = BLOCK_RATIOS.find((r) => r.value === s(params, 'ratio', '1:1')) ?? BLOCK_RATIOS[0];
  const size = clampInt(n(params, 'size', 4), 1, BLOCK_MAX_SIZE);
  const jitter = b(params, 'jitter', false);
  const letters = s(params, 'style', 'solid') === 'letter' ? drawableChars(s(params, 'letters', 'A')) : [];
  const colors = resolveBlockColors(params);
  const rand = mulberry32(clampInt(n(params, 'seed', 1), 0, 0xffffffff));

  /** 能让块整个落在画布内的网格线编号区间里随机挑一条；放不下就从第 0 条起 */
  const pick = (r: number, cell: number, off: number, extent: number, length: number) => {
    const k0 = off > 0 ? 1 : 0;
    const k1 = Math.floor((length + off - extent) / cell);
    if (k1 < k0) return 0 - off;
    return (k0 + Math.floor(r * (k1 - k0 + 1))) * cell - off;
  };

  const out: BlockRect[] = [];
  for (let i = 0; i < count; i++) {
    const rSize = rand();
    const rx = rand();
    const ry = rand();
    const m = jitter ? 1 + Math.floor(rSize * size) : size;
    const w = m * ratio.w * cellW;
    const h = m * ratio.h * cellH;
    out.push({
      x: pick(rx, cellW, ox, w, width),
      y: pick(ry, cellH, oy, h, height),
      w,
      h,
      color: colors[i],
      letter: letters.length ? letters[i % letters.length] : null,
    });
  }
  return out;
}

/** 字母在块里的点阵格：放大倍率与左上角；块太小放不下时为 null */
export function letterCells(rect: BlockRect, style: LetterStyle): { scale: number; x: number; y: number } | null {
  if (!rect.letter) return null;
  const scale = Math.floor(Math.min((rect.w * style.size) / FONT_COLS, (rect.h * style.size) / FONT_ROWS));
  if (scale < 1) return null;
  return { scale, x: rect.x + Math.floor((rect.w - FONT_COLS * scale) / 2), y: rect.y + Math.floor((rect.h - FONT_ROWS * scale) / 2) };
}

/** 字母的颜色：指定了就用指定的，否则浅块配黑字、深块配白字 */
export function letterColorFor(block: string, style: LetterStyle): [number, number, number] {
  if (style.color) return hexToRgb(style.color);
  const [r, g, bl] = hexToRgb(block);
  return luma(r, g, bl) > 140 ? [0, 0, 0] : [255, 255, 255];
}

function fillRect(frame: RGBAFrame, x0: number, y0: number, w: number, h: number, rgb: [number, number, number]) {
  const { width, height, data } = frame;
  const xa = Math.max(0, x0);
  const ya = Math.max(0, y0);
  const xb = Math.min(width, x0 + w);
  const yb = Math.min(height, y0 + h);
  for (let y = ya; y < yb; y++) {
    for (let x = xa; x < xb; x++) {
      const o = (y * width + x) * 4;
      data[o] = rgb[0];
      data[o + 1] = rgb[1];
      data[o + 2] = rgb[2];
      data[o + 3] = 255;
    }
  }
}

/** 把算好的块画到帧上（返回新帧，源帧不动） */
export function drawBlocks(frame: RGBAFrame, rects: BlockRect[], style: LetterStyle): RGBAFrame {
  const out: RGBAFrame = { width: frame.width, height: frame.height, data: new Uint8ClampedArray(frame.data) };
  for (const rect of rects) {
    fillRect(out, rect.x, rect.y, rect.w, rect.h, hexToRgb(rect.color));
    const cells = letterCells(rect, style);
    const glyph = rect.letter ? glyphOf(rect.letter) : null;
    if (!cells || !glyph) continue;
    const ink = letterColorFor(rect.color, style);
    for (let row = 0; row < FONT_ROWS; row++) {
      for (let col = 0; col < FONT_COLS; col++) {
        if (glyph[row][col]) fillRect(out, cells.x + col * cells.scale, cells.y + row * cells.scale, cells.scale, cells.scale, ink);
      }
    }
  }
  return out;
}

/**
 * 同一批块的 SVG 片段：一块一个 rect，字母的每个点阵格并进一条 path。
 * 排线 / 网点 / 符号的矢量导出从几何直接出图形、不经过位图，特效栈里的方块靠这个补上。
 */
export function blocksSvgFragment(rects: BlockRect[], style: LetterStyle): string {
  const parts: string[] = [];
  for (const rect of rects) {
    parts.push(`<rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" fill="${rect.color}"/>`);
    const cells = letterCells(rect, style);
    const glyph = rect.letter ? glyphOf(rect.letter) : null;
    if (!cells || !glyph) continue;
    const [r, g, bl] = letterColorFor(rect.color, style);
    const fill = `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0').toUpperCase()}`;
    const d: string[] = [];
    for (let row = 0; row < FONT_ROWS; row++) {
      for (let col = 0; col < FONT_COLS; col++) {
        if (glyph[row][col]) d.push(`M${cells.x + col * cells.scale} ${cells.y + row * cells.scale}h${cells.scale}v${cells.scale}h-${cells.scale}z`);
      }
    }
    parts.push(`<path d="${d.join('')}" fill="${fill}"/>`);
  }
  return parts.join('');
}

const RATIO_OPTIONS = BLOCK_RATIOS.map((r) => ({ value: r.value, label: r.label }));
const PALETTE_OPTIONS = BLOCK_PALETTES.map((p) => ({ value: p.value, label: p.label }));
const onLetter = { id: 'style', in: ['letter'] };

export const blocks: EffectDef = {
  id: 'blocks',
  label: '叠加随机方块',
  hint: '按网格随机撒几块色块，可带字母',
  params: [
    { id: 'count', label: '数量', type: 'number', min: 0, max: BLOCK_MAX_COUNT, step: 1, default: 6, hint: '撒几块。0–16，默认 6。' },
    {
      id: 'size',
      label: '尺寸',
      type: 'number',
      min: 1,
      max: BLOCK_MAX_SIZE,
      step: 1,
      default: 4,
      unit: '格',
      hint: '以当前像素尺寸（格子）为单位，是比例里 1 份对应几格：比例 1:2、尺寸 2 就是 2 × 4 格。1–16，默认 4。',
    },
    { id: 'ratio', label: '比例', type: 'select', default: '1:1', options: RATIO_OPTIONS, hint: '块的宽高比，横竖都有；尺寸是其中 1 份对应几格。' },
    { id: 'jitter', label: '大小随机', type: 'boolean', default: false, hint: '打开后每块在 1 格到「尺寸」之间随机取大小，像参考图里大小不一的碎片。' },
    {
      id: 'style',
      label: '样式',
      type: 'select',
      default: 'solid',
      options: [
        { value: 'solid', label: '纯色块' },
        { value: 'letter', label: '色块 + 字母' },
      ],
      hint: '纯色块，或在色块里放一个点阵字母。',
    },
    {
      id: 'letters',
      label: '字母',
      type: 'text',
      default: 'A',
      maxLength: 32,
      placeholder: 'A',
      visibleWhen: onLetter,
      hint: '写一个字就每块都是它，写一串就按顺序轮流放。支持字母、数字与常用符号，块太小放不下时只画色块。',
    },
    { id: 'letterSize', label: '字母大小', type: 'number', min: 20, max: 100, step: 5, default: 60, unit: '%', visibleWhen: onLetter, hint: '字母占块短边的比例。20–100%，默认 60。' },
    {
      id: 'letterColor',
      label: '字母颜色',
      type: 'select',
      default: 'auto',
      options: [
        { value: 'auto', label: '自动对比' },
        { value: 'custom', label: '自定义' },
      ],
      visibleWhen: onLetter,
      hint: '自动对比：浅块配黑字、深块配白字。',
    },
    { id: 'letterHex', label: '字母色值', type: 'color', default: '#000000', visibleWhen: [onLetter, { id: 'letterColor', in: ['custom'] }] },
    { id: 'palette', label: '配色', type: 'select', default: 'white', options: PALETTE_OPTIONS, hint: '方块按顺序轮流取方案里的颜色；下面每一块都能单独改，改了就转为「自定义」。' },
    {
      id: 'colors',
      label: '每块颜色',
      type: 'colors',
      default: '',
      resolve: resolveBlockColors,
      edit: editBlockColor,
      swatchTitle: (i) => `第 ${i + 1} 块`,
      editHint: (p) => (s(p, 'palette', 'white') === 'custom' ? null : '修改后会转为「自定义」配色'),
      hint: '一块一个色块，点开改颜色。',
    },
    { id: 'seed', label: '种子', type: 'number', min: 0, max: 9999, step: 1, default: 1, hint: '换一个数就换一批位置。' },
  ],
  apply(frame, p, ctx) {
    return drawBlocks(frame, layoutBlocks(frame.width, frame.height, p, ctx?.grid), letterStyleOf(p));
  },
};
