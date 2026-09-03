import type { GrayFrame, RGBFrame } from '../types';
import { createGray } from '../types';
import { srgbToLinearFast } from './srgb';

export type GrayFormula = 'bt709' | 'bt601' | 'average' | 'red' | 'green' | 'blue' | 'max';

const WEIGHTS: Record<Exclude<GrayFormula, 'max'>, [number, number, number]> = {
  bt709: [0.2126, 0.7152, 0.0722],
  bt601: [0.299, 0.587, 0.114],
  average: [1 / 3, 1 / 3, 1 / 3],
  red: [1, 0, 0],
  green: [0, 1, 0],
  blue: [0, 0, 1],
};

/**
 * RGB → 亮度。linear=true 时先把 sRGB 转到线性光再加权（PRD 默认：BT.709 线性空间），
 * 抖动后的平均反射率与原图一致；linear=false 则直接在 gamma 空间加权。
 */
export function toGray(rgb: RGBFrame, formula: GrayFormula, linear = true): GrayFrame {
  const { width, height, data } = rgb;
  const out = createGray(width, height);
  const g = out.data;
  const n = width * height;
  const conv = linear ? srgbToLinearFast : (v: number) => v;
  if (formula === 'max') {
    for (let i = 0, j = 0; i < n; i++, j += 3) {
      g[i] = conv(Math.max(data[j], data[j + 1], data[j + 2]));
    }
    return out;
  }
  const [wr, wg, wb] = WEIGHTS[formula];
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    g[i] = wr * conv(data[j]) + wg * conv(data[j + 1]) + wb * conv(data[j + 2]);
  }
  return out;
}
