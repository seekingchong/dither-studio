import { createScreen, sampleScreen, type HalftoneGeometry, type HalftoneSource, type ScreenLayout } from './geometry';
import { ACCENT_MIN_SIZE, assignGlyphs, GLYPH_CODE, glyphCoverage, type GlyphId } from './glyphs';

/**
 * 「符号」风格（`style.type = glyph`）：网点用点的大小区分灰度，这里用格子里画的**形状**区分——
 * 画面按明暗均分成 2–8 阶，每一阶配一种符号（和一种颜色），亮的阶配墨少的符号（小点、短横），暗的阶配墨多的（网格、实心块）。
 * 网格、采样、扰动、光栅与 SVG 都沿用网点那一套（`HalftoneGeometry`），每格多存一个符号编码。
 */

export type RGB = [number, number, number];

/** 推荐序列（`GLYPH_RAMPS`）或自定义：自定义时每一阶的符号由 `shapes` 给出 */
export type GlyphRampKind = 'sketch' | 'typewriter' | 'mesh' | 'marks' | 'geometric' | 'ascii' | 'letters' | 'dots' | 'custom';

export type GlyphColorMode = 'mono' | 'levels' | 'source';

export const GLYPH_MIN_LEVELS = 2;
export const GLYPH_MAX_LEVELS = 8;

/**
 * 推荐序列：每套是 GLYPH_MAX_LEVELS 个风格统一的符号，`rampFor` 按墨量（`glyphCoverage`）从少到多排好，
 * 再按阶数等距抽取——亮的阶配墨少的符号，暗的阶配墨多的。这里写的顺序只在墨量相同时起作用。
 * 老的「符号网点」两套预设（Symbol Sketch / Typewriter）按参考图排的顺序不完全是墨量序，它们存成自定义序列。
 */
export const GLYPH_RAMPS: Readonly<Record<Exclude<GlyphRampKind, 'custom'>, readonly GlyphId[]>> = {
  // 手绘排线：短竖 → 短横 → 斜线 → 反斜线 → 十字 → 网格 → 八芒 → 密网
  sketch: ['tick', 'minus', 'slash', 'backslash', 'plus', 'hash', 'star8', 'hashx'],
  // 打字机字符画：留白 → 横线 → 7 → 6 → 4 → % → 三角 → 圆点
  typewriter: ['blank', 'dash', 'seven', 'six', 'four', 'percent', 'tri', 'dot'],
  // 线格：留白 → 短横 → 斜线 → 十字 → 双横 → 网格 → 叉 → 密网
  mesh: ['blank', 'minus', 'slash', 'plus', 'equals', 'hash', 'x', 'hashx'],
  // 记号：留白 → 小点 → 圆圈 → 三角框 → 实心三角 → 靶心 → 实心方 → 圆点
  marks: ['blank', 'pip', 'ring', 'triline', 'tri', 'ringdot', 'square', 'dot'],
  // 几何：留白 → 菱框 → 方框 → 实心菱 → 田 → 叉框 → 六边形 → 实心方
  geometric: ['blank', 'diamondline', 'squareline', 'diamond', 'boxplus', 'boxx', 'hex', 'square'],
  // 字符画的经典梯度 " .:+=#*"，再加八芒
  ascii: ['blank', 'pip', 'colon', 'plus', 'equals', 'hash', 'asterisk', 'star8'],
  // 字母：笔画越多越暗
  letters: ['blank', 'one', 'tee', 'vee', 'zed', 'en', 'ee', 'em'],
  // 点阵：留白 → 小点 → 双点 → 四点 → 圆圈 → 靶心 → 圆点 → 点线
  dots: ['blank', 'pip', 'colon', 'quad', 'ring', 'ringdot', 'dot', 'dotslash'],
};

export const GLYPH_RAMP_KINDS: ReadonlyArray<{ id: GlyphRampKind; label: string }> = [
  { id: 'sketch', label: '草图' },
  { id: 'typewriter', label: '打字机' },
  { id: 'mesh', label: '线格' },
  { id: 'marks', label: '记号' },
  { id: 'geometric', label: '几何' },
  { id: 'ascii', label: '字符' },
  { id: 'letters', label: '字母' },
  { id: 'dots', label: '点阵' },
  { id: 'custom', label: '自定义' },
];

