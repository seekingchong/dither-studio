import type { RGBAFrame } from '../types';
import { createRGBA } from '../types';
import { resample } from './resample';

export type FitMode = 'contain' | 'cover' | 'fill' | 'native';

export interface FitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 源媒体在画布内的放置矩形（可能超出画布，绘制时裁剪） */
export function computeFit(srcW: number, srcH: number, dstW: number, dstH: number, mode: FitMode): FitRect {
  let w: number;
  let h: number;
  switch (mode) {
    case 'fill':
      w = dstW;
      h = dstH;
      break;
    case 'native':
      w = srcW;
      h = srcH;
      break;
    case 'cover': {
      const s = Math.max(dstW / srcW, dstH / srcH);
      w = srcW * s;
      h = srcH * s;
      break;
    }
    case 'contain':
    default: {
      const s = Math.min(dstW / srcW, dstH / srcH);
      w = srcW * s;
      h = srcH * s;
    }
  }
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  return { x: Math.round((dstW - w) / 2), y: Math.round((dstH - h) / 2), width: w, height: h };
}

/**
 * 把源帧适配进 dstW × dstH 的画布，空白处填背景色，半透明像素合成到背景上。
 * 缩小用 box 平均，放大用双线性。
 */
export function fitFrame(
  src: RGBAFrame,
  dstW: number,
  dstH: number,
  mode: FitMode,
  background: [number, number, number] = [255, 255, 255],
): RGBAFrame {
  const rect = computeFit(src.width, src.height, dstW, dstH, mode);
  const shrinking = rect.width < src.width || rect.height < src.height;
  const scaled = resample(src, rect.width, rect.height, shrinking ? 'box' : 'bilinear');

  const out = createRGBA(dstW, dstH);
  const o = out.data;
  const [br, bg, bb] = background;
  for (let i = 0; i < o.length; i += 4) {
    o[i] = br;
    o[i + 1] = bg;
    o[i + 2] = bb;
    o[i + 3] = 255;
  }

  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(dstW, rect.x + rect.width);
  const y1 = Math.min(dstH, rect.y + rect.height);
  const s = scaled.data;
  for (let y = y0; y < y1; y++) {
    const sy = y - rect.y;
    for (let x = x0; x < x1; x++) {
      const sx = x - rect.x;
      const p = (sy * rect.width + sx) * 4;
      const q = (y * dstW + x) * 4;
      const a = s[p + 3] / 255;
      if (a >= 1) {
        o[q] = s[p];
        o[q + 1] = s[p + 1];
        o[q + 2] = s[p + 2];
      } else if (a > 0) {
        o[q] = s[p] * a + br * (1 - a);
        o[q + 1] = s[p + 1] * a + bg * (1 - a);
        o[q + 2] = s[p + 2] * a + bb * (1 - a);
      }
    }
  }
  return out;
}
