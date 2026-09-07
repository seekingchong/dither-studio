import { hash2 } from '../util/random';
import { shapeDistance } from './shapes';

/**
 * 符号网点（`halftone.shape = 'glyph'`）：格子里画的不是同一种形状的放大缩小，而是按明暗从一串符号里挑一个——
 * 亮处是小点、中间调是斜线、暗处是十字与网格，像手绘的图例或打字机敲出来的字符画。
 * 每个符号由几条基本图元拼成（实心圆、圆圈、线段、三角），图元只有两种尺寸参照：
 * `r` 是这一格的网点半径（随明暗变化），"跨格"线段则以半格为单位、两头各多出半像素，让相邻格子的线连成一条。
 * 所有图元都给出有符号距离，渲染与融合沿用网点那一套；SVG 导出用同一张表出 <circle> / <line> / <polygon>。
 */

export type GlyphId =
  | 'blank'
  | 'dot'
  | 'ring'
  | 'dash'
  | 'bar'
  | 'slash'
  | 'backslash'
  | 'x'
  | 'plus'
  | 'hash'
  | 'tri'
  | 'triline'
  | 'four'
  | 'six'
  | 'percent'
  | 'dotslash';

/** 符号表的顺序就是格子里存的编码；0 是「空」，不画 */
export const GLYPH_IDS: readonly GlyphId[] = ['blank', 'dot', 'ring', 'dash', 'bar', 'slash', 'backslash', 'x', 'plus', 'hash', 'tri', 'triline', 'four', 'six', 'percent', 'dotslash'];

export const GLYPH_CODE: Readonly<Record<GlyphId, number>> = Object.fromEntries(GLYPH_IDS.map((id, k) => [id, k])) as Record<GlyphId, number>;

/** 自定义序列里可用的单字符简写 */
export const GLYPH_ALIASES: Readonly<Record<string, GlyphId>> = {
  _: 'blank',
  '.': 'dot',
  o: 'ring',
  '-': 'dash',
  '|': 'bar',
  '/': 'slash',
  '\\': 'backslash',
  x: 'x',
  '+': 'plus',
  '#': 'hash',
  '^': 'tri',
  a: 'triline',
  '4': 'four',
  '6': 'six',
  '%': 'percent',
  '*': 'dotslash',
};

/** 内置的符号序列：从亮到暗 */
export type GlyphRampKind = 'sketch' | 'typewriter' | 'mesh' | 'marks' | 'custom';

export const GLYPH_RAMPS: Readonly<Record<Exclude<GlyphRampKind, 'custom'>, readonly GlyphId[]>> = {
  // 参考图：点阵天空 → 斜线 → 十字 → 网格 → 斜线上的大圆点
  sketch: ['dot', 'slash', 'plus', 'hash', 'dotslash'],
  // 打字机字符画：留白 → 横线 → 4 → 6 → % → 实心点 → 实心三角
  typewriter: ['blank', 'dash', 'four', 'six', 'percent', 'dot', 'tri'],
  // 线格：留白 → 斜线 → 交叉线 → 网格
  mesh: ['blank', 'slash', 'x', 'hash'],
  // 几何记号：留白 → 点 → 圆圈 → 三角框 → 实心三角
  marks: ['blank', 'dot', 'ring', 'triline', 'tri'],
};

/**
 * 解析自定义序列：空格 / 逗号分隔的符号名或单字符简写（`. / + # *`），大小写不限，认不出的跳过；
 * 一个都认不出时退回「草图」那一串。
 */
export function parseGlyphRamp(text: string): GlyphId[] {
  const out: GlyphId[] = [];
  for (const raw of text.split(/[\s,;，；]+/)) {
    if (!raw) continue;
    const tok = raw.toLowerCase();
    if ((GLYPH_IDS as readonly string[]).includes(tok)) out.push(tok as GlyphId);
    else if (GLYPH_ALIASES[tok]) out.push(GLYPH_ALIASES[tok]);
  }
  return out.length > 0 ? out : [...GLYPH_RAMPS.sketch];
}

/** 当前设置下用的那一串符号 */
export function resolveGlyphRamp(kind: GlyphRampKind, custom: string): GlyphId[] {
  return kind === 'custom' ? parseGlyphRamp(custom) : [...GLYPH_RAMPS[kind]];
}

/**
 * 图元。坐标单位：`c` / `o` / `s` 以网点半径 r 为 1（格子 100% 时 r 是半格）；
 * `S` 是跨格线段，以半格为 1，两头各多出半像素盖住格间接缝。三角用网点形状里那个等边三角（尖朝上）。
 */
type Prim =
  | { k: 'c'; x: number; y: number; r: number }
  | { k: 'o'; x: number; y: number; r: number }
  | { k: 's'; x1: number; y1: number; x2: number; y2: number }
  | { k: 'S'; x1: number; y1: number; x2: number; y2: number }
  | { k: 't' }
  | { k: 'T' };

