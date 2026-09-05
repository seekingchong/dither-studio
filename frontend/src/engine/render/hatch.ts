import { clamp01, type GrayFrame, type LevelFrame, type RGBAFrame } from '../types';

export type HatchLink = 'none' | 'stroke' | 'row' | 'col' | 'grid';

/**
 * 排线风格：画布按横纵间距划成格子，每格一笔。笔的角度、长度、圆角全图一致，
 * 粗细按格子明暗分档——越暗越粗。可选再叠一层垂直方向的线（交叉排线），
 * 以及一根把每笔串起来的细线（沿笔画 / 横 / 纵 / 横纵）。
 */
export interface HatchOptions {
  /** 笔画角度（度）：0 横、90 竖，45 是「/」 */
  angle: number;
  /** 格子宽 / 高（画布像素） */
  spacingX: number;
  spacingY: number;
  /** 明暗档数，每档一种粗细 */
  levels: number;
  /** 长度：以贯穿格子的弦长为 1 */
  length: number;
  /** 最粗 / 最细：以相邻平行线的间距为 1 */
  maxWidth: number;
  minWidth: number;
  /** 两端圆角 0..1（1 为胶囊形） */
  roundness: number;
  /** 暗部叠一层垂直方向的线 */
  cross: boolean;
  /** 第二层从几成暗度开始出现 0..1 */
  crossStart: number;
  /** 奇数行右移的比例 0..1（1 为整格） */
  stagger: number;
  link: HatchLink;
  /** 串线粗细（画布像素） */
  linkWidth: number;
  linkColor: [number, number, number];
  ink: [number, number, number];
  paper: [number, number, number];
}

export const DEFAULT_HATCH: HatchOptions = {
  angle: 45,
  spacingX: 14,
  spacingY: 14,
  levels: 6,
  length: 0.8,
  maxWidth: 0.7,
  minWidth: 0.08,
  roundness: 0.4,
  cross: false,
  crossStart: 0.5,
  stagger: 0,
  link: 'none',
  linkWidth: 1,
  linkColor: [154, 154, 154],
  ink: [28, 28, 28],
  paper: [217, 217, 217],
};

/** 一层笔画的几何：方向、贯穿格子的弦长、相邻平行线的间距、各档粗细 */
export interface StrokeLayer {
  /** 角度（度） */
  angle: number;
  /** 单位方向（屏幕坐标，y 向下） */
  dx: number;
  dy: number;
  /** 单位法向 */
  nx: number;
  ny: number;
  /** 沿方向贯穿格子的弦长 */
  chord: number;
  /** 相邻平行线之间的垂直距离 */
  pitch: number;
  /** 笔画长度（画布像素） */
  length: number;
  /** 每档粗细（画布像素），0 表示这一档不画 */
  widths: Float32Array;
}

const EPS = 1e-6;

/** 沿方向 (dx, dy) 穿过 sx × sy 格子中心的弦长 */
export function chordOf(dx: number, dy: number, sx: number, sy: number): number {
  const cx = Math.abs(dx) > EPS ? sx / Math.abs(dx) : Infinity;
  const cy = Math.abs(dy) > EPS ? sy / Math.abs(dy) : Infinity;
  return Math.min(cx, cy);
}

/**
 * 相邻平行线的间距：看 (1,0) (0,1) (1,1) (1,-1) 四个邻居的线离本格的线多远，取最近的一条；
 * 沿笔画方向排在首尾的邻居（投影超过半个弦长）不算——那是接在后面的，不是挨在旁边的。
 */
export function pitchOf(dx: number, dy: number, nx: number, ny: number, sx: number, sy: number, chord: number): number {
  let best = Infinity;
  for (const [a, b] of [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ]) {
    const ox = a * sx;
    const oy = b * sy;
    const along = Math.abs(ox * dx + oy * dy);
    const across = Math.abs(ox * nx + oy * ny);
    if (across < EPS) continue;
    if (along > chord * 0.505 + EPS) continue;
    if (across < best) best = across;
  }
  return Number.isFinite(best) ? best : Math.min(sx, sy);
}

