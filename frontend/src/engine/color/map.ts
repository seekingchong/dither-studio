import type { CellFrame, LevelFrame } from '../types';
import { cmykToRgb } from './cmyk';
import type { Palette } from './palettes';
import { hexToRgb, linearToSrgb } from './srgb';

export type ColorMode = 'mono' | 'gray' | 'tint' | 'palette' | 'channels';
export type ChannelSpace = 'rgb' | 'cmyk';

export interface ColorMapOptions {
  mode: ColorMode;
  /** 灰阶级数 N（mono 固定 2） */
  levels: number;
  /** 抖动在线性光里进行时，等级的显示值要转回 sRGB */
  linear: boolean;
  tintDark: string;
  tintLight: string;
  /** Tint 色带的中间站点（#RRGGBB） */
  tintStops: string[];
  palette: Palette;
  /** 深度错配：N 级亮度直接按索引映射到 M 色（N ≠ M 时回绕） */
  mismatch: boolean;
  channelSpace: ChannelSpace;
}

/** 等级 i 在显示空间里的值 0..1 */
export function levelDisplayValue(i: number, levels: number, linear: boolean): number {
  const t = levels <= 1 ? 1 : i / (levels - 1);
  return linear ? linearToSrgb(t) : t;
}

/** 在颜色列表上按 t ∈ [0,1] 分段线性插值 */
export function sampleRamp(colors: Array<[number, number, number]>, t: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const pos = Math.min(1, Math.max(0, t)) * (colors.length - 1);
  const k = Math.min(colors.length - 2, Math.floor(pos));
  const f = pos - k;
  const a = colors[k];
  const b = colors[k + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** 生成每个灰阶索引对应的颜色表（levels × RGB 0..255） */
export function buildLevelPalette(opts: ColorMapOptions): Uint8ClampedArray {
  const levels = opts.mode === 'mono' ? 2 : Math.max(2, opts.levels);
  const lut = new Uint8ClampedArray(levels * 3);
  const put = (i: number, r: number, g: number, b: number) => {
    lut[i * 3] = r;
    lut[i * 3 + 1] = g;
    lut[i * 3 + 2] = b;
  };
  switch (opts.mode) {
    case 'tint': {
      const ramp: Array<[number, number, number]> = [hexToRgb(opts.tintDark), ...opts.tintStops.map(hexToRgb), hexToRgb(opts.tintLight)];
      for (let i = 0; i < levels; i++) {
        const [r, g, b] = sampleRamp(ramp, i / (levels - 1));
        put(i, r, g, b);
      }
      break;
    }
    case 'palette': {
      const p = opts.palette;
      for (let i = 0; i < levels; i++) {
        const j = (i % p.size) * 3;
        put(i, p.colors[j] * 255, p.colors[j + 1] * 255, p.colors[j + 2] * 255);
      }
      break;
    }
    case 'mono':
    case 'gray':
    default:
      for (let i = 0; i < levels; i++) {
        const v = levelDisplayValue(i, levels, opts.linear) * 255;
        put(i, v, v, v);
      }
  }
  return lut;
}

/** 灰阶索引 → 格子颜色 */
export function mapLevels(frame: LevelFrame, lut: Uint8ClampedArray): CellFrame {
  const { width, height, data } = frame;
  const count = lut.length / 3;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) {
    const k = Math.min(count - 1, data[i]) * 3;
    out[j] = lut[k];
    out[j + 1] = lut[k + 1];
    out[j + 2] = lut[k + 2];
    out[j + 3] = 255;
  }
  return { width, height, data: out };
}

/** 调色板索引 → 格子颜色 */
export function mapPaletteIndices(indices: Uint8Array, width: number, height: number, palette: Palette): CellFrame {
  const out = new Uint8ClampedArray(width * height * 4);
  const c = palette.colors;
  for (let i = 0, j = 0; i < indices.length; i++, j += 4) {
    const k = Math.min(palette.size - 1, indices[i]) * 3;
    out[j] = c[k] * 255;
    out[j + 1] = c[k + 1] * 255;
    out[j + 2] = c[k + 2] * 255;
    out[j + 3] = 255;
  }
  return { width, height, data: out };
}

/** 分通道量化结果合成：RGB 三通道或 CMYK 四通道各自的等级 → 颜色 */
export function combineChannels(channels: LevelFrame[], space: ChannelSpace, linear: boolean): CellFrame {
  const { width, height } = channels[0];
  const out = new Uint8ClampedArray(width * height * 4);
  const levels = channels[0].levels;
  const value = (q: number) => (levels <= 1 ? 1 : q / (levels - 1));
  const display = (v: number) => (linear ? linearToSrgb(v) : v) * 255;
  for (let i = 0, j = 0; i < width * height; i++, j += 4) {
    if (space === 'cmyk' && channels.length >= 4) {
      const [r, g, b] = cmykToRgb(value(channels[0].data[i]), value(channels[1].data[i]), value(channels[2].data[i]), value(channels[3].data[i]));
      out[j] = display(r);
      out[j + 1] = display(g);
      out[j + 2] = display(b);
    } else {
      out[j] = display(value(channels[0].data[i]));
      out[j + 1] = display(value(channels[1].data[i]));
      out[j + 2] = display(value(channels[2].data[i]));
    }
    out[j + 3] = 255;
  }
  return { width, height, data: out };
}
