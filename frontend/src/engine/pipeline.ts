import type { Params } from '@/params';
import { applyAccent } from './color/accent';
import { rgbToCmyk } from './color/cmyk';
import { toGray } from './color/gray';
import { buildLevelPalette, combineChannels, mapLevels, mapPaletteIndices } from './color/map';
import { resolvePalette, type Palette } from './color/palettes';
import { linearToSrgb, srgbToLinearFast } from './color/srgb';
import { colorDither } from './dither/color';
import { resolveAlgorithm } from './dither/registry';
import type { AlgorithmDef, DitherInput } from './dither/types';
import { applyEffects, parseStack } from './effects/stack';
import { toneMapOf } from './effects/tone';
import type { EffectInstance, GridUnit, RGBTriple, ToneBins, ToneMap } from './effects/types';
import { gridUnitOf, keyOf, keyOfExcept, toPipelineOptions, type PipelineOptions } from './options';
import { backgroundMask, backgroundTarget, forceBackgroundGray, forceBackgroundRgb, isLightBackground } from './preprocess/background';
import { fitFrame } from './preprocess/fit';
import { pixelate } from './preprocess/pixelate';
import { applyThresholdBias, applyTone, thresholdBias } from './preprocess/tone';
import { renderGrid } from './render/grid';
import { quantizeHatch, renderHatch, type HatchOptions } from './render/hatch';
import { buildHalftone, CELL_SAMPLES, type HalftoneGeometry, type HalftoneSource } from './halftone/geometry';
import { buildGlyphScreen } from './halftone/glyphScreen';
import { renderHalftone } from './halftone/render';
import { orderedDitherGpu } from './gpu/orderedGpu';
import { renderGridGpu } from './gpu/gridGpu';
import { renderHatchGpu } from './gpu/hatchGpu';
import { getMatrix } from './dither/ordered';
import { num, str } from '@/params';
import type { CellFrame, GrayFrame, LevelFrame, RGBAFrame, RGBFrame } from './types';

interface Cached<T> {
  key: string;
  value: T;
}

/** 本次运行的强制背景状态：蒙版 + 极性 + 密度 / 强度 */
interface BackgroundState {
  mask: Uint8Array;
  light: boolean;
  density: number;
  strength: number;
}

export interface PipelineStats {
  /** 本次实际重算的阶段 */
  recomputed: string[];
  elapsedMs: number;
  /** 本次是否有阶段走了 WebGL */
  gpu: boolean;
}

/** 排线风格最近一次的分档结果与几何，供矢量导出直接出笔画 */
export interface HatchState {
  levels: LevelFrame;
  /** 画布尺寸 */
  width: number;
  height: number;
  sx: number;
  sy: number;
  offsetX: number;
  offsetY: number;
  opts: HatchOptions;
}

/** 最近一次运行的特效栈与它拿到的网格（矢量导出补画方块用） */
export interface EffectsState {
  stack: EffectInstance[];
  grid: GridUnit;
}

/** 网点 / 符号风格的采样倍率：格子短边上留 CELL_SAMPLES 个采样点，再小就不缩了 */
export function halftoneSampleSize(pitchX: number, pitchY: number): number {
  return Math.max(1, Math.floor(Math.min(pitchX, pitchY) / CELL_SAMPLES));
}

/** 网点 / 符号这两种"网格风格"各自的一套阶段缓存：切风格来回不互相冲掉 */
class ScreenCache {
  pixelated?: Cached<RGBFrame>;
  toned?: Cached<RGBFrame>;
  gray?: Cached<GrayFrame>;
  bgMask?: Cached<Uint8Array>;
  forced?: Cached<GrayFrame>;
  geometry?: Cached<HalftoneGeometry>;
  rendered?: Cached<RGBAFrame>;

  clear() {
    this.pixelated = this.toned = this.gray = this.bgMask = this.forced = this.geometry = this.rendered = undefined;
  }
}

/** 一种网格风格怎么跑：用哪套缓存、格距多大、哪些参数前缀进几何键、几何怎么算、几何阶段在统计里叫什么 */
interface ScreenSpec {
  cache: ScreenCache;
  pitchX: number;
  pitchY: number;
  prefixes: string[];
  build(src: HalftoneSource): HalftoneGeometry;
  stage: string;
  /** 这种风格自己怎么分阶，交给特效阶段的明暗分布沿用 */
  bins: ToneBins;
}

