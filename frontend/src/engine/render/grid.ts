import type { CellFrame, RGBAFrame } from '../types';
import { renderCells } from './upscale';

export type DotShape = 'square' | 'euclidean' | 'roundsquare';
export type BackgroundKind = 'none' | 'lines' | 'dots';
export type LineDirection = 'row' | 'col';
export type BgDotShape = 'circle' | 'square' | 'diamond' | 'cross';

export interface GridRenderOptions {
  dot: DotShape;
  /** 网点直径相对格子的比例 0..1.5 */
  dotSize: number;
  /** 网点随格子明暗缩放（越接近背景色越小） */
  dotTone: boolean;
  /** 反向：背景用墨色，网点画亮格子 */
  invert: boolean;
  metaball: boolean;
  /** 融合半径相对格子的倍率 */
  metaballRadius: number;
  /** 格子内留出的背景间距（画布像素） */
  gapX: number;
  gapY: number;
  /** 纸色（最亮）与墨色（最暗），0..255 */
  paper: [number, number, number];
  ink: [number, number, number];
  background: BackgroundKind;
  lineDirection: LineDirection;
  lineWidth: number;
  bgColor: [number, number, number];
  bgDotShape: BgDotShape;
  /** 背景图形直径相对格子的比例 0..1 */
  bgDotSize: number;
}

export const DEFAULT_GRID: GridRenderOptions = {
  dot: 'square',
  dotSize: 1,
  dotTone: false,
  invert: false,
  metaball: false,
  metaballRadius: 1.2,
  gapX: 0,
  gapY: 0,
  paper: [255, 255, 255],
  ink: [0, 0, 0],
  background: 'none',
  lineDirection: 'row',
  lineWidth: 1,
  bgColor: [136, 136, 136],
  bgDotShape: 'circle',
  bgDotSize: 0.3,
};

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function isPlain(o: GridRenderOptions): boolean {
  return o.dot === 'square' && !o.metaball && o.gapX === 0 && o.gapY === 0 && o.background === 'none' && !o.invert && !o.dotTone;
}

/** 形状判定：u, v 为相对格子内区的归一化坐标 (-1..1)，s 为直径比例 */
function insideDot(shape: DotShape, u: number, v: number, s: number): boolean {
  if (s <= 0) return false;
  switch (shape) {
    case 'euclidean':
      return u * u + v * v <= s * s;
    case 'roundsquare': {
      const a = u * u * u * u + v * v * v * v;
      return a <= s * s * s * s;
    }
    case 'square':
    default:
      return Math.abs(u) <= s && Math.abs(v) <= s;
  }
}

/** 背景图形判定；pxNorm 为一个画布像素在归一化坐标里的长度，保证细臂至少 1px */
function insideBgShape(shape: BgDotShape, u: number, v: number, s: number, pxNorm: number): boolean {
  if (s <= 0) return false;
  switch (shape) {
    case 'square':
      return Math.abs(u) <= s && Math.abs(v) <= s;
    case 'diamond':
      return Math.abs(u) + Math.abs(v) <= s;
    case 'cross': {
      const arm = Math.max(s * 0.25, pxNorm * 0.5);
      return (Math.abs(u) <= arm && Math.abs(v) <= s) || (Math.abs(v) <= arm && Math.abs(u) <= s);
    }
    case 'circle':
    default:
      return u * u + v * v <= s * s;
  }
}

/**
 * 网格渲染：每个格子按网点形状、间距、背景画到画布上；点融合用 Wyvill 核把相邻网点连成 blob。
 * 格子 (i, j) 覆盖画布像素 x ∈ [i*size - offsetX, (i+1)*size - offsetX)。
 */
