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
import { buildHalftone, type HalftoneGeometry, type HalftoneSource } from './halftone/geometry';
import { renderHalftone } from './halftone/render';
import { CELL_SAMPLES } from './halftone/geometry';
import { keyOf, keyOfExcept, toPipelineOptions, type PipelineOptions } from './options';
import { backgroundMask, backgroundTarget, forceBackgroundGray, forceBackgroundRgb, isLightBackground } from './preprocess/background';
import { fitFrame } from './preprocess/fit';
import { pixelate } from './preprocess/pixelate';
import { applyThresholdBias, applyTone, thresholdBias } from './preprocess/tone';
import { renderGrid } from './render/grid';
import { orderedDitherGpu } from './gpu/orderedGpu';
import { renderGridGpu } from './gpu/gridGpu';
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

/** Halftone 的采样倍率：格子短边上留 CELL_SAMPLES 个采样点，再小就不缩了 */
export function halftoneSampleSize(pitchX: number, pitchY: number): number {
  return Math.max(1, Math.floor(Math.min(pitchX, pitchY) / CELL_SAMPLES));
}

/**
 * 流水线：源帧 → 适配画布 → 像素化 → 影调 → 灰度 → 阈值偏置 → 强制背景 → 抖动 → 颜色映射 → Accent → 网格渲染。
 * Halftone 风格在适配画布之后分叉：按网格间距缩小 → 影调 → 灰度 → 阈值偏置 → 强制背景 → 逐格采样成网点几何 → 光栅渲染，
 * 两条路各自一套缓存，切风格来回不会互相冲掉。特效栈两条路共用。
 * 每个阶段按"上游键 + 本阶段参数"缓存，参数没变的阶段直接复用。
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
  lastStats: PipelineStats = { recomputed: [], elapsedMs: 0, gpu: false };
  /** 允许走 WebGL 路径（由 Worker 按全局设置传入） */
  gpu = true;
  /** 最近一次运行走的是哪种风格 */
  private lastStyle: PipelineOptions['style'] = 'dither';

  run(source: RGBAFrame, sourceId: string, params: Params): RGBAFrame {
    const t0 = now();
    const recomputed: string[] = [];
    let usedGpu = false;
    const opts = toPipelineOptions(params);
    this.lastStyle = opts.style;

    const fitKey = `${sourceId}|${keyOf(params, 'canvas.')}`;
    if (this.fitted?.key !== fitKey) {
      this.fitted = { key: fitKey, value: fitFrame(source, opts.canvas.width, opts.canvas.height, opts.canvas.fit) };
      recomputed.push('fit');
    }

    if (opts.style === 'halftone') {
      const output = this.runHalftone(params, opts, fitKey, recomputed);
      this.lastStats = { recomputed, elapsedMs: now() - t0, gpu: false };
      return output;
    }

    const pixelKey = `${fitKey}|${keyOf(params, 'pixel.')}`;
    if (this.pixelated?.key !== pixelKey) {
      const { size, method, offsetX, offsetY } = opts.pixel;
      this.pixelated = { key: pixelKey, value: pixelate(this.fitted.value, size, method, offsetX, offsetY) };
      recomputed.push('pixelate');
    }

    // 阈值、灰度公式、线性空间、强制背景不属于影调阶段，排除在键之外
    const toneKey = `${pixelKey}|${keyOfExcept(params, ['tone.threshold', 'tone.grayFormula', 'tone.linear', 'tone.bg.'], 'tone.')}`;
    if (this.toned?.key !== toneKey) {
      this.toned = { key: toneKey, value: applyTone(this.pixelated.value, opts.tone) };
      recomputed.push('tone');
    }

    const grayKey = `${toneKey}|gray=${opts.tone.grayFormula}|linear=${opts.tone.linear}`;
    if (this.gray?.key !== grayKey) {
      this.gray = { key: grayKey, value: toGray(this.toned.value, opts.tone.grayFormula, opts.tone.linear) };
      recomputed.push('gray');
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
        recomputed.push('background');
      }
      const mask = this.bgMask.value;
      const light = fb.polarity === 'auto' ? isLightBackground(this.gray.value.data, mask) : fb.polarity === 'light';
      bg = { mask, light, density: fb.density, strength: fb.strength };
      bgKey = `|bg=${keyOf(params, 'tone.bg.')}`;
    }

    const algo = resolveAlgorithm(params);
    const ditherParams = keyOf(params, 'dither.');
    const palette = resolvePalette(opts.color.palettePreset, opts.color.paletteCustom);
    const paletteKey = `${opts.color.palettePreset}:${opts.color.paletteCustom}`;
    const { width, height } = this.biased.value;
    const mode = opts.color.mode;

    // 抖动输入：阈值偏置后的亮度，开了强制背景则蒙版内换成目标亮度（目标随该路径的级数变化）
    const pathLevels =
      mode === 'palette' && !opts.color.mismatch ? palette.size : mode === 'channels' ? opts.color.levels : mode === 'palette' ? opts.color.paletteLevels : opts.color.levels;
    const forcedKey = `${biasedKey}${bgKey}|fb=${pathLevels}`;
    if (this.forced?.key !== forcedKey) {
      this.forced = {
        key: forcedKey,
        value: bg ? forceBackgroundGray(this.biased.value, bg.mask, backgroundTarget(bg.light, bg.density, pathLevels), bg.strength) : this.biased.value,
      };
    }
    const ditherGray = this.forced.value;

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
        recomputed.push(`dither:${algo.family}/${algo.id}:palette`);
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
        recomputed.push(`dither:${algo.family}/${algo.id}:channels`);
      } else {
        frames = this.channels.value;
      }
      levelFrame = channelLevelSummary(frames, opts.color.channelSpace);
      cellsKey = `${key}|${keyOf(params, 'color.')}`;
      buildCells = () => combineChannels(frames, opts.color.channelSpace, opts.tone.linear);
    } else {
      // 亮度路径
      const n = mode === 'palette' ? opts.color.paletteLevels : opts.color.levels;
      const key = `${biasedKey}${bgKey}|levels=${n}|${ditherParams}|path=gray`;
      if (this.levels?.key !== key) {
        const input: DitherInput = { width, height, gray: ditherGray.data, levels: n, seed: 0 };
        let data: Uint8Array | null = null;
        if (this.gpu && algo.family === 'ordered') {
          data = orderedDitherGpu(input.gray, width, height, n, getMatrix(str(params, 'dither.ordered.matrix')), {
            scale: num(params, 'dither.ordered.scale'),
            angle: num(params, 'dither.ordered.angle'),
            offsetX: num(params, 'dither.ordered.offsetX'),
            offsetY: num(params, 'dither.ordered.offsetY'),
          });
          if (data) usedGpu = true;
        }
        if (!data) data = algo.run(input, params);
        this.levels = { key, value: { width, height, levels: n, data } };
        recomputed.push(`dither:${algo.family}/${algo.id}${usedGpu ? ':gpu' : ''}`);
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
      recomputed.push('color');
    }

    const { size, offsetX, offsetY } = opts.pixel;
    const renderKey = `${cellsKey}|${keyOf(params, 'grid.')}|paper=${paper.join()}|ink=${ink.join()}|size=${size}|${offsetX},${offsetY}|${opts.canvas.width}x${opts.canvas.height}`;
    if (this.rendered?.key !== renderKey) {
      const gridOpts = { ...opts.grid, paper, ink };
      const plain = gridOpts.dot === 'square' && !gridOpts.metaball && gridOpts.gapX === 0 && gridOpts.gapY === 0 && gridOpts.background === 'none' && !gridOpts.invert && !gridOpts.dotTone;
      let frame: RGBAFrame | null = null;
      if (this.gpu && !plain) {
        frame = renderGridGpu(this.cells.value, opts.canvas.width, opts.canvas.height, size, offsetX, offsetY, gridOpts);
        if (frame) usedGpu = true;
      }
      if (!frame) frame = renderGrid(this.cells.value, opts.canvas.width, opts.canvas.height, size, offsetX, offsetY, gridOpts);
      this.rendered = { key: renderKey, value: frame };
      recomputed.push(usedGpu && !plain ? 'render:gpu' : 'render');
    }
    const output = this.finish(renderKey, this.rendered.value, params, recomputed);
    this.lastStats = { recomputed, elapsedMs: now() - t0, gpu: usedGpu };
    return output;
  }

  private rendered?: Cached<RGBAFrame>;
  private effected?: Cached<RGBAFrame>;

  /** 渲染之后的收尾：特效栈（独立缓存）+ 复制一份输出（输出会被 Worker 转移给主线程，缓存里保留副本） */
  private finish(renderKey: string, rendered: RGBAFrame, params: Params, recomputed: string[]): RGBAFrame {
    const stackJson = typeof params['effects.stack'] === 'string' ? (params['effects.stack'] as string) : '';
    const effectsKey = `${renderKey}|${stackJson}`;
    if (this.effected?.key !== effectsKey) {
      const stack = parseStack(stackJson);
      const value = stack.some((e) => e.enabled) ? applyEffects(rendered, stack) : rendered;
      this.effected = { key: effectsKey, value };
      if (value !== rendered) recomputed.push('effects');
    }
    const cached = this.effected.value;
    return { width: cached.width, height: cached.height, data: new Uint8ClampedArray(cached.data) };
  }

  // ---------- Halftone 分支 ----------
  private htPixelated?: Cached<RGBFrame>;
  private htToned?: Cached<RGBFrame>;
  private htGray?: Cached<GrayFrame>;
  private htBgMask?: Cached<Uint8Array>;
  private htForced?: Cached<GrayFrame>;
  private htGeometry?: Cached<HalftoneGeometry>;
  private htRendered?: Cached<RGBAFrame>;

  /**
   * Halftone：不用 pixel.* 的像素化，而是按网格间距把画面缩到"每格短边上 CELL_SAMPLES 个采样"的分辨率，
   * 影调在这张小图上做，然后每个格子在自己范围里超采样求平均明暗（与颜色），换成网点大小。
   * 强制背景沿用 Dither 那套蒙版逻辑，只是目标亮度不再按级数取整（网点是连续的）。
   */
  private runHalftone(params: Params, opts: PipelineOptions, fitKey: string, recomputed: string[]): RGBAFrame {
    const ht = opts.halftone;
    const sample = halftoneSampleSize(ht.pitchX, ht.pitchY);
    const pixelKey = `${fitKey}|ht-sample=${sample}`;
    if (this.htPixelated?.key !== pixelKey) {
      this.htPixelated = { key: pixelKey, value: pixelate(this.fitted!.value, sample, 'box', 0, 0) };
      recomputed.push('pixelate');
    }

    const toneKey = `${pixelKey}|${keyOfExcept(params, ['tone.threshold', 'tone.grayFormula', 'tone.linear', 'tone.bg.'], 'tone.')}`;
    if (this.htToned?.key !== toneKey) {
      // 模糊单位是画布像素，换算成这张小图的像素
      const toneOpts = { ...opts.tone, blur: num(params, 'tone.blur') / sample };
      this.htToned = { key: toneKey, value: applyTone(this.htPixelated.value, toneOpts) };
      recomputed.push('tone');
    }

    const grayKey = `${toneKey}|gray=${opts.tone.grayFormula}|linear=${opts.tone.linear}|threshold=${opts.tone.threshold}`;
    if (this.htGray?.key !== grayKey) {
      this.htGray = { key: grayKey, value: applyThresholdBias(toGray(this.htToned.value, opts.tone.grayFormula, opts.tone.linear), opts.tone.threshold) };
      recomputed.push('gray');
    }

    let gray = this.htGray.value;
    let bgKey = '';
    const fb = opts.forcedBg;
    if (fb.enabled) {
      const maskKey = `${pixelKey}|${keyOfExcept(params, ['tone.bg.density', 'tone.bg.strength', 'tone.bg.polarity'], 'tone.bg.')}`;
      if (this.htBgMask?.key !== maskKey) {
        this.htBgMask = { key: maskKey, value: backgroundMask(this.htPixelated.value, fb) };
        recomputed.push('background');
      }
      const mask = this.htBgMask.value;
      const light = fb.polarity === 'auto' ? isLightBackground(gray.data, mask) : fb.polarity === 'light';
      bgKey = `|bg=${keyOf(params, 'tone.bg.')}`;
      const forcedKey = `${grayKey}${bgKey}`;
      if (this.htForced?.key !== forcedKey) {
        // 网点大小是连续的，背景目标亮度就是 1 − 密度（或密度），不按级数取整
        this.htForced = { key: forcedKey, value: forceBackgroundGray(gray, mask, backgroundTarget(light, fb.density, 2), fb.strength) };
      }
      gray = this.htForced.value;
    }

    const geometryKey = `${grayKey}${bgKey}|${keyOf(params, 'halftone.', 'screen.', 'ink.')}|${opts.canvas.width}x${opts.canvas.height}`;
    if (this.htGeometry?.key !== geometryKey) {
      const src: HalftoneSource = {
        width: opts.canvas.width,
        height: opts.canvas.height,
        sample,
        grayWidth: gray.width,
        grayHeight: gray.height,
        gray: gray.data,
        rgb: this.htToned.value.data,
        linear: opts.tone.linear,
      };
      this.htGeometry = { key: geometryKey, value: buildHalftone(src, ht) };
      recomputed.push('halftone');
    }

    if (this.htRendered?.key !== geometryKey) {
      this.htRendered = { key: geometryKey, value: renderHalftone(this.htGeometry.value) };
      recomputed.push('render');
    }
    return this.finish(geometryKey, this.htRendered.value, params, recomputed);
  }

  /** 最近一次 Halftone 运行的网点几何（SVG 导出用）；上一次跑的是 Dither 时为空 */
  get currentHalftone(): HalftoneGeometry | undefined {
    return this.lastStyle === 'halftone' ? this.htGeometry?.value : undefined;
  }

  private channels?: Cached<LevelFrame[]>;

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

  /** 当前缓存的量化结果（导出、统计用） */
  get currentLevels(): LevelFrame | undefined {
    return this.levels?.value;
  }

  clear() {
    this.fitted = this.pixelated = this.toned = this.gray = this.biased = this.bgMask = this.forced = this.levels = this.cells = this.channels = this.rendered = this.effected = undefined;
    this.htPixelated = this.htToned = this.htGray = this.htBgMask = this.htForced = this.htGeometry = this.htRendered = undefined;
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
