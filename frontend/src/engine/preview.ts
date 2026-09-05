import type { Params } from '@/params';
import { computeFit, type FitMode } from './preprocess/fit';

/**
 * 预览降分辨率：优先把画布与像素尺寸同比缩小，格子数不变，抖动图案与全分辨率一致，
 * 只是每个格子画得更小。像素尺寸已经缩不动时（1 或 2），改为按倍率减少格子数——
 * 图案会比最终结果粗，但只发生在播放过程中，暂停与导出仍是全分辨率。
 */
export function scaleParamsForPreview(params: Params, scale: number): { params: Params; scale: number } {
  if (scale >= 1) return { params, scale: 1 };
  const size = Number(params['pixel.size']) || 1;
  const newSize = Math.max(1, Math.round(size * scale));
  // 像素尺寸一点都没缩小 → 这一档只能靠减少格子数拿到
  const effective = newSize === size ? scale : newSize / size;
  if (effective >= 1) return { params, scale: 1 };
  const width = Math.max(16, Math.round((Number(params['canvas.width']) || 1000) * effective));
  const height = Math.max(16, Math.round((Number(params['canvas.height']) || 600) * effective));
  const px = (id: string) => Math.round((Number(params[id]) || 0) * effective);
  return {
    scale: effective,
    params: {
      ...params,
      'canvas.width': width,
      'canvas.height': height,
      'pixel.size': newSize,
      'pixel.offsetX': px('pixel.offsetX'),
      'pixel.offsetY': px('pixel.offsetY'),
      'grid.gapX': px('grid.gapX'),
      'grid.gapY': px('grid.gapY'),
      'grid.lineWidth': Math.max(1, px('grid.lineWidth')),
      'tone.blur': (Number(params['tone.blur']) || 0) * effective,
      // Halftone 的网格也按画布同比缩：格子数不变，只是每个点画得更小
      'screen.pitchX': Math.max(2, px('screen.pitchX')),
      'screen.pitchY': Math.max(2, px('screen.pitchY')),
      'screen.offsetX': px('screen.offsetX'),
      'screen.offsetY': px('screen.offsetY'),
    },
  };
}

/** 预览倍率档位，从清晰到粗糙 */
export const PREVIEW_SCALES = [1, 0.75, 0.5, 0.35, 0.25];

/** 播放时的单帧时间预算：30 fps */
export const PREVIEW_BUDGET_MS = 1000 / 30;

/** 连续多少帧有余量才升一档，避免在两档之间来回跳 */
const UPSCALE_STREAK = 4;

export interface PreviewPacer {
  scale: number;
  /** 连续「有余量」的帧数 */
  streak: number;
}

export const INITIAL_PACER: PreviewPacer = { scale: 1, streak: 0 };

/**
 * 按上一帧的端到端耗时挑下一帧的预览倍率。
 * 超预算立刻降一档；只有连续几帧都明显有余量才升一档（迟滞），
 * 这样倍率不会每帧翻转，画面清晰度和帧间隔都稳定。
 */
export function pacePreview(pacer: PreviewPacer, elapsedMs: number, budgetMs = PREVIEW_BUDGET_MS): PreviewPacer {
  const index = Math.max(0, PREVIEW_SCALES.indexOf(pacer.scale));
  if (elapsedMs > budgetMs * 2.5) {
    // 严重超预算：一次降两档，别慢慢试探
    const next = Math.min(PREVIEW_SCALES.length - 1, index + 2);
    return { scale: PREVIEW_SCALES[next], streak: 0 };
  }
  if (elapsedMs > budgetMs) {
    const next = Math.min(PREVIEW_SCALES.length - 1, index + 1);
    return { scale: PREVIEW_SCALES[next], streak: 0 };
  }
  // 升档要求耗时明显低于预算，留出升档后变慢的余量
  if (index > 0 && elapsedMs < budgetMs * 0.5) {
    const streak = pacer.streak + 1;
    if (streak >= UPSCALE_STREAK) return { scale: PREVIEW_SCALES[index - 1], streak: 0 };
    return { scale: pacer.scale, streak };
  }
  return { scale: pacer.scale, streak: 0 };
}

/**
 * 抓帧时应该直接缩到的尺寸：流水线的第一步就是把源帧重采样进画布，
 * 而浏览器的原生缩放比引擎里的 JS 重采样快一个数量级。抓帧就缩到位，
 * `fitFrame` 里的重采样会因尺寸相同直接跳过。需要放大时返回 null，交给流水线。
 */
export function captureSizeFor(srcW: number, srcH: number, params: Params): { width: number; height: number } | null {
  const mode = String(params['canvas.fit'] || 'contain') as FitMode;
  if (mode === 'native') return null;
  const dstW = Math.round(Number(params['canvas.width']) || 0);
  const dstH = Math.round(Number(params['canvas.height']) || 0);
  if (!(dstW > 0 && dstH > 0) || !(srcW > 0 && srcH > 0)) return null;
  const rect = computeFit(srcW, srcH, dstW, dstH, mode);
  if (rect.width >= srcW || rect.height >= srcH) return null;
  return { width: rect.width, height: rect.height };
}
