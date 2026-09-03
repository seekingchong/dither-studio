import type { Params } from '@/params';

/**
 * 预览降分辨率：画布与像素尺寸同比缩小，格子数不变，抖动图案与全分辨率一致，
 * 只是每个格子画得更小。像素尺寸为 1 时无法再缩，返回原参数。
 */
export function scaleParamsForPreview(params: Params, scale: number): { params: Params; scale: number } {
  if (scale >= 1) return { params, scale: 1 };
  const size = Number(params['pixel.size']) || 1;
  const newSize = Math.max(1, Math.round(size * scale));
  const effective = newSize / size;
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
    },
  };
}

/** 按上一帧耗时挑选下一帧的预览倍率：慢就降，快就回升 */
export function nextPreviewScale(current: number, elapsedMs: number): number {
  if (elapsedMs > 400) return 0.25;
  if (elapsedMs > 120) return Math.min(current, 0.5);
  if (elapsedMs < 40) return current < 0.5 ? 0.5 : 1;
  return current;
}
