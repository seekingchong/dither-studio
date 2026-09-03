import { bool, num, str, type Params } from '@/params';
import type { ColorMode } from './color/map';
import type { GrayFormula } from './color/gray';
import type { FitMode } from './preprocess/fit';
import type { ResampleMethod } from './preprocess/resample';

/** 从扁平参数表整理出各阶段的强类型选项 */
export interface PipelineOptions {
  canvas: { width: number; height: number; fit: FitMode };
  pixel: { size: number; method: ResampleMethod; offsetX: number; offsetY: number };
  tone: { invert: boolean; linear: boolean; threshold: number; grayFormula: GrayFormula };
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
  const parts: string[] = [];
  const ids = Object.keys(params).sort();
  for (const id of ids) {
    if (prefixes.some((p) => id.startsWith(p))) parts.push(`${id}=${String(params[id])}`);
  }
  return parts.join('|');
}
