import type { DitherInput } from './types';

/** 把 0..1 的值量化成 0..levels-1 的索引（四舍五入到最近一级） */
export function quantize(v: number, levels: number): number {
  const max = levels - 1;
  const q = Math.round(v * max);
  return q < 0 ? 0 : q > max ? max : q;
}

/** 索引对应的亮度 0..1 */
export function levelValue(index: number, levels: number): number {
  return index / (levels - 1);
}

/**
 * 阈值场抖动：有序、噪声、半调、图案都归结为"每个像素一个 0..1 的阈值 m"，
 * 输出 quantize(gray + (m - 0.5) / (levels - 1))。m 越小的位置越早变暗。
 */
export function thresholdDither(input: DitherInput, field: (x: number, y: number) => number, amplitude = 1): Uint8Array {
  const { width, height, gray, levels } = input;
  const out = new Uint8Array(gray.length);
  const amp = amplitude / (levels - 1);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      out[row + x] = quantize(gray[row + x] + (field(x, y) - 0.5) * amp, levels);
    }
  }
  return out;
}

/** 把坐标按角度（度）旋转，返回旋转函数（绕原点） */
export function rotator(angleDeg: number): (x: number, y: number) => [number, number] {
  if (angleDeg === 0) return (x, y) => [x, y];
  const rad = (angleDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return (x, y) => [c * x - s * y, s * x + c * y];
}

export function fract(v: number): number {
  return v - Math.floor(v);
}

export function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}