export const clampLevels = (n: number) => Math.min(GLYPH_MAX_LEVELS, Math.max(GLYPH_MIN_LEVELS, Math.round(n)));

/** 一套符号按墨量从少到多排（稳定排序，墨量相同保持原顺序） */
export function sortByCoverage(ids: readonly GlyphId[]): GlyphId[] {
  return ids
    .map((id, k) => ({ id, k, c: glyphCoverage(GLYPH_CODE[id]) }))
    .sort((a, b) => a.c - b.c || a.k - b.k)
    .map((e) => e.id);
}

/** 某套推荐序列在 n 阶下用的符号：8 个按墨量排好后等距抽 n 个，最亮与最暗那两个总在 */
export function rampFor(kind: Exclude<GlyphRampKind, 'custom'>, levels: number): GlyphId[] {
  const full = sortByCoverage(GLYPH_RAMPS[kind]);
  const n = clampLevels(levels);
  const last = full.length - 1;
  const out: GlyphId[] = [];
  for (let i = 0; i < n; i++) out.push(full[Math.round((i * last) / (n - 1))]);
  return out;
}

export interface GlyphSettings extends ScreenLayout {
  ramp: GlyphRampKind;
  /** 灰阶级数 2..8 */
  levels: number;
  /** 自定义时每一阶的符号（从亮到暗），至少 GLYPH_MAX_LEVELS 个，只用前 levels 个 */
  shapes: readonly GlyphId[];
  /** 符号大小，相对格子 0..1.5（100% = 刚好占满格子） */
  size: number;
  /** 亮部缩小 0..1：最亮一阶的符号缩到 size × (1 − taper)，往暗处逐阶放大到 size；0 就是所有阶一样大 */
  taper: number;
  /** 线粗，占格子短边 0..1 */
  stroke: number;
  /** 交界混合 0..1 */
  mix: number;
  /** 点缀密度 0..1 */
  accent: number;
  seed: number;
  antialias: boolean;
  colorMode: GlyphColorMode;
  /** 统一色 */
  ink: RGB;
  /** 分级配色：每一阶的颜色（从亮到暗），至少 GLYPH_MAX_LEVELS 个 */
  colors: readonly RGB[];
  paper: RGB;
}

/** 分级配色的默认色：从浅灰蓝到墨蓝，与网点的默认墨色一家 */
export const DEFAULT_LEVEL_COLORS: readonly RGB[] = [
  [184, 192, 204],
  [154, 163, 178],
  [124, 135, 152],
  [95, 107, 126],
  [69, 79, 99],
  [46, 55, 74],
  [29, 36, 54],
  [17, 25, 45],
];

export const DEFAULT_GLYPH: GlyphSettings = {
  ramp: 'sketch',
  levels: 5,
  shapes: GLYPH_RAMPS.sketch,
  size: 0.8,
  taper: 0,
  stroke: 0.12,
  mix: 0.35,
  accent: 0.05,
  seed: 1,
  antialias: true,
  pitchX: 12,
  pitchY: 12,
  angle: 0,
  lattice: 'square',
  offsetX: 0,
  offsetY: 0,
  warp: 'none',
  warpAmount: 0.4,
  warpScale: 12,
  warpSeed: 1,
  colorMode: 'mono',
  ink: [17, 17, 17],
  colors: DEFAULT_LEVEL_COLORS,
  paper: [255, 255, 255],
};

/** 当前设置下每一阶用的符号：推荐序列按阶数抽取，自定义取存下来的那几个（不够就用最后一个补） */
export function resolveGlyphRamp(opts: Pick<GlyphSettings, 'ramp' | 'levels' | 'shapes'>): GlyphId[] {
  const n = clampLevels(opts.levels);
  if (opts.ramp !== 'custom') return rampFor(opts.ramp, n);
  const out: GlyphId[] = [];
  for (let i = 0; i < n; i++) out.push(opts.shapes[i] ?? opts.shapes[opts.shapes.length - 1] ?? 'dot');
  return out;
}

