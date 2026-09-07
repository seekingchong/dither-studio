import { bool, num, str, styleOf, type Params } from '@/params';
import { resolvePalette } from '../color/palettes';
import { clampLevels } from '../halftone/glyphScreen';
import type { GrayFrame } from '../types';
import type { ToneBins, ToneMap } from './types';

/** 把某个阶段的灰度帧包装成明暗分布：格子 i 覆盖画布像素 [i*cellW - offsetX, (i+1)*cellW - offsetX)，与像素化 / 网格渲染同一套约定 */
export function toneMapOf(gray: GrayFrame, cellW: number, cellH: number, offsetX: number, offsetY: number, bins: ToneBins): ToneMap {
  const ox = ((offsetX % cellW) + cellW) % cellW;
  const oy = ((offsetY % cellH) + cellH) % cellH;
  return { width: gray.width, height: gray.height, gray: gray.data, cellW, cellH, originX: -ox, originY: -oy, bins };
}

/** 没有分级时网点的大小是连续的，没有固定阶数，描边按这个数分 */
const HALFTONE_FALLBACK_LEVELS = 8;

/** 当前风格把画面分成几阶：抖动看颜色模式，排线 / 符号看各自的色阶，网点只在开了分级时有阶数 */
export function styleLevelCount(params: Params): number {
  switch (styleOf(params)) {
    case 'hatch':
      return Math.max(2, Math.round(num(params, 'hatch.levels')));
    case 'glyph':
      return clampLevels(num(params, 'glyph.levels'));
    case 'halftone':
      return bool(params, 'halftone.stepped') ? Math.max(2, Math.round(num(params, 'halftone.levels'))) : HALFTONE_FALLBACK_LEVELS;
    default: {
      const mode = str(params, 'color.mode');
      if (mode === 'mono') return 2;
      if (mode === 'palette') {
        return bool(params, 'color.mismatch')
          ? Math.max(2, Math.round(num(params, 'color.palette.levels')))
          : resolvePalette(str(params, 'color.palette.preset'), str(params, 'color.palette.custom')).size;
      }
      return Math.max(2, Math.round(num(params, 'color.levels')));
    }
  }
}
