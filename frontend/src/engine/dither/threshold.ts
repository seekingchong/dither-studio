import { num } from '@/params';
import { thresholdBias } from '../preprocess/tone';
import type { AlgorithmDef, DitherInput } from './types';
import { quantize } from './quantize';

function fixed(input: DitherInput): Uint8Array {
  const { gray, levels } = input;
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = quantize(gray[i], levels);
  return out;
}

/** 输入里已含的阈值偏置，Otsu 与自适应要把它剥离再加回 */
function biasOf(params: Parameters<AlgorithmDef['run']>[1]): number {
  return thresholdBias(num(params, 'tone.threshold'));
}

/** Otsu：最大类间方差求全局阈值（256 桶直方图） */
export function otsuThreshold(gray: Float32Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i];
    const b = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
    hist[b]++;
  }
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestT = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      bestT = t;
    }
  }
  return (bestT + 0.5) / 255;
}

function otsu(input: DitherInput, params: Parameters<AlgorithmDef['run']>[1]): Uint8Array {
  const { gray, levels } = input;
  if (levels !== 2) return fixed(input);
  const b = biasOf(params);
  // 输入已加偏置，先按偏置后的数据求 Otsu，再让阈值滑块相对 Otsu 平移
  const t = otsuThreshold(gray) - b;
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = gray[i] >= t ? 1 : 0;
  return out;
}

/** 积分图求窗口均值 */
export function boxMean(gray: Float32Array, width: number, height: number, radius: number): Float32Array {
  const W = width + 1;
  const integral = new Float64Array(W * (height + 1));
  for (let y = 1; y <= height; y++) {
    let rowSum = 0;
    for (let x = 1; x <= width; x++) {
      rowSum += gray[(y - 1) * width + (x - 1)];
      integral[y * W + x] = integral[(y - 1) * W + x] + rowSum;
    }
  }
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width, x + radius + 1);
      const sum = integral[y1 * W + x1] - integral[y0 * W + x1] - integral[y1 * W + x0] + integral[y0 * W + x0];
      out[y * width + x] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

/** 自适应阈值：像素与局部均值比较，偏移 C 让整体偏亮或偏暗 */
function adaptive(input: DitherInput, params: Parameters<AlgorithmDef['run']>[1]): Uint8Array {
  const { width, height, gray, levels } = input;
  const radius = Math.max(1, Math.round(num(params, 'dither.threshold.radius')));
  const c = num(params, 'dither.threshold.offset') / 100;
  const b = biasOf(params);
  const mean = boxMean(gray, width, height, radius);
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    // gray 与 mean 都含偏置，相减后抵消；再加 0.5 居中并把滑块偏置加回
    out[i] = quantize(gray[i] - mean[i] + 0.5 + b - c, levels);
  }
  return out;
}

export const THRESHOLD_ALGORITHMS: AlgorithmDef[] = [
  { id: 'fixed', family: 'threshold', label: '固定阈值', run: fixed },
  { id: 'otsu', family: 'threshold', label: 'Otsu 自动阈值', run: otsu },
  { id: 'adaptive', family: 'threshold', label: '自适应阈值', run: adaptive },
];
