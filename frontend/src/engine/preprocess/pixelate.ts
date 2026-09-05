import type { RGBAFrame, RGBFrame } from '../types';
import { createRGB } from '../types';
import { resampleCore, type ResampleMethod } from './resample';

/** 像素化后的格子数：格子 i 覆盖源像素 [i*size - offset, (i+1)*size - offset) */
export function cellCount(length: number, size: number, offset: number): number {
  return Math.max(1, Math.ceil((length + offset) / size));
}

/**
 * 像素化：按 size 倍率降采样成格子，每个格子一个颜色。
 * offsetX / offsetY 为网格相对原图的起始偏移（0..size-1）。
 * sizeY 省略时格子是正方形；排线风格的横纵间距不同时传入，格子就是 size × sizeY 的长方形。
 * 输出 0..1 的浮点 RGB（源帧视为不透明，alpha 合成到白色）。
 */
export function pixelate(frame: RGBAFrame, size: number, method: ResampleMethod, offsetX = 0, offsetY = 0, sizeY = size): RGBFrame {
  const { width, height, data } = frame;
  const ox = ((offsetX % size) + size) % size;
  const oy = ((offsetY % sizeY) + sizeY) % sizeY;
  const w = cellCount(width, size, ox);
  const h = cellCount(height, sizeY, oy);
  const out = createRGB(w, h);
  const o = out.data;

  if (size === 1 && sizeY === 1 && ox === 0 && oy === 0) {
    for (let i = 0, j = 0; j < data.length; i += 3, j += 4) {
      const a = data[j + 3] / 255;
      o[i] = (data[j] * a + 255 * (1 - a)) / 255;
      o[i + 1] = (data[j + 1] * a + 255 * (1 - a)) / 255;
      o[i + 2] = (data[j + 2] * a + 255 * (1 - a)) / 255;
    }
    return out;
  }

  const f = resampleCore(frame, w, h, size, sizeY, ox, oy, method);
  for (let i = 0, j = 0; j < f.length; i += 3, j += 4) {
    const a = f[j + 3] / 255;
    o[i] = (f[j] * a + 255 * (1 - a)) / 255;
    o[i + 1] = (f[j + 1] * a + 255 * (1 - a)) / 255;
    o[i + 2] = (f[j + 2] * a + 255 * (1 - a)) / 255;
  }
  return out;
}