/** 一次运行里各阶段共享的记账 */
interface RunContext {
  recomputed: string[];
  gpu: boolean;
}

/**
 * 流水线：源帧 → 适配画布 → 像素化 → 影调 → 灰度 → 阈值偏置 → 强制背景 → 按风格分岔：
 *   抖动：抖动 → 颜色映射 → Accent → 网格渲染
 *   排线：明暗分档 → 笔画渲染
 * → 特效栈。
 * 网点 / 符号风格在「适配画布」之后就分岔（`runScreen`）：按网格间距缩小 → 影调 → 灰度 → 阈值偏置 → 强制背景 → 逐格采样成网格几何 → 光栅渲染，
 * 各自一套缓存，切风格来回不互相冲掉，特效栈共用。
 * 每个阶段按"上游键 + 本阶段参数"缓存，参数没变的阶段直接复用。
 * 两种风格共用前半段（像素化的格子在抖动下是像素尺寸的方格，排线下是横纵间距的长方格），影调调整对两边一样生效。
 * 强制背景的蒙版按像素化结果算（与影调无关），替换发生在阈值偏置之后，所以背景点密度不随阈值滑块漂移。
 * 颜色映射按模式分三条路：亮度路径（单色 / 灰阶 / Tint / 深度错配）、真彩调色板路径、分通道路径。
 */
export class Pipeline {
  private fitted?: Cached<RGBAFrame>;
  private pixelated?: Cached<RGBFrame>;
  private toned?: Cached<RGBFrame>;
  private gray?: Cached<GrayFrame>;
  private biased?: Cached<GrayFrame>;
  private bgMask?: Cached<Uint8Array>;
  private forced?: Cached<GrayFrame>;
  private levels?: Cached<LevelFrame>;
  private cells?: Cached<CellFrame>;
  private channels?: Cached<LevelFrame[]>;
  private rendered?: Cached<RGBAFrame>;
  private effected?: Cached<RGBAFrame>;
  /** 最近一次运行的特效栈与它拿到的网格 */
  private effects?: EffectsState;
  private hatch?: HatchState;
  /** 抖动风格最近一次的纸色（最亮一级）与墨色（最暗一级），交给特效栈分前景 / 背景 */
  private ditherColors: { paper: RGBTriple; ink: RGBTriple } = { paper: [255, 255, 255], ink: [0, 0, 0] };
  private ht = new ScreenCache();
  private gl = new ScreenCache();
  /** 最近一次运行走的是哪种风格 */
  private lastStyle: PipelineOptions['style'] = 'dither';
  lastStats: PipelineStats = { recomputed: [], elapsedMs: 0, gpu: false };
  /** 允许走 WebGL 路径（由 Worker 按全局设置传入） */
  gpu = true;

