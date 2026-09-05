import { rgbToCmyk } from '../color/cmyk';
import { srgbToLinearFast } from '../color/srgb';
import type { HalftoneShape } from './shapes';

/**
 * Halftone 的几何层：把画面切成一张（或 CMYK 四张）网格，每个格子采样它盖住的那块画面，
 * 算出这一格网点的大小（和颜色）。渲染与 SVG 导出都吃这份数据，所以光栅与矢量出自同一套几何。
 */

export type LatticeKind = 'square' | 'hex';
export type InkMode = 'mono' | 'source' | 'cmyk';
export type SizeMapping = 'area' | 'linear';

export interface HalftoneSettings {
  shape: HalftoneShape;
  /** 最暗处网点相对格子的大小 0..1.5（100% = 刚好占满格子） */
  size: number;
  /** 最亮处保留的网点大小 0..1，同一单位 */
  minSize: number;
  mapping: SizeMapping;
  /** 网点增益 -1..1，正数放大中间调 */
  gain: number;
  /** 把大小限定在 levels 档 */
  stepped: boolean;
  levels: number;
  /** 点融合 0..1 */
  merge: number;
  antialias: boolean;
  /** 网格：中心距（画布像素）、角度（度）、排列、偏移（画布像素） */
  pitchX: number;
  pitchY: number;
  angle: number;
  lattice: LatticeKind;
  offsetX: number;
  offsetY: number;
  mode: InkMode;
  /** 网点色与底色 0..255 */
  dot: [number, number, number];
  paper: [number, number, number];
}

export const DEFAULT_HALFTONE: HalftoneSettings = {
  shape: 'circle',
  size: 1,
  minSize: 0.1,
  mapping: 'area',
  gain: 0,
  stepped: false,
  levels: 6,
  merge: 0,
  antialias: true,
  pitchX: 12,
  pitchY: 12,
  angle: 0,
  lattice: 'square',
  offsetX: 0,
  offsetY: 0,
  mode: 'mono',
  dot: [17, 25, 45],
  paper: [255, 255, 255],
};

/** 采样输入：已做影调、按 `sample` 倍缩小的亮度（与颜色），坐标除以 sample 就落到这张图上 */
export interface HalftoneSource {
  /** 画布尺寸 */
  width: number;
  height: number;
  /** 缩小倍率：画布像素 (x, y) 对应缩小图上的 (x / sample, y / sample) */
  sample: number;
  grayWidth: number;
  grayHeight: number;
  /** 阈值偏置之后的亮度，可略超出 0..1 */
  gray: Float32Array;
  /** 影调之后的 sRGB 0..1，逐像素 [r, g, b]；原图色 / CMYK 模式需要 */
  rgb?: Float32Array;
  /** CMYK 分色在线性光里算墨量（与分通道路径一致） */
  linear: boolean;
}

/** 一张网格：cols × rows 个格子，格子 (i, j) 的下标是 (j - j0) * cols + (i - i0) */
export interface HalftoneScreen {
  angle: number;
  pitchX: number;
  pitchY: number;
  offsetX: number;
  offsetY: number;
  lattice: LatticeKind;
  i0: number;
  j0: number;
  cols: number;
  rows: number;
  /** 每格网点大小（相对格子的倍率 0..1.5），0 表示这一格不画 */
  size: Float32Array;
  /** 每格网点颜色 0..255（原图色模式） */
  color?: Uint8ClampedArray;
  /** 这一层的墨色 0..255 */
  ink: [number, number, number];
}

export interface HalftoneGeometry {
  width: number;
  height: number;
  shape: HalftoneShape;
  mode: InkMode;
  paper: [number, number, number];
  merge: number;
  antialias: boolean;
  screens: HalftoneScreen[];
}

/** 印刷四色的常规网线角度（青 / 品 / 黄 / 黑）与显示用墨色 */
export const CMYK_ANGLES: readonly number[] = [15, 75, 0, 45];
export const CMYK_INKS: ReadonlyArray<[number, number, number]> = [
  [0, 174, 239],
  [236, 0, 140],
  [255, 241, 0],
  [35, 31, 32],
];

/** 每个格子每个方向取几个采样点 */
export const CELL_SAMPLES = 4;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 交错排列时奇数行右移半格 */
export function rowShift(lattice: LatticeKind, j: number): number {
  return lattice === 'hex' && (j & 1) === 1 ? 0.5 : 0;
}

