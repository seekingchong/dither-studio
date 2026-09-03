import type { GrayFrame, RGBFrame } from '../types';
import { createGray, createRGB } from '../types';

export interface ToneOptions {
  invert: boolean;
}

/** 影调预处理（M1：反相；M3 补齐亮度、对比度、曲线、模糊等） */
export function applyTone(rgb: RGBFrame, opts: ToneOptions): RGBFrame {
  if (!opts.invert) return rgb;
  const out = createRGB(rgb.width, rgb.height);
  const s = rgb.data;
  const d = out.data;
  for (let i = 0; i < s.length; i++) d[i] = 1 - s[i];
  return out;
}

/**
 * 阈值偏置：threshold 取 0..255，128 为中性（偏置恰为 0）。
 * 所有算法统一在量化输入上加 (0.5 - threshold/256)，固定阈值算法下等价于 gray >= threshold/256。
 */
export function thresholdBias(threshold: number): number {
  return 0.5 - threshold / 256;
}

export function applyThresholdBias(gray: GrayFrame, threshold: number): GrayFrame {
  const bias = thresholdBias(threshold);
  if (bias === 0) return gray;
  const out = createGray(gray.width, gray.height);
  const s = gray.data;
  const d = out.data;
  for (let i = 0; i < s.length; i++) d[i] = s[i] + bias;
  return out;
}
