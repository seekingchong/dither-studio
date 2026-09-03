import type { Params } from '@/params';
import { applyAccent } from './color/accent';
import { rgbToCmyk } from './color/cmyk';
import { toGray } from './color/gray';
import { buildLevelPalette, combineChannels, mapLevels, mapPaletteIndices } from './color/map';
import { resolvePalette, type Palette } from './color/palettes';
import { srgbToLinearFast } from './color/srgb';
import { colorDither } from './dither/color';
import { resolveAlgorithm } from './dither/registry';
import type { AlgorithmDef, DitherInput } from './dither/types';
import { applyEffects, parseStack } from './effects/stack';
import { keyOf, keyOfExcept, toPipelineOptions, type PipelineOptions } from './options';
import { fitFrame } from './preprocess/fit';
import { pixelate } from './preprocess/pixelate';
import { applyThresholdBias, applyTone, thresholdBias } from './preprocess/tone';
import { renderGrid } from './render/grid';
import type { CellFrame, GrayFrame, LevelFrame, RGBAFrame, RGBFrame } from './types';

interface Cached<T> {
  key: string;
  value: T;
}

export interface PipelineStats {
  /** 本次实际重算的阶段 */
  recomputed: string[];
  elapsedMs: number;
}

/**
 * 流水线：源帧 → 适配画布 → 像素化 → 影调 → 灰度 → 抖动 → 颜色映射 → Accent → 网格渲染。
 * 每个阶段按"上游键 + 本阶段参数"缓存，参数没变的阶段直接复用。
 * 颜色映射按模式分三条路：亮度路径（单色 / 灰阶 / Tint / 深度错配）、真彩调色板路径、分通道路径。
 */
export class Pipeline {
  private fitted?: Cached<RGBAFrame>;
  private pixelated?: Cached<RGBFrame>;
  private toned?: Cached<RGBFrame>;
  private gray?: Cached<GrayFrame>;
  private biased?: Cached<GrayFrame>;
  private levels?: Cached<LevelFrame>;
  private cells?: Cached<CellFrame>;
  lastStats: PipelineStats = { recomputed: [], elapsedMs: 0 };

