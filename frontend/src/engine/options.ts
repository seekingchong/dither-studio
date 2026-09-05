import { bool, num, str, styleOf, type Params, type StyleKind } from '@/params';
import { parseAccentColors, type AccentOptions, type AccentPlacement, type AccentTarget } from './color/accent';
import type { ChannelSpace, ColorMode } from './color/map';
import { parseColorList } from './color/palettes';
import { hexToRgb } from './color/srgb';
import type { BackgroundKind, BgDotShape, DotShape, LineDirection } from './render/grid';
import type { HatchLink, HatchOptions } from './render/hatch';
import type { HalftoneSettings, InkMode, LatticeKind, SizeMapping } from './halftone/geometry';
import type { HalftoneShape } from './halftone/shapes';
import type { GrayFormula } from './color/gray';
import type { FitMode } from './preprocess/fit';
import type { BgPolarity, BgReference, BgScope, ForcedBackgroundOptions } from './preprocess/background';
import type { NoiseType, ToneOptions } from './preprocess/tone';
import type { ResampleMethod } from './preprocess/resample';

/** 从扁平参数表整理出各阶段的强类型选项 */
export interface PipelineOptions {
  /** 艺术风格：抖动走原有的抖动 → 颜色 → 网格三段，排线走明暗分档 → 笔画渲染，网点走逐格采样 → 网点几何 → 光栅 */
  style: StyleKind;
  canvas: { width: number; height: number; fit: FitMode };
  pixel: { size: number; method: ResampleMethod; offsetX: number; offsetY: number };
  tone: ToneOptions & { linear: boolean; threshold: number; grayFormula: GrayFormula };
  /** 强制背景：参数在 tone.bg.* 下，但作用在阈值偏置之后、抖动之前 */
  forcedBg: ForcedBackgroundOptions;
  color: {
    mode: ColorMode;
    /** 灰阶 / Tint / Channels 的级数 */
    levels: number;
    /** 深度错配时的亮度级数 N */
    paletteLevels: number;
    tintDark: string;
    tintLight: string;
    tintStops: string[];
    palettePreset: string;
    paletteCustom: string;
    mismatch: boolean;
    channelSpace: ChannelSpace;
    accent: AccentOptions;
  };
  hatch: HatchOptions;
  halftone: HalftoneSettings;
  grid: {
    dot: DotShape;
    dotSize: number;
    dotTone: boolean;
    invert: boolean;
    metaball: boolean;
    metaballRadius: number;
    gapX: number;
    gapY: number;
    background: BackgroundKind;
    lineDirection: LineDirection;
    lineWidth: number;
    bgColor: [number, number, number];
    bgDotShape: BgDotShape;
    bgDotSize: number;
  };
}