const SLASH: Prim = { k: 'S', x1: -1, y1: 1, x2: 1, y2: -1 };
const BACKSLASH: Prim = { k: 'S', x1: -1, y1: -1, x2: 1, y2: 1 };
const DASH: Prim = { k: 'S', x1: -1, y1: 0, x2: 1, y2: 0 };
const BAR: Prim = { k: 'S', x1: 0, y1: -1, x2: 0, y2: 1 };

const GLYPH_PRIMS: Readonly<Record<GlyphId, readonly Prim[]>> = {
  blank: [],
  dot: [{ k: 'c', x: 0, y: 0, r: 1 }],
  ring: [{ k: 'o', x: 0, y: 0, r: 1 }],
  dash: [DASH],
  bar: [BAR],
  slash: [SLASH],
  backslash: [BACKSLASH],
  x: [SLASH, BACKSLASH],
  plus: [
    { k: 's', x1: -1, y1: 0, x2: 1, y2: 0 },
    { k: 's', x1: 0, y1: -1, x2: 0, y2: 1 },
  ],
  hash: [DASH, BAR],
  tri: [{ k: 't' }],
  triline: [{ k: 'T' }],
  // 打字机的 4：斜笔、横笔、竖笔
  four: [
    { k: 's', x1: 0.3, y1: -1, x2: -0.75, y2: 0.35 },
    { k: 's', x1: -0.75, y1: 0.35, x2: 0.8, y2: 0.35 },
    { k: 's', x1: 0.3, y1: -1, x2: 0.3, y2: 1 },
  ],
  // 6：下面一个圈，左侧一笔往右上挑
  six: [
    { k: 'o', x: 0, y: 0.4, r: 0.6 },
    { k: 's', x1: -0.55, y1: 0.2, x2: 0.45, y2: -1 },
  ],
  // %：两个小圈夹一条斜线
  percent: [
    { k: 'o', x: -0.55, y: -0.55, r: 0.4 },
    { k: 'o', x: 0.55, y: 0.55, r: 0.4 },
    { k: 's', x1: 0.6, y1: -1, x2: -0.6, y2: 1 },
  ],
  dotslash: [{ k: 'c', x: 0, y: 0, r: 1 }, SLASH],
};

/** 按编码取图元表 */
const PRIMS_BY_CODE: ReadonlyArray<readonly Prim[]> = GLYPH_IDS.map((id) => GLYPH_PRIMS[id]);

/** 点到线段 AB 的距离 */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const len2 = bax * bax + bay * bay;
  let h = len2 > 0 ? (pax * bax + pay * bay) / len2 : 0;
  h = h < 0 ? 0 : h > 1 ? 1 : h;
  const dx = pax - bax * h;
  const dy = pay - bay * h;
  return Math.sqrt(dx * dx + dy * dy);
}

/** 圆圈的中线半径：外缘落在 r 上，太细时至少留一点 */
const ringRadius = (r: number, hw: number) => Math.max(r - hw, 0.25);

/**
 * 符号距离场。(x, y) 是相对格子中心、沿网格坐标轴的画布像素；r 是这一格的网点半径；
 * hw 是线的半粗；spanX / spanY 是跨格线段的半长（半格 + 半像素）。「空」返回 +∞。
 */
export function glyphDistance(code: number, x: number, y: number, r: number, hw: number, spanX: number, spanY: number): number {
  const prims = PRIMS_BY_CODE[code];
  let d = Infinity;
  for (let n = 0; n < prims.length; n++) {
    const p = prims[n];
    let dd: number;
    switch (p.k) {
      case 'c': {
        const dx = x - p.x * r;
        const dy = y - p.y * r;
        dd = Math.sqrt(dx * dx + dy * dy) - p.r * r;
        break;
      }
      case 'o': {
        const dx = x - p.x * r;
        const dy = y - p.y * r;
        dd = Math.abs(Math.sqrt(dx * dx + dy * dy) - ringRadius(p.r * r, hw)) - hw;
        break;
      }
      case 's':
        dd = segmentDistance(x, y, p.x1 * r, p.y1 * r, p.x2 * r, p.y2 * r) - hw;
        break;
      case 'S':
        dd = segmentDistance(x, y, p.x1 * spanX, p.y1 * spanY, p.x2 * spanX, p.y2 * spanY) - hw;
        break;
      case 't':
        dd = shapeDistance('triangle', x, y, r, 0);
        break;
      case 'T':
        dd = Math.abs(shapeDistance('triangle', x, y, r, 0)) - hw;
        break;
    }
    if (dd < d) d = dd;
  }
  return d;
}

/** 两位小数，去掉 -0 与多余的 0 */
const f = (n: number) => {
  const s = (Math.round(n * 100) / 100).toString();
  return s === '-0' ? '0' : s;
};

/**
 * 符号的 SVG 图元：填充图形直接继承所在 <g> 的 fill；描边图形带 `fill="none"` 加 stroke，
 * 线粗与圆头写在 <g> 上。`fill` / `stroke` 是要附在元素上的属性串（原图色模式每颗点各自带色），可为空。
 */
