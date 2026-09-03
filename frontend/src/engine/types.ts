/**
 * 引擎缓冲类型。所有阶段都是 (buffer, params) => buffer 的纯函数，不依赖 DOM。
 */

/** 8-bit sRGB RGBA，与 ImageData 布局一致 */
export interface RGBAFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** 3 通道浮点 sRGB，取值 0..1，逐像素 [r, g, b] */
export interface RGBFrame {
  width: number;
  height: number;
  data: Float32Array;
}

/** 单通道浮点亮度，取值 0..1 */
export interface GrayFrame {
  width: number;
  height: number;
  data: Float32Array;
}

/** 量化结果：每个格子的灰阶索引 0..levels-1 */
export interface LevelFrame {
  width: number;
  height: number;
  levels: number;
  data: Uint8Array;
}

/** 每个格子的 RGBA 颜色（尚未放大到画布尺寸） */
export interface CellFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function createRGBA(width: number, height: number): RGBAFrame {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function createRGB(width: number, height: number): RGBFrame {
  return { width, height, data: new Float32Array(width * height * 3) };
}

export function createGray(width: number, height: number): GrayFrame {
  return { width, height, data: new Float32Array(width * height) };
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
