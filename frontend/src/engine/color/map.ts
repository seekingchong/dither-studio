import type { CellFrame, LevelFrame } from '../types';
import { hexToRgb } from './srgb';

export type ColorMode = 'mono' | 'gray' | 'tint' | 'palette' | 'channels';

export interface ColorMapOptions {
  mode: ColorMode;
  tintDark: string;
  tintLight: string;
}

/** 生成每个灰阶索引对应的颜色表（levels × RGB） */
export function buildLevelPalette(levels: number, opts: ColorMapOptions): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(levels * 3);
  const [dr, dg, db] = opts.mode === 'tint' ? hexToRgb(opts.tintDark) : [0, 0, 0];
  const [lr, lg, lb] = opts.mode === 'tint' ? hexToRgb(opts.tintLight) : [255, 255, 255];
  for (let i = 0; i < levels; i++) {
    const t = levels === 1 ? 1 : i / (levels - 1);
    lut[i * 3] = dr + (lr - dr) * t;
    lut[i * 3 + 1] = dg + (lg - dg) * t;
    lut[i * 3 + 2] = db + (lb - db) * t;
  }
  return lut;
}

/** 灰阶索引 → 格子颜色 */
export function mapLevels(frame: LevelFrame, opts: ColorMapOptions): CellFrame {
  const { width, height, levels, data } = frame;
  const lut = buildLevelPalette(levels, opts);
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) {
    const k = data[i] * 3;
    out[j] = lut[k];
    out[j + 1] = lut[k + 1];
    out[j + 2] = lut[k + 2];
    out[j + 3] = 255;
  }
  return { width, height, data: out };
}