  run(source: RGBAFrame, sourceId: string, params: Params): RGBAFrame {
    const t0 = now();
    const ctx: RunContext = { recomputed: [], gpu: false };
    const opts = toPipelineOptions(params);
    this.lastStyle = opts.style;
    const hatch = opts.style === 'hatch';
    // 格子：抖动是像素尺寸的方格，排线是横纵间距的长方格
    const cellW = hatch ? opts.hatch.spacingX : opts.pixel.size;
    const cellH = hatch ? opts.hatch.spacingY : opts.pixel.size;

    const fitKey = `${sourceId}|${keyOf(params, 'canvas.')}`;
    if (this.fitted?.key !== fitKey) {
      this.fitted = { key: fitKey, value: fitFrame(source, opts.canvas.width, opts.canvas.height, opts.canvas.fit) };
      ctx.recomputed.push('fit');
    }

    if (opts.style === 'halftone' || opts.style === 'glyph') {
      const spec: ScreenSpec =
        opts.style === 'halftone'
          ? { cache: this.ht, pitchX: opts.halftone.pitchX, pitchY: opts.halftone.pitchY, prefixes: ['halftone.', 'screen.', 'ink.'], build: (src) => buildHalftone(src, opts.halftone), stage: 'halftone', bins: 'round' }
          : { cache: this.gl, pitchX: opts.glyph.pitchX, pitchY: opts.glyph.pitchY, prefixes: ['glyph.', 'tile.'], build: (src) => buildGlyphScreen(src, opts.glyph), stage: 'glyph', bins: 'floor' };
      const { rendered, tone } = this.runScreen(params, opts, fitKey, ctx, spec);
      const output = this.finish(rendered, this.fitted.value, params, opts, ctx, tone);
      this.lastStats = { recomputed: ctx.recomputed, elapsedMs: now() - t0, gpu: false };
      return output;
    }

    const pixelKey = `${fitKey}|${keyOfExcept(params, ['pixel.size'], 'pixel.')}|cell=${cellW}x${cellH}`;
    if (this.pixelated?.key !== pixelKey) {
      const { method, offsetX, offsetY } = opts.pixel;
      this.pixelated = { key: pixelKey, value: pixelate(this.fitted.value, cellW, method, offsetX, offsetY, cellH) };
      ctx.recomputed.push('pixelate');
    }

    // 阈值、灰度公式、线性空间、强制背景不属于影调阶段，排除在键之外
    const toneKey = `${pixelKey}|${keyOfExcept(params, ['tone.threshold', 'tone.grayFormula', 'tone.linear', 'tone.bg.'], 'tone.')}`;
    if (this.toned?.key !== toneKey) {
      this.toned = { key: toneKey, value: applyTone(this.pixelated.value, opts.tone) };
      ctx.recomputed.push('tone');
    }

    // 排线按"看起来多亮"定粗细，一律在 gamma 空间取灰度；线性光是给抖动用的（抖动后的平均亮度要与原图一致）
    const linear = hatch ? false : opts.tone.linear;
    const grayKey = `${toneKey}|gray=${opts.tone.grayFormula}|linear=${linear}`;
    if (this.gray?.key !== grayKey) {
      this.gray = { key: grayKey, value: toGray(this.toned.value, opts.tone.grayFormula, linear) };
      ctx.recomputed.push('gray');
    }

    const biasedKey = `${grayKey}|threshold=${opts.tone.threshold}`;
    if (this.biased?.key !== biasedKey) {
      this.biased = { key: biasedKey, value: applyThresholdBias(this.gray.value, opts.tone.threshold) };
    }

    // 强制背景：蒙版只看像素化后的颜色与连通性；极性按抖动输入的亮度判断
    const fb = opts.forcedBg;
    let bg: BackgroundState | null = null;
    let bgKey = '';
    if (fb.enabled) {
      const maskKey = `${pixelKey}|${keyOfExcept(params, ['tone.bg.density', 'tone.bg.strength', 'tone.bg.polarity'], 'tone.bg.')}`;
      if (this.bgMask?.key !== maskKey) {
        this.bgMask = { key: maskKey, value: backgroundMask(this.pixelated.value, fb) };
        ctx.recomputed.push('background');
      }
      const mask = this.bgMask.value;
      const light = fb.polarity === 'auto' ? isLightBackground(this.gray.value.data, mask) : fb.polarity === 'light';
      bg = { mask, light, density: fb.density, strength: fb.strength };
      bgKey = `|bg=${keyOf(params, 'tone.bg.')}`;
    }

    const palette = resolvePalette(opts.color.palettePreset, opts.color.paletteCustom);
    const mode = opts.color.mode;

    // 量化输入：阈值偏置后的亮度，开了强制背景则蒙版内换成目标亮度（目标随该路径的级数变化）
    const pathLevels = hatch
      ? opts.hatch.levels
      : mode === 'palette' && !opts.color.mismatch
        ? palette.size
        : mode === 'channels'
          ? opts.color.levels
          : mode === 'palette'
            ? opts.color.paletteLevels
            : opts.color.levels;
    const forcedKey = `${biasedKey}${bgKey}|fb=${pathLevels}`;
    if (this.forced?.key !== forcedKey) {
      this.forced = {
        key: forcedKey,
        value: bg ? forceBackgroundGray(this.biased.value, bg.mask, backgroundTarget(bg.light, bg.density, pathLevels), bg.strength) : this.biased.value,
      };
    }

    // 交给特效阶段的明暗分布：量化前的灰度按格子映射到画布，分阶规则沿用风格自己的（抖动四舍五入、排线等宽分档）
    const bins: ToneBins = hatch ? 'floor' : 'round';
    const tone: Cached<ToneMap> = {
      key: `${forcedKey}|tone=${cellW}x${cellH}@${opts.pixel.offsetX},${opts.pixel.offsetY}|${bins}`,
      value: toneMapOf(this.forced.value, cellW, cellH, opts.pixel.offsetX, opts.pixel.offsetY, bins),
    };

    if (hatch) this.runHatch(params, opts, this.forced.value, forcedKey, ctx);
    else this.runDither(params, opts, palette, bg, bgKey, toneKey, forcedKey, ctx);

    const output = this.finish(this.rendered!, this.fitted.value, params, opts, ctx, tone);
    this.lastStats = { recomputed: ctx.recomputed, elapsedMs: now() - t0, gpu: ctx.gpu };
    return output;
  }

