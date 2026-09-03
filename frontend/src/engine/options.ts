import { bool, num, str, type Params } from '@/params';
import type { ColorMode } from './color/map';
import type { GrayFormula } from './color/gray';
import type { FitMode } from './preprocess/fit';
import type { NoiseType, ToneOptions } from './preprocess/tone';
import type { ResampleMethod } from './preprocess/resample';

/** 从扁平参数表整理出各阶段的强类型选项 */
export interface PipelineOptions {
  canvas: { width: number; height: number; fit: FitMode };
  pixel: { size: number; method: ResampleMethod; offsetX: number; offsetY: number };
  tone: ToneOptions & { linear: boolean; threshold: number; grayFormula: GrayFormula };
  color: { mode: ColorMode; tintDark: string; tintLight: string; levels: number };
}

export function toPipelineOptions(params: Params): PipelineOptions {
  const mode = str(params, 'color.mode') as ColorMode;
  return {
    canvas: {
      width: Math.round(num(params, 'canvas.width')),
      height: Math.round(num(params, 'canvas.height')),
      fit: str(params, 'canvas.fit') as FitMode,
    },
    pixel: {
      size: Math.max(1, Math.round(num(params, 'pixel.size'))),
      method: str(params, 'pixel.method') as ResampleMethod,
      offsetX: Math.round(num(params, 'pixel.offsetX')),
      offsetY: Math.round(num(params, 'pixel.offsetY')),
    },
    tone: {
      auto: bool(params, 'tone.auto'),
      brightness: num(params, 'tone.brightness') / 100,
      contrast: num(params, 'tone.contrast') / 100,
      shadows: num(params, 'tone.shadows') / 100,
      midtones: num(params, 'tone.midtones') / 100,
      highlights: num(params, 'tone.highlights') / 100,
      saturation: num(params, 'tone.saturation') / 100,
      // 模糊单位是画布像素，换算成工作分辨率像素
      blur: num(params, 'tone.blur') / Math.max(1, Math.round(num(params, 'pixel.size'))),
      sharpen: num(params, 'tone.sharpen') / 100,
      denoise: num(params, 'tone.denoise') / 100,
      noise: num(params, 'tone.noise') / 100,
      noiseType: str(params, 'tone.noiseType') as NoiseType,
      noiseSeed: Math.round(num(params, 'tone.noiseSeed')),
      outline: num(params, 'tone.outline') / 100,
      outlineThreshold: num(params, 'tone.outlineThreshold') / 100,
      invert: bool(params, 'tone.invert'),
      linear: bool(params, 'tone.linear'),
      threshold: num(params, 'tone.threshold'),
      grayFormula: str(params, 'tone.grayFormula') as GrayFormula,
    },
    color: {
      mode,
      tintDark: str(params, 'color.tint.dark'),
      tintLight: str(params, 'color.tint.light'),
      // M1 只有 1-bit；M4 接入灰阶级数与调色板色数
      levels: 2,
    },
  };
}

/** 取某个前缀下的全部参数，序列化成缓存键 */
export function keyOf(params: Params, ...prefixes: string[]): string {
  return keyOfExcept(params, [], ...prefixes);
}

/** 同 keyOf，但跳过 exclude 里的参数 */
export function keyOfExcept(params: Params, exclude: string[], ...prefixes: string[]): string {
  const parts: string[] = [];
  const ids = Object.keys(params).sort();
  for (const id of ids) {
    if (exclude.includes(id)) continue;
    if (prefixes.some((p) => id.startsWith(p))) parts.push(`${id}=${String(params[id])}`);
  }
  return parts.join('|');
}