/**
 * 画布坐标 ↔ 网格坐标的变换。网格绕画布中心转 angle 度，再按中心距缩到"格"为单位；
 * 画布中心正好是格子 (0, 0) 的中心（格坐标 0.5, 0.5），所以对称的画面出来的网点也对称，改角度时中间那颗点不动。
 */
export interface GridTransform {
  cos: number;
  sin: number;
  cx: number;
  cy: number;
  pitchX: number;
  pitchY: number;
  offsetX: number;
  offsetY: number;
  /** 画布像素 → 格坐标 */
  toGrid(x: number, y: number): [number, number];
  /** 格坐标 → 画布像素 */
  toCanvas(u: number, v: number): [number, number];
}

export function gridTransform(width: number, height: number, screen: Pick<HalftoneScreen, 'angle' | 'pitchX' | 'pitchY' | 'offsetX' | 'offsetY'>): GridTransform {
  const rad = (screen.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = width / 2;
  const cy = height / 2;
  const { pitchX, pitchY, offsetX, offsetY } = screen;
  return {
    cos,
    sin,
    cx,
    cy,
    pitchX,
    pitchY,
    offsetX,
    offsetY,
    toGrid(x, y) {
      const dx = x - cx;
      const dy = y - cy;
      return [(cos * dx + sin * dy + offsetX) / pitchX + 0.5, (-sin * dx + cos * dy + offsetY) / pitchY + 0.5];
    },
    toCanvas(u, v) {
      const gx = (u - 0.5) * pitchX - offsetX;
      const gy = (v - 0.5) * pitchY - offsetY;
      return [cx + cos * gx - sin * gy, cy + sin * gx + cos * gy];
    },
  };
}

/** 格子 (i, j) 的中心在旋转前的网格坐标系里的位置（画布像素，相对画布中心）；SVG 里 <g rotate> 之内就用它 */
export function cellCenter(screen: Pick<HalftoneScreen, 'lattice' | 'pitchX' | 'pitchY' | 'offsetX' | 'offsetY'>, i: number, j: number): [number, number] {
  return [(i + rowShift(screen.lattice, j)) * screen.pitchX - screen.offsetX, j * screen.pitchY - screen.offsetY];
}

/** 墨量 0..1 → 网点大小（相对格子），把增益、分级、响应曲线、最小 / 最大网点一并算进去 */
export function coverageToSize(coverage: number, opts: Pick<HalftoneSettings, 'size' | 'minSize' | 'mapping' | 'gain' | 'stepped' | 'levels'>): number {
  let c = clamp01(coverage);
  if (opts.gain !== 0) c = Math.pow(c, Math.exp(-opts.gain * 1.5));
  if (opts.stepped) {
    const n = Math.max(2, Math.round(opts.levels)) - 1;
    c = Math.round(c * n) / n;
  }
  const t = opts.mapping === 'area' ? Math.sqrt(c) : c;
  const max = opts.size;
  const min = Math.min(opts.minSize, max);
  return min + (max - min) * t;
}

/** 一张网格覆盖画布所需的格子范围（多留一圈，交错排列的半格错位也在内） */
function screenExtent(width: number, height: number, t: GridTransform): { i0: number; j0: number; cols: number; rows: number } {
  let umin = Infinity;
  let umax = -Infinity;
  let vmin = Infinity;
  let vmax = -Infinity;
  for (const [x, y] of [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ]) {
    const [u, v] = t.toGrid(x, y);
    umin = Math.min(umin, u);
    umax = Math.max(umax, u);
    vmin = Math.min(vmin, v);
    vmax = Math.max(vmax, v);
  }
  const i0 = Math.floor(umin) - 2;
  const j0 = Math.floor(vmin) - 2;
  return { i0, j0, cols: Math.ceil(umax) + 2 - i0 + 1, rows: Math.ceil(vmax) + 2 - j0 + 1 };
}

/**
 * 采样一张网格：每个格子在自己范围里取 CELL_SAMPLES² 个点，落在画布内的点取平均。
 * 回调拿到每格的平均亮度与（可选的）平均颜色，返回墨量数组（一格可对应多层墨，如 CMYK 四层）。
 */
function sampleScreen(
  src: HalftoneSource,
  t: GridTransform,
  lattice: LatticeKind,
  extent: { i0: number; j0: number; cols: number; rows: number },
  wantColor: boolean,
  onCell: (index: number, gray: number, r: number, g: number, b: number) => void,
) {
  const { i0, j0, cols, rows } = extent;
  const n = CELL_SAMPLES;
  const inv = 1 / src.sample;
  const gw = src.grayWidth;
  const gh = src.grayHeight;
  const gray = src.gray;
  const rgb = src.rgb;
  for (let jj = 0; jj < rows; jj++) {
    const j = j0 + jj;
    const shift = rowShift(lattice, j);
    for (let ii = 0; ii < cols; ii++) {
      const i = i0 + ii;
      let sum = 0;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let count = 0;
      for (let b = 0; b < n; b++) {
        const v = j + (b + 0.5) / n;
        for (let a = 0; a < n; a++) {
          const u = i + shift + (a + 0.5) / n;
          const [x, y] = t.toCanvas(u, v);
          if (x < 0 || y < 0 || x >= src.width || y >= src.height) continue;
          const sx = Math.min(gw - 1, Math.floor(x * inv));
          const sy = Math.min(gh - 1, Math.floor(y * inv));
          const k = sy * gw + sx;
          sum += gray[k];
          if (wantColor && rgb) {
            sr += rgb[k * 3];
            sg += rgb[k * 3 + 1];
            sb += rgb[k * 3 + 2];
          }
          count++;
        }
      }
      if (count === 0) continue;
      onCell(jj * cols + ii, sum / count, sr / count, sg / count, sb / count);
    }
  }
}

/** 从采样源与选项算出全部网格。mono / source 一张网格，cmyk 四张（各自的网线角度）。 */
export function buildHalftone(src: HalftoneSource, opts: HalftoneSettings): HalftoneGeometry {
  const { width, height } = src;
  const screens: HalftoneScreen[] = [];
  const makeScreen = (angle: number, ink: [number, number, number]): { screen: HalftoneScreen; t: GridTransform } => {
    const spec = { angle, pitchX: Math.max(1, opts.pitchX), pitchY: Math.max(1, opts.pitchY), offsetX: opts.offsetX, offsetY: opts.offsetY };
    const t = gridTransform(width, height, spec);
    const extent = screenExtent(width, height, t);
    const screen: HalftoneScreen = {
      ...spec,
      lattice: opts.lattice,
      ...extent,
      size: new Float32Array(extent.cols * extent.rows),
      ink,
    };
    return { screen, t };
  };

  if (opts.mode === 'cmyk') {
    const made = CMYK_ANGLES.map((a, k) => makeScreen((opts.angle + a) % 360, CMYK_INKS[k]));
    // 四层共用一套采样比较浪费，但每层网格角度不同，格子盖住的画面也不同，只能各采各的
    made.forEach(({ screen, t }, k) => {
      sampleScreen(src, t, opts.lattice, screen, true, (index, _gray, r, g, b) => {
        if (src.linear) {
          r = srgbToLinearFast(r);
          g = srgbToLinearFast(g);
          b = srgbToLinearFast(b);
        }
        const cmyk = rgbToCmyk(clamp01(r), clamp01(g), clamp01(b));
        screen.size[index] = coverageToSize(cmyk[k], opts);
      });
      screens.push(screen);
    });
  } else {
    const { screen, t } = makeScreen(opts.angle, opts.dot);
    const wantColor = opts.mode === 'source';
    if (wantColor) screen.color = new Uint8ClampedArray(screen.cols * screen.rows * 3);
    sampleScreen(src, t, opts.lattice, screen, wantColor, (index, gray, r, g, b) => {
      screen.size[index] = coverageToSize(1 - gray, opts);
      if (screen.color) {
        screen.color[index * 3] = r * 255;
        screen.color[index * 3 + 1] = g * 255;
        screen.color[index * 3 + 2] = b * 255;
      }
    });
    screens.push(screen);
  }

  return { width, height, shape: opts.shape, mode: opts.mode, paper: opts.paper, merge: opts.merge, antialias: opts.antialias, screens };
}

/** 网点大小 100% 对应的半径（画布像素）：线条按格高，其余按格子短边 */
export function baseRadius(shape: HalftoneShape, screen: Pick<HalftoneScreen, 'pitchX' | 'pitchY'>): number {
  return shape === 'line' ? screen.pitchY / 2 : Math.min(screen.pitchX, screen.pitchY) / 2;
}

/** 线条横向的半宽：铺满格宽，多出一点盖住格间接缝 */
export function lineHalfWidth(screen: Pick<HalftoneScreen, 'pitchX'>, extra = 0.5): number {
  return screen.pitchX / 2 + extra;
}

/** 有多少个要画的网点（SVG 导出估算文件规模用） */
export function countDots(g: HalftoneGeometry): number {
  let n = 0;
  for (const s of g.screens) for (let k = 0; k < s.size.length; k++) if (s.size[k] > 0) n++;
  return n;
}
