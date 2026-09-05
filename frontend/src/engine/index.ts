export * from './types';
export { toGray, type GrayFormula } from './color/gray';
export { srgbToLinear, linearToSrgb, hexToRgb, rgbToHex } from './color/srgb';
export {
  mapLevels,
  mapPaletteIndices,
  combineChannels,
  buildLevelPalette,
  levelDisplayValue,
  sampleRamp,
  type ColorMode,
  type ColorMapOptions,
  type ChannelSpace,
} from './color/map';
export { PALETTE_PRESETS, buildPalette, resolvePalette, parseColorList, grayRamp, getPresetPalette, type Palette, type PaletteDef } from './color/palettes';
export { rgbToCmyk, cmykToRgb } from './color/cmyk';
export { applyAccent, parseAccentColors, type AccentOptions, type AccentColor, type AccentPlacement, type AccentTarget, type AccentContext } from './color/accent';
export { resample, resampleCore, axisWeights, type ResampleMethod } from './preprocess/resample';
export { computeFit, fitFrame, type FitMode, type FitRect } from './preprocess/fit';
export { pixelate, cellCount } from './preprocess/pixelate';
export { applyTone, applyThresholdBias, thresholdBias, buildToneCurve, autoLevels, DEFAULT_TONE, type ToneOptions, type NoiseType } from './preprocess/tone';
export { boxBlur, gaussianBlur, boxesForGauss, sobelMagnitude, bilateral } from './preprocess/filters';
export {
  backgroundMask,
  borderMedianColor,
  erodeMask,
  isLightBackground,
  backgroundTarget,
  forceBackgroundGray,
  forceBackgroundRgb,
  DEFAULT_FORCED_BG,
  type ForcedBackgroundOptions,
  type BgScope,
  type BgReference,
  type BgPolarity,
} from './preprocess/background';
export * from './dither';
export { renderCells } from './render/upscale';
export { renderGrid, DEFAULT_GRID, type GridRenderOptions, type DotShape, type BackgroundKind, type LineDirection, type BgDotShape } from './render/grid';
export {
  renderHatch,
  quantizeHatch,
  hatchLayers,
  levelWidths,
  crossWidths,
  chordOf,
  pitchOf,
  rowShift,
  DEFAULT_HATCH,
  type HatchOptions,
  type HatchLink,
  type StrokeLayer,
} from './render/hatch';
export { hatchToSvg } from './render/hatchSvg';
export { frameToRects, frameToSvg, MAX_RECTS, type SvgRect } from './render/svg';
export { toPipelineOptions, keyOf, keyOfExcept, type PipelineOptions } from './options';
export { Pipeline, renderImage, type PipelineStats, type HatchState } from './pipeline';
export * from './effects';
export { GpuContext, orderedDitherGpu, renderGridGpu, renderHatchGpu } from './gpu';
export { RenderClient, type RenderedFrame } from './client';
export type { WorkerRequest, WorkerResponse, RenderOptions } from './protocol';
export { scaleParamsForPreview, captureSizeFor, pacePreview, PREVIEW_SCALES, PREVIEW_BUDGET_MS, INITIAL_PACER, type PreviewPacer } from './preview';
