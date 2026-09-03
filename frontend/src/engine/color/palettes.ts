import { hexToRgb } from './srgb';

export interface PaletteDef {
  id: string;
  label: string;
  colors: string[];
}

/** 预设调色板（PRD：Game Boy、CGA、EGA、C64、ZX Spectrum、NES、PICO-8、DB16/32、Apple II、Mac 1-bit、Web Safe、灰阶） */
export const PALETTE_PRESETS: PaletteDef[] = [
  { id: 'gameboy', label: 'Game Boy', colors: ['#0F380F', '#306230', '#8BAC0F', '#9BBC0F'] },
  { id: 'gameboy-pocket', label: 'Game Boy Pocket', colors: ['#000000', '#555555', '#AAAAAA', '#FFFFFF'] },
  { id: 'cga0', label: 'CGA 0', colors: ['#000000', '#00AA00', '#AA0000', '#AA5500'] },
  { id: 'cga1', label: 'CGA 1', colors: ['#000000', '#55FFFF', '#FF55FF', '#FFFFFF'] },
  {
    id: 'ega',
    label: 'EGA',
    colors: ['#000000', '#0000AA', '#00AA00', '#00AAAA', '#AA0000', '#AA00AA', '#AA5500', '#AAAAAA', '#555555', '#5555FF', '#55FF55', '#55FFFF', '#FF5555', '#FF55FF', '#FFFF55', '#FFFFFF'],
  },
  {
    id: 'c64',
    label: 'C64',
    colors: ['#000000', '#FFFFFF', '#880000', '#AAFFEE', '#CC44CC', '#00CC55', '#0000AA', '#EEEE77', '#DD8855', '#664400', '#FF7777', '#333333', '#777777', '#AAFF66', '#0088FF', '#BBBBBB'],
  },
  {
    id: 'zx',
    label: 'ZX Spectrum',
    colors: ['#000000', '#0000D7', '#D70000', '#D700D7', '#00D700', '#00D7D7', '#D7D700', '#D7D7D7', '#0000FF', '#FF0000', '#FF00FF', '#00FF00', '#00FFFF', '#FFFF00', '#FFFFFF'],
  },
  {
    id: 'nes',
    label: 'NES',
    colors: [
      '#7C7C7C', '#0000FC', '#0000BC', '#4428BC', '#940084', '#A80020', '#A81000', '#881400', '#503000', '#007800', '#006800', '#005800', '#004058', '#000000',
      '#BCBCBC', '#0078F8', '#0058F8', '#6844FC', '#D800CC', '#E40058', '#F83800', '#E45C10', '#AC7C00', '#00B800', '#00A800', '#00A844', '#008888',
      '#F8F8F8', '#3CBCFC', '#6888FC', '#9878F8', '#F878F8', '#F85898', '#F87858', '#FCA044', '#F8B800', '#B8F818', '#58D854', '#58F898', '#00E8D8', '#787878',
      '#FCFCFC', '#A4E4FC', '#B8B8F8', '#D8B8F8', '#F8B8F8', '#F8A4C0', '#F0D0B0', '#FCE0A8', '#F8D878', '#D8F878', '#B8F8B8', '#B8F8D8', '#00FCFC', '#F8D8F8',
    ],
  },
  {
    id: 'pico8',
    label: 'PICO-8',
    colors: ['#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#5F574F', '#C2C3C7', '#FFF1E8', '#FF004D', '#FFA300', '#FFEC27', '#00E436', '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA'],
  },
  {
    id: 'db16',
    label: 'DB16',
    colors: ['#140C1C', '#442434', '#30346D', '#4E4A4E', '#854C30', '#346524', '#D04648', '#757161', '#597DCE', '#D27D2C', '#8595A1', '#6DAA2C', '#D2AA99', '#6DC2CA', '#DAD45E', '#DEEED6'],
  },
  {
    id: 'db32',
    label: 'DB32',
    colors: [
      '#000000', '#222034', '#45283C', '#663931', '#8F563B', '#DF7126', '#D9A066', '#EEC39A', '#FBF236', '#99E550', '#6ABE30', '#37946E', '#4B692F', '#524B24', '#323C39', '#3F3F74',
      '#306082', '#5B6EE1', '#639BFF', '#5FCDE4', '#CBDBFC', '#FFFFFF', '#9BADB7', '#847E87', '#696A6A', '#595652', '#76428A', '#AC3232', '#D95763', '#D77BBA', '#8F974A', '#8A6F30',
    ],
  },
  {
    id: 'apple2',
    label: 'Apple II',
    colors: ['#000000', '#DD0033', '#000099', '#DD22DD', '#007722', '#555555', '#2222FF', '#66AAFF', '#885500', '#FF6600', '#AAAAAA', '#FF9988', '#11DD00', '#FFFF00', '#44FF99', '#FFFFFF'],
  },
  { id: 'mac', label: 'Mac 1-bit', colors: ['#000000', '#FFFFFF'] },
  { id: 'websafe', label: 'Web Safe', colors: buildWebSafe() },
  { id: 'gray4', label: '灰阶 4', colors: grayRamp(4) },
  { id: 'gray8', label: '灰阶 8', colors: grayRamp(8) },
  { id: 'gray16', label: '灰阶 16', colors: grayRamp(16) },
];