  /**
   * 渲染之后的收尾：特效栈（独立缓存）+ 复制一份输出（输出会被 Worker 转移给主线程，缓存里保留副本）。
   * 特效能拿到适配画布后的原图与当前风格的底色 / 墨色（「叠加原图」靠它们把原图夹在背景与前景之间）、
   * 量化前的明暗分布（「灰度块描边」沿格子边描线）与当前风格的格子（「叠加随机方块」按它对齐）；
   * 渲染键里已经含源帧、画布参数与各风格的颜色，换素材或换帧时特效缓存自然失效，格子另写进键里。
   */
  private finish(rendered: Cached<RGBAFrame>, source: RGBAFrame, params: Params, opts: PipelineOptions, ctx: RunContext, tone: Cached<ToneMap>): RGBAFrame {
    const stackJson = typeof params['effects.stack'] === 'string' ? (params['effects.stack'] as string) : '';
    const grid = gridUnitOf(opts);
    const effectsKey = `${rendered.key}|${tone.key}|grid=${grid.cellW}x${grid.cellH}@${grid.offsetX},${grid.offsetY}|${stackJson}`;
    if (this.effected?.key !== effectsKey) {
      const stack = parseStack(stackJson);
      const { paper, ink } = this.styleColors(opts);
      const value = stack.some((e) => e.enabled) ? applyEffects(rendered.value, stack, { source, tone: tone.value, grid, paper, ink }) : rendered.value;
      this.effected = { key: effectsKey, value };
      this.effects = { stack, grid };
      if (value !== rendered.value) ctx.recomputed.push('effects');
    }
    const cached = this.effected.value;
    return { width: cached.width, height: cached.height, data: new Uint8ClampedArray(cached.data) };
  }

  /**
   * 当前风格成品里的底色（纸）与主墨色：排线 / 网点 / 符号是各自参数里的纸色与墨色，
   * 抖动是颜色映射后最亮与最暗的那一级（网格反向时底是墨、点是纸，对调）。
   */
  private styleColors(opts: PipelineOptions): { paper: RGBTriple; ink: RGBTriple } {
    switch (opts.style) {
      case 'hatch':
        return { paper: opts.hatch.paper, ink: opts.hatch.ink };
      case 'halftone':
        return { paper: opts.halftone.paper, ink: opts.halftone.dot };
      case 'glyph':
        return { paper: opts.glyph.paper, ink: opts.glyph.ink };
      default:
        return opts.grid.invert ? { paper: this.ditherColors.ink, ink: this.ditherColors.paper } : this.ditherColors;
    }
  }