/** 每一阶的符号大小（相对格子）：亮部按 taper 缩小，暗部是 size */
export function levelSizes(size: number, taper: number, levels: number): number[] {
  const n = clampLevels(levels);
  const t = Math.min(1, Math.max(0, taper));
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push(size * (1 - t * (1 - k / (n - 1))));
  return out;
}

/** 每一阶的颜色；原图色模式没有固定颜色，返回 null */
export function resolveLevelColors(opts: Pick<GlyphSettings, 'colorMode' | 'levels' | 'ink' | 'colors'>): RGB[] | null {
  const n = clampLevels(opts.levels);
  if (opts.colorMode === 'source') return null;
  if (opts.colorMode === 'mono') return Array.from({ length: n }, () => opts.ink);
  const out: RGB[] = [];
  for (let i = 0; i < n; i++) out.push(opts.colors[i] ?? opts.colors[opts.colors.length - 1] ?? opts.ink);
  return out;
}

/** 第 k 阶（0 最亮）代表的亮度 0..1：这一阶覆盖的墨量区间的中点 */
export function levelGray(k: number, levels: number): number {
  const n = clampLevels(levels);
  return 1 - (k + 0.5) / n;
}

/** 一套序列的墨量是否从亮到暗单调不减（推荐序列都满足；自定义的随便） */
export function rampIsMonotonic(ramp: readonly GlyphId[]): boolean {
  for (let k = 1; k < ramp.length; k++) if (glyphCoverage(GLYPH_CODE[ramp[k]]) < glyphCoverage(GLYPH_CODE[ramp[k - 1]])) return false;
  return true;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * 从采样源与选项算出符号网格：每格采样墨量 → 分成 levels 阶 → 这一阶的符号、大小与颜色。
 * 出来的是网点那套几何（shape = 'glyph'），光栅与 SVG 直接吃。
 */
export function buildGlyphScreen(src: HalftoneSource, opts: GlyphSettings): HalftoneGeometry {
  const { width, height } = src;
  const { screen, t } = createScreen(width, height, opts, opts.ink);
  const n = screen.cols * screen.rows;
  const coverage = new Float32Array(n).fill(-1);
  const wantSource = opts.colorMode === 'source';
  const levelColors = resolveLevelColors(opts);
  if (wantSource || opts.colorMode === 'levels') screen.color = new Uint8ClampedArray(n * 3);
  sampleScreen(src, t, opts.lattice, screen, wantSource, (index, gray, r, g, b) => {
    coverage[index] = clamp01(1 - gray);
    if (wantSource && screen.color) {
      screen.color[index * 3] = r * 255;
      screen.color[index * 3 + 1] = g * 255;
      screen.color[index * 3 + 2] = b * 255;
    }
  });

  const ramp = resolveGlyphRamp(opts);
  const { glyph, band, accent } = assignGlyphs(screen, coverage, { ramp, mix: opts.mix, accent: opts.accent, seed: opts.seed });
  const sizes = levelSizes(opts.size, opts.taper, ramp.length);
  const perLevel = opts.colorMode === 'levels' && levelColors ? levelColors : null;
  for (let k = 0; k < n; k++) {
    const b = band[k];
    if (b < 0) continue;
    // 点缀符号至少撑到符号大小的六成，亮处的小点旁边才看得出它是个圈
    screen.size[k] = accent[k] ? Math.max(sizes[b], opts.size * ACCENT_MIN_SIZE) : sizes[b];
    if (perLevel && screen.color) {
      const c = perLevel[b];
      screen.color[k * 3] = c[0];
      screen.color[k * 3 + 1] = c[1];
      screen.color[k * 3 + 2] = c[2];
    }
  }
  screen.glyph = glyph;

  return {
    width,
    height,
    shape: 'glyph',
    mode: wantSource ? 'source' : 'mono',
    paper: opts.paper,
    merge: 0,
    antialias: opts.antialias,
    glyphStroke: opts.stroke,
    screens: [screen],
  };
}