export function toPipelineOptions(params: Params): PipelineOptions {
  const mode = str(params, 'color.mode') as ColorMode;
  const style = styleOf(params);
  const spacingX = Math.max(1, Math.round(num(params, 'hatch.spacingX')));
  const spacingY = Math.max(1, Math.round(num(params, 'hatch.spacingY')));
  const pixelSize = Math.max(1, Math.round(num(params, 'pixel.size')));
  // 模糊单位是画布像素，换算成工作分辨率像素：抖动的格子是像素尺寸，排线的格子是横纵间距
  const cellSize = style === 'hatch' ? (spacingX + spacingY) / 2 : pixelSize;
  return {
    style,
    canvas: {
      width: Math.round(num(params, 'canvas.width')),
      height: Math.round(num(params, 'canvas.height')),
      fit: str(params, 'canvas.fit') as FitMode,
    },
    pixel: {
      size: pixelSize,
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
      blur: num(params, 'tone.blur') / cellSize,
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
    forcedBg: {
      enabled: bool(params, 'tone.bg.enabled'),
      density: num(params, 'tone.bg.density') / 100,
      polarity: str(params, 'tone.bg.polarity') as BgPolarity,
      strength: num(params, 'tone.bg.strength') / 100,
      margin: Math.max(0, Math.round(num(params, 'tone.bg.margin'))),
      scope: str(params, 'tone.bg.scope') as BgScope,
      reference: str(params, 'tone.bg.reference') as BgReference,
      color: hexToRgb(str(params, 'tone.bg.color')).map((v) => v / 255) as [number, number, number],
      tolerance: num(params, 'tone.bg.tolerance') / 100,
      smooth: num(params, 'tone.bg.smooth') / 100,
    },
    color: {
      mode,
      levels: mode === 'mono' ? 2 : Math.max(2, Math.round(num(params, 'color.levels'))),
      paletteLevels: Math.max(2, Math.round(num(params, 'color.palette.levels'))),
      tintDark: str(params, 'color.tint.dark'),
      tintLight: str(params, 'color.tint.light'),
      tintStops: parseColorList(str(params, 'color.tint.stops')),
      palettePreset: str(params, 'color.palette.preset'),
      paletteCustom: str(params, 'color.palette.custom'),
      mismatch: bool(params, 'color.mismatch'),
      channelSpace: str(params, 'color.channels.space') as ChannelSpace,
      accent: {
        enabled: bool(params, 'color.accent.enabled'),
        colors: parseAccentColors(str(params, 'color.accent.colors')),
        density: num(params, 'color.accent.density') / 100,
        placement: str(params, 'color.accent.placement') as AccentPlacement,
        level: Math.round(num(params, 'color.accent.level')),
        target: str(params, 'color.accent.target') as AccentTarget,
        spacing: num(params, 'color.accent.spacing'),
        chain: num(params, 'color.accent.chain') / 100,
        seed: Math.round(num(params, 'color.accent.seed')),
      },
    },
    hatch: {
      angle: num(params, 'hatch.angle'),
      spacingX,
      spacingY,
      levels: Math.max(2, Math.round(num(params, 'hatch.levels'))),
      length: num(params, 'hatch.length') / 100,
      maxWidth: num(params, 'hatch.maxWidth') / 100,
      minWidth: Math.min(num(params, 'hatch.minWidth'), num(params, 'hatch.maxWidth')) / 100,
      roundness: num(params, 'hatch.roundness') / 100,
      cross: bool(params, 'hatch.cross'),
      crossStart: num(params, 'hatch.crossStart') / 100,
      stagger: num(params, 'hatch.stagger') / 100,
      link: str(params, 'hatch.link') as HatchLink,
      linkWidth: Math.max(0, num(params, 'hatch.linkWidth')),
      linkColor: hexToRgb(str(params, 'hatch.linkColor')),
      ink: hexToRgb(str(params, 'hatch.ink')),
      paper: hexToRgb(str(params, 'hatch.paper')),
    },
    halftone: {
      shape: str(params, 'halftone.shape') as HalftoneShape,
      size: num(params, 'halftone.size') / 100,
      minSize: num(params, 'halftone.minSize') / 100,
      mapping: str(params, 'halftone.mapping') as SizeMapping,
      gain: num(params, 'halftone.gain') / 100,
      stepped: bool(params, 'halftone.stepped'),
      levels: Math.max(2, Math.round(num(params, 'halftone.levels'))),
      merge: num(params, 'halftone.merge') / 100,
      antialias: bool(params, 'halftone.antialias'),
      pitchX: Math.max(1, num(params, 'screen.pitchX')),
      pitchY: Math.max(1, num(params, 'screen.pitchY')),
      angle: num(params, 'screen.angle'),
      lattice: str(params, 'screen.lattice') as LatticeKind,
      offsetX: num(params, 'screen.offsetX'),
      offsetY: num(params, 'screen.offsetY'),
      mode: str(params, 'ink.mode') as InkMode,
      dot: hexToRgb(str(params, 'ink.dot')),
      paper: hexToRgb(str(params, 'ink.paper')),
    },
    grid: {
      dot: str(params, 'grid.dot') as DotShape,
      dotSize: num(params, 'grid.dotSize') / 100,
      dotTone: bool(params, 'grid.dotTone'),
      invert: bool(params, 'grid.invert'),
      metaball: bool(params, 'grid.metaball'),
      metaballRadius: num(params, 'grid.metaballRadius') / 100,
      gapX: Math.round(num(params, 'grid.gapX')),
      gapY: Math.round(num(params, 'grid.gapY')),
      background: str(params, 'grid.background') as BackgroundKind,
      lineDirection: str(params, 'grid.lineDirection') as LineDirection,
      lineWidth: num(params, 'grid.lineWidth'),
      bgColor: hexToRgb(str(params, 'grid.bgColor')),
      bgDotShape: str(params, 'grid.bgDotShape') as BgDotShape,
      bgDotSize: num(params, 'grid.bgDotSize') / 100,
    },
  };
}

/** 取某个前缀下的全部参数，序列化成缓存键 */
export function keyOf(params: Params, ...prefixes: string[]): string {
  return keyOfExcept(params, [], ...prefixes);
}

/** 同 keyOf，但跳过 exclude 里的参数；exclude 项以 "." 结尾时按前缀跳过整组 */
export function keyOfExcept(params: Params, exclude: string[], ...prefixes: string[]): string {
  const parts: string[] = [];
  const ids = Object.keys(params).sort();
  for (const id of ids) {
    if (exclude.some((e) => (e.endsWith('.') ? id.startsWith(e) : id === e))) continue;
    if (prefixes.some((p) => id.startsWith(p))) parts.push(`${id}=${String(params[id])}`);
  }
  return parts.join('|');
}