export function renderGrid(
  cells: CellFrame,
  width: number,
  height: number,
  size: number,
  offsetX: number,
  offsetY: number,
  opts: GridRenderOptions,
): RGBAFrame {
  if (isPlain(opts)) return renderCells(cells, width, height, size, offsetX, offsetY);

  const out = new Uint8ClampedArray(width * height * 4);
  const cw = cells.width;
  const ch = cells.height;
  const cdata = cells.data;
  const ox = ((offsetX % size) + size) % size;
  const oy = ((offsetY % size) + size) % size;
  const bg = opts.invert ? opts.ink : opts.paper;
  const bgLum = luma(bg[0], bg[1], bg[2]);
  const range = Math.max(1, Math.abs(luma(opts.paper[0], opts.paper[1], opts.paper[2]) - luma(opts.ink[0], opts.ink[1], opts.ink[2])));

  // 每个格子相对背景的对比度 0..1：决定是否画点、点的大小、融合权重
  const strength = new Float32Array(cw * ch);
  for (let i = 0, j = 0; i < strength.length; i++, j += 4) {
    strength[i] = Math.min(1, Math.abs(luma(cdata[j], cdata[j + 1], cdata[j + 2]) - bgLum) / range);
  }

  const innerW = Math.max(1, size - opts.gapX);
  const innerH = Math.max(1, size - opts.gapY);
  const halfW = innerW / 2;
  const halfH = innerH / 2;
  const cx0 = opts.gapX / 2 + halfW; // 格子内区中心（格子局部坐标）
  const cy0 = opts.gapY / 2 + halfH;
  const lineHalf = opts.lineWidth / 2;
  const blobRadius = size * opts.metaballRadius;
  const blobReach = Math.ceil(opts.metaballRadius) + 1;

  const cellIndexX = new Int32Array(width);
  const localX = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    const gx = x + ox;
    const i = Math.floor(gx / size);
    cellIndexX[x] = Math.min(cw - 1, i);
    localX[x] = gx - i * size + 0.5;
  }

  for (let y = 0; y < height; y++) {
    const gy = y + oy;
    const j = Math.min(ch - 1, Math.floor(gy / size));
    const ly = gy - Math.floor(gy / size) * size + 0.5;
    const v = (ly - cy0) / halfH;
    const rowOut = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = cellIndexX[x];
      const lx = localX[x];
      const u = (lx - cx0) / halfW;
      let r = bg[0];
      let g = bg[1];
      let b = bg[2];

      // 背景层
      if (opts.background === 'lines') {
        const along = opts.lineDirection === 'row' ? Math.abs(ly - size / 2) : Math.abs(lx - size / 2);
        if (along <= lineHalf) [r, g, b] = opts.bgColor;
      } else if (opts.background === 'dots') {
        if (insideBgShape(opts.bgDotShape, (lx - size / 2) / (size / 2), (ly - size / 2) / (size / 2), opts.bgDotSize, 2 / size)) [r, g, b] = opts.bgColor;
      }

      // 网点层
      let hit = false;
      let cellIdx = j * cw + i;
      if (opts.metaball) {
        let field = 0;
        let best = -1;
        let bestContrib = 0;
        const px = x + ox;
        const py = y + oy;
        const jMin = Math.max(0, j - blobReach);
        const jMax = Math.min(ch - 1, j + blobReach);
        const iMin = Math.max(0, i - blobReach);
        const iMax = Math.min(cw - 1, i + blobReach);
        for (let cj = jMin; cj <= jMax; cj++) {
          const cyc = cj * size + cy0;
          for (let ci = iMin; ci <= iMax; ci++) {
            const s = strength[cj * cw + ci];
            if (s <= 0) continue;
            const cxc = ci * size + cx0;
            const dx = px + 0.5 - cxc;
            const dy = py + 0.5 - cyc;
            const t = Math.sqrt(dx * dx + dy * dy) / blobRadius;
            if (t >= 1) continue;
            const k = (1 - t * t) * (1 - t * t);
            const contrib = k * s * (opts.dotTone ? 1 : 1) * opts.dotSize;
            field += contrib;
            if (contrib > bestContrib) {
              bestContrib = contrib;
              best = cj * cw + ci;
            }
          }
        }
        // 单个满强度网点在中心 field = dotSize；阈值取 0.5 × dotSize 让 100% 时直径约等于格子
        if (field >= 0.5 * opts.dotSize && best >= 0) {
          hit = true;
          cellIdx = best;
        }
      } else {
        const s = strength[cellIdx];
        if (s > 0) {
          const diameter = opts.dotTone ? opts.dotSize * s : opts.dotSize;
          if (Math.abs(u) <= 1 && Math.abs(v) <= 1 && insideDot(opts.dot, u, v, diameter)) hit = true;
        }
      }

      if (hit) {
        const k = cellIdx * 4;
        r = cdata[k];
        g = cdata[k + 1];
        b = cdata[k + 2];
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