  /**
   * 网点 / 符号：不用 pixel.* 的像素化，而是按网格间距把画面缩到"每格短边上 CELL_SAMPLES 个采样"的分辨率，
   * 影调在这张小图上做，然后每个格子在自己范围里超采样求平均明暗（与颜色），换成网点大小或符号。
   * 强制背景沿用抖动那套蒙版逻辑，只是目标亮度不再按级数取整（网点是连续的）。
   */
  private runScreen(params: Params, opts: PipelineOptions, fitKey: string, ctx: RunContext, spec: ScreenSpec): { rendered: Cached<RGBAFrame>; tone: Cached<ToneMap> } {
    this.hatch = undefined;
    const c = spec.cache;
    const sample = halftoneSampleSize(spec.pitchX, spec.pitchY);
    const pixelKey = `${fitKey}|ht-sample=${sample}`;
    if (c.pixelated?.key !== pixelKey) {
      c.pixelated = { key: pixelKey, value: pixelate(this.fitted!.value, sample, 'box', 0, 0) };
      ctx.recomputed.push('pixelate');
    }

    const toneKey = `${pixelKey}|${keyOfExcept(params, ['tone.threshold', 'tone.grayFormula', 'tone.linear', 'tone.bg.'], 'tone.')}`;
    if (c.toned?.key !== toneKey) {
      // 模糊单位是画布像素，换算成这张小图的像素
      const toneOpts = { ...opts.tone, blur: num(params, 'tone.blur') / sample };
      c.toned = { key: toneKey, value: applyTone(c.pixelated.value, toneOpts) };
      ctx.recomputed.push('tone');
    }

    const grayKey = `${toneKey}|gray=${opts.tone.grayFormula}|linear=${opts.tone.linear}|threshold=${opts.tone.threshold}`;
    if (c.gray?.key !== grayKey) {
      c.gray = { key: grayKey, value: applyThresholdBias(toGray(c.toned.value, opts.tone.grayFormula, opts.tone.linear), opts.tone.threshold) };
      ctx.recomputed.push('gray');
    }

    let gray = c.gray.value;
    let bgKey = '';
    const fb = opts.forcedBg;
    if (fb.enabled) {
      const maskKey = `${pixelKey}|${keyOfExcept(params, ['tone.bg.density', 'tone.bg.strength', 'tone.bg.polarity'], 'tone.bg.')}`;
      if (c.bgMask?.key !== maskKey) {
        c.bgMask = { key: maskKey, value: backgroundMask(c.pixelated.value, fb) };
        ctx.recomputed.push('background');
      }
      const mask = c.bgMask.value;
      const light = fb.polarity === 'auto' ? isLightBackground(gray.data, mask) : fb.polarity === 'light';
      bgKey = `|bg=${keyOf(params, 'tone.bg.')}`;
      const forcedKey = `${grayKey}${bgKey}`;
      if (c.forced?.key !== forcedKey) {
        // 网点大小是连续的，背景目标亮度就是 1 − 密度（或密度），不按级数取整
        c.forced = { key: forcedKey, value: forceBackgroundGray(gray, mask, backgroundTarget(light, fb.density, 2), fb.strength) };
      }
      gray = c.forced.value;
    }
    // 交给特效阶段的明暗分布：这张小图一像素就是画布上 sample × sample 的一块
    const tone: Cached<ToneMap> = { key: `${grayKey}${bgKey}|tone=${sample}|${spec.bins}`, value: toneMapOf(gray, sample, sample, 0, 0, spec.bins) };

    const geometryKey = `${grayKey}${bgKey}|${keyOf(params, ...spec.prefixes)}|${opts.canvas.width}x${opts.canvas.height}`;
    if (c.geometry?.key !== geometryKey) {
      const src: HalftoneSource = {
        width: opts.canvas.width,
        height: opts.canvas.height,
        sample,
        grayWidth: gray.width,
        grayHeight: gray.height,
        gray: gray.data,
        rgb: c.toned.value.data,
        linear: opts.tone.linear,
      };
      c.geometry = { key: geometryKey, value: spec.build(src) };
      ctx.recomputed.push(spec.stage);
    }

    if (c.rendered?.key !== geometryKey) {
      c.rendered = { key: geometryKey, value: renderHalftone(c.geometry.value) };
      ctx.recomputed.push('render');
    }
    return { rendered: c.rendered, tone };
  }

  /** 最近一次网点 / 符号运行的网格几何（SVG 导出用）；上一次跑的是抖动或排线时为空 */
  get currentHalftone(): HalftoneGeometry | undefined {
    return this.lastStyle === 'halftone' ? this.ht.geometry?.value : this.lastStyle === 'glyph' ? this.gl.geometry?.value : undefined;
  }