  run(source: RGBAFrame, sourceId: string, params: Params): RGBAFrame {
    const t0 = now();
    const recomputed: string[] = [];
    const opts = toPipelineOptions(params);

    const fitKey = `${sourceId}|${keyOf(params, 'canvas.')}`;
    if (this.fitted?.key !== fitKey) {
      this.fitted = { key: fitKey, value: fitFrame(source, opts.canvas.width, opts.canvas.height, opts.canvas.fit) };
      recomputed.push('fit');
    }

    const pixelKey = `${fitKey}|${keyOf(params, 'pixel.')}`;
    if (this.pixelated?.key !== pixelKey) {
      const { size, method, offsetX, offsetY } = opts.pixel;
      this.pixelated = { key: pixelKey, value: pixelate(this.fitted.value, size, method, offsetX, offsetY) };
      recomputed.push('pixelate');
    }

    // 阈值、灰度公式、线性空间不属于影调阶段，排除在键之外
    const toneKey = `${pixelKey}|${keyOfExcept(params, ['tone.threshold', 'tone.grayFormula', 'tone.linear'], 'tone.')}`;
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

    const algo = resolveAlgorithm(params);
    const ditherParams = keyOf(params, 'dither.');
    const palette = resolvePalette(opts.color.palettePreset, opts.color.paletteCustom);
    const paletteKey = `${opts.color.palettePreset}:${opts.color.paletteCustom}`;
    const { width, height } = this.biased.value;
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
      const key = `${toneKey}|threshold=${opts.tone.threshold}|palette=${paletteKey}|${ditherParams}|path=color`;
      if (this.levels?.key !== key) {
        const data = this.runColorPath(algo, params, opts, palette);
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
      const key = `${toneKey}|threshold=${opts.tone.threshold}|linear=${opts.tone.linear}|levels=${n}|space=${opts.color.channelSpace}|${ditherParams}|path=channels`;
      let frames: LevelFrame[];
      if (this.channels?.key !== key) {
        frames = this.runChannelPath(algo, params, opts);
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
      const key = `${biasedKey}|levels=${n}|${ditherParams}|path=gray`;
      if (this.levels?.key !== key) {
        const input: DitherInput = { width, height, gray: this.biased.value.data, levels: n, seed: 0 };
        this.levels = { key, value: { width, height, levels: n, data: algo.run(input, params) } };
        recomputed.push(`dither:${algo.family}/${algo.id}`);
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
          { width, height, levels: levelFrame.data, levelCount: levelFrame.levels, gray: this.biased.value.data },
          opts.color.accent,
        );
      }
      this.cells = { key: cellsKey, value: cells };
      recomputed.push('color');
    }

    const { size, offsetX, offsetY } = opts.pixel;
    const renderKey = `${cellsKey}|${keyOf(params, 'grid.')}|paper=${paper.join()}|ink=${ink.join()}|size=${size}|${offsetX},${offsetY}|${opts.canvas.width}x${opts.canvas.height}`;
    if (this.rendered?.key !== renderKey) {
      const frame = renderGrid(this.cells.value, opts.canvas.width, opts.canvas.height, size, offsetX, offsetY, { ...opts.grid, paper, ink });
      this.rendered = { key: renderKey, value: frame };
      recomputed.push('render');
    }
    const stackJson = typeof params['effects.stack'] === 'string' ? (params['effects.stack'] as string) : '';
    const effectsKey = `${renderKey}|${stackJson}`;
    if (this.effected?.key !== effectsKey) {
      const stack = parseStack(stackJson);
      const value = stack.some((e) => e.enabled) ? applyEffects(this.rendered.value, stack) : this.rendered.value;
      this.effected = { key: effectsKey, value };
      if (value !== this.rendered.value) recomputed.push('effects');
    }

    // 输出会被 Worker 转移给主线程，缓存里保留一份副本
    const cached = this.effected.value;
    const output: RGBAFrame = { width: cached.width, height: cached.height, data: new Uint8ClampedArray(cached.data) };

    this.lastStats = { recomputed, elapsedMs: now() - t0 };
    return output;
  }

  private rendered?: Cached<RGBAFrame>;
  private effected?: Cached<RGBAFrame>;

  private channels?: Cached<LevelFrame[]>;

  /** 真彩路径；算法没有颜色实现时回退到亮度路径并按亮度秩取色 */
  private runColorPath(algo: AlgorithmDef, params: Params, opts: PipelineOptions, palette: Palette): Uint8Array {
    const toned = this.toned!.value;
    const { width, height } = toned;
    const bias = thresholdBias(opts.tone.threshold);
    let rgb = toned.data;
    if (bias !== 0) {
      rgb = new Float32Array(toned.data);
      for (let i = 0; i < rgb.length; i++) rgb[i] += bias;
    }
    const out = colorDither(algo, { width, height, rgb, palette, seed: 0 }, params);
    if (out) return out;
    const input: DitherInput = { width, height, gray: this.biased!.value.data, levels: palette.size, seed: 0 };
    return algo.run(input, params);
  }

  /** 分通道路径：RGB 三通道或 CMYK 四通道各自当作灰度抖动 */
  private runChannelPath(algo: AlgorithmDef, params: Params, opts: PipelineOptions): LevelFrame[] {
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
    return channels.map((gray) => ({ width, height, levels: n, data: algo.run({ width, height, gray, levels: n, seed: 0 }, params) }));
  }

  /** 当前缓存的量化结果（导出、统计用） */
  get currentLevels(): LevelFrame | undefined {
    return this.levels?.value;
  }

  clear() {
    this.fitted = this.pixelated = this.toned = this.gray = this.biased = this.levels = this.cells = this.channels = this.rendered = this.effected = undefined;
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
