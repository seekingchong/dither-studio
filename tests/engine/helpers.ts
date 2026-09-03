import type { LevelFrame, RGBAFrame } from '@/engine';
import type { DitherInput } from '@/engine';

/** 生成 width × height 的 RGBA 帧，颜色由回调给出 */
export function makeFrame(width: number, height: number, fn: (x: number, y: number) => [number, number, number, number?]): RGBAFrame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = fn(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { width, height, data };
}

/** 从左到右 0→1 的线性亮度渐变 */
export function gradientInput(width: number, height: number, levels = 2): DitherInput {
  const gray = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) gray[y * width + x] = x / (width - 1);
  return { width, height, gray, levels, seed: 1 };
}

export function uniformInput(width: number, height: number, value: number, levels = 2): DitherInput {
  return { width, height, gray: new Float32Array(width * height).fill(value), levels, seed: 1 };
}

const GLYPHS = '#+=-.';

/** 把量化结果画成 ASCII：'#' 最暗，'.' 最亮，多级时按亮度插值取字符 */
export function ascii(data: Uint8Array, width: number, height: number, levels = 2): string {
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const v = data[y * width + x];
      const t = levels === 1 ? 1 : v / (levels - 1);
      row += GLYPHS[Math.round(t * (GLYPHS.length - 1))];
    }
    rows.push(row);
  }
  return rows.join('\n');
}

export function asciiLevels(frame: LevelFrame): string {
  return ascii(frame.data, frame.width, frame.height, frame.levels);
}

export function density(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  return sum / data.length;
}