  /** 排线：明暗分档 → 笔画渲染 */
  private runHatch(params: Params, opts: PipelineOptions, gray: GrayFrame, forcedKey: string, ctx: RunContext) {
    const h = opts.hatch;
    const key = `${forcedKey}|hatch=${h.levels}/${h.stagger}`;
    if (this.levels?.key !== key) {
      this.levels = { key, value: quantizeHatch(gray, h.levels, h.stagger) };
      ctx.recomputed.push('quantize:hatch');
    }
    const { offsetX, offsetY } = opts.pixel;
    const { width, height } = opts.canvas;
    const renderKey = `${key}|${keyOf(params, 'hatch.')}|${offsetX},${offsetY}|${width}x${height}`;
    if (this.rendered?.key !== renderKey) {
      let frame: RGBAFrame | null = null;
      let gpu = false;
      if (this.gpu) {
        frame = renderHatchGpu(this.levels.value, width, height, h.spacingX, h.spacingY, offsetX, offsetY, h);
        gpu = !!frame;
      }
      if (!frame) frame = renderHatch(this.levels.value, width, height, h.spacingX, h.spacingY, offsetX, offsetY, h);
      this.rendered = { key: renderKey, value: frame };
      ctx.recomputed.push(gpu ? 'render:hatch:gpu' : 'render:hatch');
      if (gpu) ctx.gpu = true;
    }
    this.hatch = { levels: this.levels.value, width, height, sx: h.spacingX, sy: h.spacingY, offsetX, offsetY, opts: h };
  }