export function glyphSvg(code: number, cx: number, cy: number, r: number, hw: number, spanX: number, spanY: number, fill: string, stroke: string): string[] {
  const out: string[] = [];
  for (const p of PRIMS_BY_CODE[code]) {
    switch (p.k) {
      case 'c':
        out.push(`<circle cx="${f(cx + p.x * r)}" cy="${f(cy + p.y * r)}" r="${f(p.r * r)}"${fill}/>`);
        break;
      case 'o':
        out.push(`<circle cx="${f(cx + p.x * r)}" cy="${f(cy + p.y * r)}" r="${f(ringRadius(p.r * r, hw))}" fill="none"${stroke}/>`);
        break;
      case 's':
        out.push(`<line x1="${f(cx + p.x1 * r)}" y1="${f(cy + p.y1 * r)}" x2="${f(cx + p.x2 * r)}" y2="${f(cy + p.y2 * r)}"${stroke}/>`);
        break;
      case 'S':
        out.push(`<line x1="${f(cx + p.x1 * spanX)}" y1="${f(cy + p.y1 * spanY)}" x2="${f(cx + p.x2 * spanX)}" y2="${f(cy + p.y2 * spanY)}"${stroke}/>`);
        break;
      case 't':
      case 'T': {
        const top = (2 * r) / Math.sqrt(3);
        const base = r / Math.sqrt(3);
        const points = `${f(cx)},${f(cy - top)} ${f(cx + r)},${f(cy + base)} ${f(cx - r)},${f(cy + base)}`;
        out.push(p.k === 't' ? `<polygon points="${points}"${fill}/>` : `<polygon points="${points}" fill="none"${stroke}/>`);
        break;
      }
    }
  }
  return out;
}

/** 明暗档：墨量 0..1 落在 n 档里的第几档（0 最亮）；jitter 给交界处加一点随机，最多挪半档 */
export function glyphBand(coverage: number, n: number, jitter: number, noise: number): number {
  const c = coverage + (noise - 0.5) * jitter * (1 / n);
  const band = Math.floor(c * n);
  return band < 0 ? 0 : band >= n ? n - 1 : band;
}

/** 点缀符号：交界处的概率是密度本身，成片区域里只留三成，免得铺满 */
export const ACCENT_INTERIOR = 0.3;
/** 点缀符号至少占格子多大（相对「网点大小」），亮处的小点旁边才看得出它是个圈 */
export const ACCENT_MIN_SIZE = 0.6;
const ACCENT_CODES = [GLYPH_CODE.ring, GLYPH_CODE.triline];

export interface GlyphAssignOptions {
  ramp: readonly GlyphId[];
  /** 交界混合 0..1 */
  mix: number;
  /** 点缀符号密度 0..1 */
  accent: number;
  seed: number;
  /** 「网点大小」，点缀符号按它的一定比例撑大 */
  size: number;
}

/**
 * 给一张网格的每个格子挑符号：按（加过增益的）墨量分档取序列里的那一个，交界处按 mix 随机互换；
 * 再按密度撒圆圈 / 三角框做点缀——多落在两档交界的格子上，「空」档上不撒。
 * `coverage` 每格一个墨量，−1 表示这一格没采到画面；`size` 是每格网点大小，点缀的格子会被撑大。
 * 用绝对格坐标 (i, j) 做哈希，画布变大、网格挪动时已有格子的符号不变。
 */
export function assignGlyphs(
  cells: { cols: number; rows: number; i0: number; j0: number },
  coverage: Float32Array,
  size: Float32Array,
  opts: GlyphAssignOptions,
): Uint8Array {
  const { cols, rows, i0, j0 } = cells;
  const n = opts.ramp.length;
  const codes = opts.ramp.map((id) => GLYPH_CODE[id]);
  const band = new Int16Array(cols * rows).fill(-1);
  for (let jj = 0; jj < rows; jj++) {
    for (let ii = 0; ii < cols; ii++) {
      const k = jj * cols + ii;
      const c = coverage[k];
      if (c < 0) continue;
      const noise = opts.mix > 0 ? hash2(i0 + ii, j0 + jj, opts.seed) : 0.5;
      band[k] = glyphBand(c, n, opts.mix, noise);
    }
  }
  const glyph = new Uint8Array(cols * rows);
  const blank = GLYPH_CODE.blank;
  for (let jj = 0; jj < rows; jj++) {
    for (let ii = 0; ii < cols; ii++) {
      const k = jj * cols + ii;
      const b = band[k];
      if (b < 0) continue;
      let code = codes[b];
      if (opts.accent > 0 && code !== blank) {
        const differs = (kk: number) => band[kk] >= 0 && band[kk] !== b;
        const boundary = (ii > 0 && differs(k - 1)) || (ii < cols - 1 && differs(k + 1)) || (jj > 0 && differs(k - cols)) || (jj < rows - 1 && differs(k + cols));
        const p = opts.accent * (boundary ? 1 : ACCENT_INTERIOR);
        if (hash2(i0 + ii, j0 + jj, opts.seed + 101) < p) {
          code = ACCENT_CODES[hash2(i0 + ii, j0 + jj, opts.seed + 202) < 0.5 ? 0 : 1];
          size[k] = Math.max(size[k], opts.size * ACCENT_MIN_SIZE);
        }
      }
      glyph[k] = code;
    }
  }
  return glyph;
}