/** 主层各档粗细：最亮档 minWidth、最暗档 maxWidth，之间线性；非零的至少 1px，免得细线糊成灰 */
export function levelWidths(levels: number, minWidth: number, maxWidth: number, pitch: number): Float32Array {
  const out = new Float32Array(levels);
  for (let k = 0; k < levels; k++) {
    const t = levels > 1 ? k / (levels - 1) : 1;
    const w = pitch * (minWidth + (maxWidth - minWidth) * t);
    out[k] = w > 0 ? Math.max(1, w) : 0;
  }
  return out;
}

/** 交叉层各档粗细：暗度过了起点才出现，到最暗档达到 maxWidth */
export function crossWidths(levels: number, maxWidth: number, start: number, pitch: number): Float32Array {
  const out = new Float32Array(levels);
  for (let k = 0; k < levels; k++) {
    const t = levels > 1 ? k / (levels - 1) : 1;
    const u = start >= 1 ? 0 : Math.max(0, (t - start) / (1 - start));
    const w = pitch * maxWidth * u;
    out[k] = w > 0 ? Math.max(1, w) : 0;
  }
  return out;
}

function makeLayer(angle: number, sx: number, sy: number, length: number): Omit<StrokeLayer, 'widths'> {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = -Math.sin(rad);
  const nx = Math.sin(rad);
  const ny = Math.cos(rad);
  const chord = chordOf(dx, dy, sx, sy);
  const pitch = pitchOf(dx, dy, nx, ny, sx, sy, chord);
  return { angle, dx, dy, nx, ny, chord, pitch, length: chord * length };
}

/** 主层 + 可选的交叉层；档数以分档结果自带的为准（levels 参数），默认取选项里的 */
export function hatchLayers(opts: HatchOptions, sx: number, sy: number, levels = opts.levels): StrokeLayer[] {
  const minWidth = Math.min(opts.minWidth, opts.maxWidth);
  const primary = makeLayer(opts.angle, sx, sy, opts.length);
  const layers: StrokeLayer[] = [{ ...primary, widths: levelWidths(levels, minWidth, opts.maxWidth, primary.pitch) }];
  if (opts.cross) {
    const cross = makeLayer(opts.angle + 90, sx, sy, opts.length);
    layers.push({ ...cross, widths: crossWidths(levels, opts.maxWidth, opts.crossStart, cross.pitch) });
  }
  return layers;
}

/** 奇数行的右移量（画布像素） */
export function rowShift(j: number, stagger: number, sx: number): number {
  return (j & 1) === 1 ? stagger * sx : 0;
}

/**
 * 明暗分档：每格 0..levels-1 的暗度档位（0 最亮）。
 * 错行时奇数行的笔心在两格之间，亮度按错开比例在相邻两格之间插值，笔画落在哪就取哪里的明暗。
 */
export function quantizeHatch(gray: GrayFrame, levels: number, stagger = 0): LevelFrame {
  const { width, height, data } = gray;
  const out = new Uint8Array(width * height);
  const n = Math.max(2, Math.round(levels));
  for (let j = 0; j < height; j++) {
    const odd = stagger > 0 && (j & 1) === 1;
    const row = j * width;
    for (let i = 0; i < width; i++) {
      let g = data[row + i];
      if (odd) {
        const next = data[row + Math.min(width - 1, i + 1)];
        g += (next - g) * stagger;
      }
      const dark = 1 - clamp01(g);
      let k = Math.floor(dark * n);
      if (k >= n) k = n - 1;
      out[row + i] = k;
    }
  }
  return { width, height, levels: n, data: out };
}

/** 圆角矩形的有符号距离：u 沿笔画、v 垂直笔画，hl / hw 为半长 / 半宽，r 为圆角 */
function strokeSdf(u: number, v: number, hl: number, hw: number, r: number): number {
  const qx = Math.abs(u) - (hl - r);
  const qy = Math.abs(v) - (hw - r);
  const mx = qx > 0 ? qx : 0;
  const my = qy > 0 ? qy : 0;
  return Math.sqrt(mx * mx + my * my) + Math.min(Math.max(qx, qy), 0) - r;
}