function buildWebSafe(): string[] {
  const out: string[] = [];
  const steps = ['00', '33', '66', '99', 'CC', 'FF'];
  for (const r of steps) for (const g of steps) for (const b of steps) out.push(`#${r}${g}${b}`);
  return out;
}

export function grayRamp(n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const v = Math.round((i / (n - 1)) * 255).toString(16).padStart(2, '0').toUpperCase();
    return `#${v}${v}${v}`;
  });
}

/** 解析用户输入的颜色列表："#RRGGBB" 用空格 / 逗号 / 换行分隔，支持 #RGB 与无 # 前缀 */
export function parseColorList(text: string): string[] {
  const out: string[] = [];
  for (const tok of text.split(/[\s,;，；]+/)) {
    if (!tok) continue;
    const m = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(tok.split(':')[0]);
    if (!m) continue;
    const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
    out.push(`#${h.toUpperCase()}`);
  }
  return out;
}

/** 可运行的调色板：颜色（0..1 sRGB）、按亮度排序的索引、最近色查找 */
export interface Palette {
  size: number;
  /** size × 3，0..1 sRGB，按亮度升序 */
  colors: Float32Array;
  /** 各色亮度 0..1，升序 */
  luminance: Float32Array;
  /** 相邻色平均亮度间隔，用作有序抖动的扩散幅度 */
  lumGap: number;
  nearest(r: number, g: number, b: number): number;
}

function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const paletteCache = new Map<string, Palette>();

export function buildPalette(hexColors: string[]): Palette {
  const key = hexColors.join(',');
  const hit = paletteCache.get(key);
  if (hit) return hit;
  const unique = Array.from(new Set(hexColors.map((h) => h.toUpperCase())));
  const list = (unique.length > 0 ? unique : ['#000000', '#FFFFFF']).map((h) => hexToRgb(h).map((v) => v / 255) as [number, number, number]);
  list.sort((a, b) => luma(...a) - luma(...b));
  const size = list.length;
  const colors = new Float32Array(size * 3);
  const luminance = new Float32Array(size);
  list.forEach(([r, g, b], i) => {
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
    luminance[i] = luma(r, g, b);
  });
  const lumGap = size > 1 ? (luminance[size - 1] - luminance[0]) / (size - 1) : 1;

  // Web Safe 是 6×6×6 的可分离网格，逐通道取整即最近色
  const isWebSafe = size === 216 && key === buildWebSafe().join(',');
  let nearest: Palette['nearest'];
  if (isWebSafe) {
    const index = new Map<string, number>();
    list.forEach(([r, g, b], i) => index.set(`${Math.round(r * 5)},${Math.round(g * 5)},${Math.round(b * 5)}`, i));
    nearest = (r, g, b) => {
      const q = (v: number) => Math.max(0, Math.min(5, Math.round(v * 5)));
      return index.get(`${q(r)},${q(g)},${q(b)}`) ?? 0;
    };
  } else {
    nearest = (r, g, b) => {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0, j = 0; i < size; i++, j += 3) {
        const dr = r - colors[j];
        const dg = g - colors[j + 1];
        const db = b - colors[j + 2];
        // 亮度加权的欧氏距离（2:4:3）
        const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    };
  }
  const palette: Palette = { size, colors, luminance, lumGap: Math.max(lumGap, 1e-3), nearest };
  if (paletteCache.size > 32) paletteCache.clear();
  paletteCache.set(key, palette);
  return palette;
}

export function getPresetPalette(id: string): PaletteDef | undefined {
  return PALETTE_PRESETS.find((p) => p.id === id);
}

/** 解析调色板参数：预设 id 或自定义颜色文本 */
export function resolvePalette(presetId: string, customText: string): Palette {
  if (presetId === 'custom') {
    const colors = parseColorList(customText);
    return buildPalette(colors.length >= 2 ? colors : ['#000000', '#FFFFFF']);
  }
  return buildPalette((getPresetPalette(presetId) ?? PALETTE_PRESETS[0]).colors);
}
