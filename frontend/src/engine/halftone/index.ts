export { shapeDistance, shapeVertices, HALFTONE_SHAPE_IDS, type HalftoneShape } from './shapes';
export {
  buildHalftone,
  coverageToSize,
  gridTransform,
  cellCenter,
  baseRadius,
  lineHalfWidth,
  countDots,
  DEFAULT_HALFTONE,
  CMYK_ANGLES,
  CMYK_INKS,
  CELL_SAMPLES,
  type HalftoneSettings,
  type HalftoneSource,
  type HalftoneScreen,
  type HalftoneGeometry,
  type LatticeKind,
  type InkMode,
  type SizeMapping,
  type GridTransform,
} from './geometry';
export { renderHalftone, smoothMin } from './render';
export { halftoneToSvg, MAX_SVG_DOTS } from './svg';