/** 把一笔画进覆盖率缓冲（取最大值合并），边缘 1px 抗锯齿 */
function rasterStroke(cov: Float32Array, width: number, height: number, cx: number, cy: number, layer: StrokeLayer, w: number, roundness: number) {
  const hl = layer.length / 2;
  const hw = w / 2;
  const r = roundness * Math.min(hl, hw);
  const { dx, dy, nx, ny } = layer;
  const ex = hl * Math.abs(dx) + hw * Math.abs(nx) + 1;
  const ey = hl * Math.abs(dy) + hw * Math.abs(ny) + 1;
  const x0 = Math.max(0, Math.floor(cx - ex));
  const x1 = Math.min(width - 1, Math.ceil(cx + ex));
  const y0 = Math.max(0, Math.floor(cy - ey));
  const y1 = Math.min(height - 1, Math.ceil(cy + ey));
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5 - cy;
    const row = y * width;
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5 - cx;
      const u = px * dx + py * dy;
      const v = px * nx + py * ny;
      const c = 0.5 - strokeSdf(u, v, hl, hw, r);
      if (c <= 0) continue;
      const a = c >= 1 ? 1 : c;
      if (a > cov[row + x]) cov[row + x] = a;
    }
  }
}

const coverage = (c: number) => (c <= 0 ? 0 : c >= 1 ? 1 : c);

/**
 * 排线渲染：格子 (i, j) 覆盖画布像素 x ∈ [i*sx - offsetX, (i+1)*sx - offsetX)，笔心在格子中心（奇数行按错行右移）。
 * 先把每一笔按圆角矩形的距离场画进覆盖率缓冲，再逐像素合成：纸色 → 串线 → 笔画。
 */
export function renderHatch(
  levels: LevelFrame,
  width: number,
  height: number,
  sx: number,
  sy: number,
  offsetX: number,
  offsetY: number,
  opts: HatchOptions,
): RGBAFrame {
  const ox = ((offsetX % sx) + sx) % sx;
  const oy = ((offsetY % sy) + sy) % sy;
  const cw = levels.width;
  const ch = levels.height;
  const layers = hatchLayers(opts, sx, sy, levels.levels);
  const cov = new Float32Array(width * height);

  for (const layer of layers) {
    for (let j = 0; j < ch; j++) {
      const cy = (j + 0.5) * sy - oy;
      const shift = rowShift(j, opts.stagger, sx);
      for (let i = 0; i < cw; i++) {
        const w = layer.widths[levels.data[j * cw + i]];
        if (w <= 0) continue;
        rasterStroke(cov, width, height, (i + 0.5) * sx - ox + shift, cy, layer, w, opts.roundness);
      }
    }
  }

  const out = new Uint8ClampedArray(width * height * 4);
  const { paper, ink, linkColor, link } = opts;
  const lh = opts.linkWidth / 2;
  const rows = link === 'row' || link === 'grid';
  const cols = link === 'col' || link === 'grid';
  const along = link === 'stroke';
  const { nx, ny } = layers[0];
  for (let y = 0; y < height; y++) {
    const gy = y + oy;
    const j = Math.floor(gy / sy);
    const ly = gy - j * sy + 0.5;
    const shift = rowShift(j, opts.stagger, sx);
    const rowCov = rows ? coverage(lh + 0.5 - Math.abs(ly - sy / 2)) : 0;
    const rowOut = y * width * 4;
    for (let x = 0; x < width; x++) {
      let r = paper[0];
      let g = paper[1];
      let b = paper[2];
      if (link !== 'none') {
        let lc = rowCov;
        if (cols || along) {
          const gx = x + ox - shift;
          const lx = gx - Math.floor(gx / sx) * sx + 0.5;
          if (cols) lc = Math.max(lc, coverage(lh + 0.5 - Math.abs(lx - sx / 2)));
          if (along) lc = Math.max(lc, coverage(lh + 0.5 - Math.abs((lx - sx / 2) * nx + (ly - sy / 2) * ny)));
        }
        if (lc > 0) {
          r += (linkColor[0] - r) * lc;
          g += (linkColor[1] - g) * lc;
          b += (linkColor[2] - b) * lc;
        }
      }
      const a = cov[y * width + x];
      if (a > 0) {
        r += (ink[0] - r) * a;
        g += (ink[1] - g) * a;
        b += (ink[2] - b) * a;
      }
      const o = rowOut + x * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }
  }
  return { width, height, data: out };
}
