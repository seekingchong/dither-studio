import type { Params } from '@/params';
import { toGray } from './color/gray';
import { mapLevels } from './color/map';
import { resolveAlgorithm } from './dither/registry';
import { keyOf, toPipelineOptions } from './options';
import { fitFrame } from './preprocess/fit';
import { pixelate } from './preprocess/pixelate';
import { applyThresholdBias, applyTone } from './preprocess/tone';
import { renderCells } from './render/upscale';
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
 * 流水线：源帧 → 适配画布 → 像素化 → 影调 → 灰度 → 抖动 → 颜色映射 → 网格渲染。
 * 每个阶段按"上游键 + 本阶段参数"缓存，参数没变的阶段直接复用。
 */
export class Pipeline {
  private fitted?: Cached<RGBAFrame>;
  private pixelated?: Cached<RGBFrame>;
  private toned?: Cached<RGBFrame>;
  private gray?: Cached<GrayFrame>;
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

    const toneKey = `${pixelKey}|invert=${opts.tone.invert}`;
    if (this.toned?.key !== toneKey) {
      this.toned = { key: toneKey, value: applyTone(this.pixelated.value, { invert: opts.tone.invert }) };
      recomputed.push('tone');
    }

    const grayKey = `${toneKey}|gray=${opts.tone.grayFormula}|linear=${opts.tone.linear}`;
    if (this.gray?.key !== grayKey) {
      this.gray = { key: grayKey, value: toGray(this.toned.value, opts.tone.grayFormula, opts.tone.linear) };
      recomputed.push('gray');
    }

    const ditherKey = `${grayKey}|threshold=${opts.tone.threshold}|levels=${opts.color.levels}|${keyOf(params, 'dither.')}`;
    if (this.levels?.key !== ditherKey) {
      const biased = applyThresholdBias(this.gray.value, opts.tone.threshold);
      const algo = resolveAlgorithm(params);
      const data = algo.run(
        { width: biased.width, height: biased.height, gray: biased.data, levels: opts.color.levels, seed: 0 },
        params,
      );
      this.levels = { key: ditherKey, value: { width: biased.width, height: biased.height, levels: opts.color.levels, data } };
      recomputed.push(`dither:${algo.family}/${algo.id}`);
    }

    const colorKey = `${ditherKey}|${keyOf(params, 'color.')}`;
    if (this.cells?.key !== colorKey) {
      this.cells = { key: colorKey, value: mapLevels(this.levels.value, opts.color) };
      recomputed.push('color');
    }

    const { size, offsetX, offsetY } = opts.pixel;
    const output = renderCells(this.cells.value, opts.canvas.width, opts.canvas.height, size, offsetX, offsetY);
    recomputed.push('render');

    this.lastStats = { recomputed, elapsedMs: now() - t0 };
    return output;
  }

  /** 当前缓存的量化结果（导出、统计用） */
  get currentLevels(): LevelFrame | undefined {
    return this.levels?.value;
  }

  clear() {
    this.fitted = this.pixelated = this.toned = this.gray = this.levels = this.cells = undefined;
  }
}

/** 一次性运行整条流水线（测试与导出用） */
export function renderImage(source: RGBAFrame, params: Params): RGBAFrame {
  return new Pipeline().run(source, 'once', params);
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