  /** 抖动：抖动 → 颜色映射 → Accent → 网格渲染 */
  private runDither(
    params: Params,
    opts: PipelineOptions,
    palette: Palette,
    bg: BackgroundState | null,
    bgKey: string,
    toneKey: string,
    forcedKey: string,
    ctx: RunContext,
  ) {
    this.hatch = undefined;
    const algo = resolveAlgorithm(params);
    const ditherParams = keyOf(params, 'dither.');
    const paletteKey = `${opts.color.palettePreset}:${opts.color.paletteCustom}`;
    const ditherGray = this.forced!.value;
    const { width, height } = ditherGray;
    const mode = opts.color.mode;

    let levelFrame: LevelFrame;
    let cellsKey: string;
    let buildCells: () => CellFrame;
    // 纸色（最亮）与墨色（最暗），供网格渲染的背景与反向使用
    let paper: [number, number, number] = [255, 255, 255];
    let ink: [number, number, number] = [0, 0, 0];
    const pc = palette.colors;
    const paletteInk: [number, number, number] = [pc[0] * 255, pc[1] * 255, pc[2] * 255];
    const paletteEnd = (palette.size - 1) * 3;
    const palettePaper: [number, number, number] = [pc[paletteEnd] * 255, pc[paletteEnd + 1] * 255, pc[paletteEnd + 2] * 255];

    if (mode === 'palette' && !opts.color.mismatch) {
      // 真彩调色板路径：直接在 RGB 上量化到最近色
      const key = `${toneKey}|threshold=${opts.tone.threshold}|palette=${paletteKey}|${ditherParams}|path=color${bgKey}`;
      if (this.levels?.key !== key) {
        const data = this.runColorPath(algo, params, opts, palette, bg);
        this.levels = { key, value: { width, height, levels: palette.size, data } };
        ctx.recomputed.push(`dither:${algo.family}/${algo.id}:palette`);
      }
      levelFrame = this.levels.value;
      cellsKey = `${key}|${keyOf(params, 'color.')}`;
      buildCells = () => mapPaletteIndices(levelFrame.data, width, height, palette);
      paper = palettePaper;
      ink = paletteInk;
    } else if (mode === 'channels') {
      const n = opts.color.levels;
      const key = `${toneKey}|threshold=${opts.tone.threshold}|linear=${opts.tone.linear}|levels=${n}|space=${opts.color.channelSpace}|${ditherParams}|path=channels${bgKey}`;
      let frames: LevelFrame[];
      if (this.channels?.key !== key) {
        frames = this.runChannelPath(algo, params, opts, bg);
        this.channels = { key, value: frames };
        ctx.recomputed.push(`dither:${algo.family}/${algo.id}:channels`);
      } else {
        frames = this.channels.value;
      }
      levelFrame = channelLevelSummary(frames, opts.color.channelSpace);
      cellsKey = `${key}|${keyOf(params, 'color.')}`;
      buildCells = () => combineChannels(frames, opts.color.channelSpace, opts.tone.linear);
    } else {
      // 亮度路径
      const n = mode === 'palette' ? opts.color.paletteLevels : opts.color.levels;
      const key = `${forcedKey}|levels=${n}|${ditherParams}|path=gray`;
      if (this.levels?.key !== key) {
        const input: DitherInput = { width, height, gray: ditherGray.data, levels: n, seed: 0 };
        let data: Uint8Array | null = null;
        let gpu = false;
        if (this.gpu && algo.family === 'ordered') {
          data = orderedDitherGpu(input.gray, width, height, n, getMatrix(str(params, 'dither.ordered.matrix')), {
            scale: num(params, 'dither.ordered.scale'),
            angle: num(params, 'dither.ordered.angle'),
            offsetX: num(params, 'dither.ordered.offsetX'),
            offsetY: num(params, 'dither.ordered.offsetY'),
          });
          gpu = !!data;
        }
        if (!data) data = algo.run(input, params);
        this.levels = { key, value: { width, height, levels: n, data } };
        ctx.recomputed.push(`dither:${algo.family}/${algo.id}${gpu ? ':gpu' : ''}`);
        if (gpu) ctx.gpu = true;
      }
      levelFrame = this.levels.value;
      cellsKey = `${key}|linear=${opts.tone.linear}|${keyOf(params, 'color.')}`;
      const lut = buildLevelPalette({
        mode,
        levels: n,
        linear: opts.tone.linear,
        tintDark: opts.color.tintDark,
        tintLight: opts.color.tintLight,
        tintStops: opts.color.tintStops,
        palette,
        mismatch: opts.color.mismatch,
        channelSpace: opts.color.channelSpace,
      });
      buildCells = () => mapLevels(levelFrame, lut);
      if (mode === 'palette') {
        paper = palettePaper;
        ink = paletteInk;
      } else {
        const last = (n - 1) * 3;
        ink = [lut[0], lut[1], lut[2]];
        paper = [lut[last], lut[last + 1], lut[last + 2]];
      }
    }

    if (this.cells?.key !== cellsKey) {
      let cells = buildCells();
      if (opts.color.accent.enabled) {
        cells = applyAccent(
          cells,
          { width, height, levels: levelFrame.data, levelCount: levelFrame.levels, gray: ditherGray.data },
          opts.color.accent,
        );
      }
      this.cells = { key: cellsKey, value: cells };
      ctx.recomputed.push('color');
    }

    this.ditherColors = { paper, ink };
    const { size, offsetX, offsetY } = opts.pixel;
    const renderKey = `${cellsKey}|${keyOf(params, 'grid.')}|paper=${paper.join()}|ink=${ink.join()}|size=${size}|${offsetX},${offsetY}|${opts.canvas.width}x${opts.canvas.height}`;
    if (this.rendered?.key !== renderKey) {
      const gridOpts = { ...opts.grid, paper, ink };
      const plain = gridOpts.dot === 'square' && !gridOpts.metaball && gridOpts.gapX === 0 && gridOpts.gapY === 0 && gridOpts.background === 'none' && !gridOpts.invert && !gridOpts.dotTone;
      let frame: RGBAFrame | null = null;
      let gpu = false;
      if (this.gpu && !plain) {
        frame = renderGridGpu(this.cells.value, opts.canvas.width, opts.canvas.height, size, offsetX, offsetY, gridOpts);
        gpu = !!frame;
      }
      if (!frame) frame = renderGrid(this.cells.value, opts.canvas.width, opts.canvas.height, size, offsetX, offsetY, gridOpts);
      this.rendered = { key: renderKey, value: frame };
      ctx.recomputed.push(gpu ? 'render:gpu' : 'render');
      if (gpu) ctx.gpu = true;
    }
  }

  /** 真彩路径；算法没有颜色实现时回退到亮度路径并按亮度秩取色 */
  private runColorPath(algo: AlgorithmDef, params: Params, opts: PipelineOptions, palette: Palette, bg: BackgroundState | null): Uint8Array {
    const toned = this.toned!.value;
    const { width, height } = toned;
    const bias = thresholdBias(opts.tone.threshold);
    let rgb = toned.data;
    if (bias !== 0) {
      rgb = new Float32Array(toned.data);
      for (let i = 0; i < rgb.length; i++) rgb[i] += bias;
    }
    if (bg) {
      // 背景换成中性灰：目标亮度定义在抖动的灰度空间，这里的 RGB 是 sRGB，线性模式下要换算回去
      const target = backgroundTarget(bg.light, bg.density, palette.size);
      rgb = forceBackgroundRgb(rgb, bg.mask, opts.tone.linear ? linearToSrgb(target) : target, bg.strength);
    }
    const out = colorDither(algo, { width, height, rgb, palette, seed: 0 }, params);
    if (out) return out;
    const input: DitherInput = { width, height, gray: this.forced!.value.data, levels: palette.size, seed: 0 };
    return algo.run(input, params);
  }

  /** 分通道路径：RGB 三通道或 CMYK 四通道各自当作灰度抖动 */
  private runChannelPath(algo: AlgorithmDef, params: Params, opts: PipelineOptions, bg: BackgroundState | null): LevelFrame[] {
    const toned = this.toned!.value;
    const { width, height } = toned;
    const n = opts.color.levels;
    const linear = opts.tone.linear;
    const bias = thresholdBias(opts.tone.threshold);
    const count = opts.color.channelSpace === 'cmyk' ? 4 : 3;
    const channels = Array.from({ length: count }, () => new Float32Array(width * height));
    const src = toned.data;
    for (let i = 0, j = 0; i < width * height; i++, j += 3) {
      let r = src[j];
      let g = src[j + 1];
      let b = src[j + 2];
      if (linear) {
        r = srgbToLinearFast(r);
        g = srgbToLinearFast(g);
        b = srgbToLinearFast(b);
      }
      if (count === 4) {
        const [c, m, y, k] = rgbToCmyk(r, g, b);
        channels[0][i] = c + bias;
        channels[1][i] = m + bias;
        channels[2][i] = y + bias;
        channels[3][i] = k + bias;
      } else {
        channels[0][i] = r + bias;
        channels[1][i] = g + bias;
        channels[2][i] = b + bias;
      }
    }
    if (bg) {
      // 中性灰在各通道里的值：RGB 三通道都是目标亮度，CMYK 只有 K = 1 - 目标亮度
      const target = backgroundTarget(bg.light, bg.density, n);
      const values = count === 4 ? [0, 0, 0, 1 - target] : [target, target, target];
      channels.forEach((ch, c) => {
        for (let i = 0; i < ch.length; i++) if (bg.mask[i]) ch[i] += (values[c] - ch[i]) * bg.strength;
      });
    }
    return channels.map((gray) => ({ width, height, levels: n, data: algo.run({ width, height, gray, levels: n, seed: 0 }, params) }));
  }

  /** 当前缓存的量化结果（导出、统计用）：抖动是灰阶索引，排线是暗度档位 */
  get currentLevels(): LevelFrame | undefined {
    return this.levels?.value;
  }

  /** 排线风格最近一次的分档结果与几何；抖动风格下为空 */
  get currentHatch(): HatchState | undefined {
    return this.hatch;
  }

  /** 最近一次运行的特效栈与它拿到的网格（矢量导出补画方块用） */
  get currentEffects(): EffectsState | undefined {
    return this.effects;
  }

  clear() {
    this.ht.clear();
    this.gl.clear();
    this.fitted = this.pixelated = this.toned = this.gray = this.biased = this.bgMask = this.forced = this.levels = this.cells = this.channels = this.rendered = this.effected = undefined;
    this.hatch = undefined;
    this.effects = undefined;
  }
}

/** 分通道结果压成一个"亮度等级"帧，供 Accent 层判断前景 / 背景 */
function channelLevelSummary(frames: LevelFrame[], space: 'rgb' | 'cmyk'): LevelFrame {
  const { width, height, levels } = frames[0];
  const data = new Uint8Array(width * height);
  if (space === 'cmyk' && frames.length >= 4) {
    const k = frames[3].data;
    for (let i = 0; i < data.length; i++) data[i] = levels - 1 - k[i];
  } else {
    for (let i = 0; i < data.length; i++) data[i] = Math.round((frames[0].data[i] + frames[1].data[i] + frames[2].data[i]) / 3);
  }
  return { width, height, levels, data };
}

/** 一次性运行整条流水线（测试与导出用） */
export function renderImage(source: RGBAFrame, params: Params): RGBAFrame {
  return new Pipeline().run(source, 'once', params);
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
