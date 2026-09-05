import type { RGBAFrame } from '../types';
import { baseRadius, lineHalfWidth, rowShift, type HalftoneGeometry, type HalftoneScreen, type LatticeKind } from './geometry';
import { shapeDistance, type HalftoneShape } from './shapes';

/**
 * Halftone 光栅渲染：逐像素求到最近网点边缘的有符号距离，1px 内做抗锯齿；
 * 点融合用多项式平滑最小值（smooth-min）把相邻网点的距离场揉在一起，
 * 只在两个点靠得比融合半径近时才长出桥，单独的小点大小不变（模糊 + 阈值那种做法会把小点吃掉）。
 * CMYK 四层各自求覆盖率，再按墨色在纸色上做正片叠底。
 */

/** iq 的多项式 smooth-min：k 为融合半径（画布像素） */
export function smoothMin(a: number, b: number, k: number): number {
  if (k <= 0) return a < b ? a : b;
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return (a < b ? a : b) - h * h * k * 0.25;
}

interface ScreenContext {
  screen: HalftoneScreen;
  shape: HalftoneShape;
  lattice: LatticeKind;
  cos: number;
  sin: number;
  cx: number;
  cy: number;
  invPitchX: number;
  invPitchY: number;
  /** 100% 网点的半径 */
  r0: number;
  halfWidth: number;
  /** 融合半径（画布像素），0 不融合 */
  k: number;
  /** 往周围找几圈格子 */
  reach: number;
  /** 上一次 distanceAt 时离得最近的那个格子下标（原图色模式取它的颜色） */
  best: number;
}

/** 预处理一张网格：把每像素都要用的常量算好，并按网点最大尺寸与融合半径决定要看几圈邻格 */
function prepare(g: HalftoneGeometry, screen: HalftoneScreen): ScreenContext {
  const rad = (screen.angle * Math.PI) / 180;
  const r0 = baseRadius(g.shape, screen);
  const minPitch = Math.min(screen.pitchX, screen.pitchY);
  const halfMin = minPitch / 2;
  let maxSize = 0;
  for (let i = 0; i < screen.size.length; i++) if (screen.size[i] > maxSize) maxSize = screen.size[i];
  const rMax = maxSize * r0;
  // 多项式 smooth-min 最多把距离往里拉 k / 4：融合度 100% 时 k 取一个格距，两个半格大的点刚好能接上
  const k = g.merge > 0 ? g.merge * minPitch : 0;
  let reach: number;
  if (k > 0 && rMax + k + 1 > minPitch) reach = 2;
  else if (k === 0 && g.shape !== 'line' && rMax + 1 <= halfMin) reach = 0;
  else reach = 1;
  return {
    screen,
    shape: g.shape,
    lattice: screen.lattice,
    cos: Math.cos(rad),
    sin: Math.sin(rad),
    cx: g.width / 2,
    cy: g.height / 2,
    invPitchX: 1 / screen.pitchX,
    invPitchY: 1 / screen.pitchY,
    r0,
    halfWidth: lineHalfWidth(screen),
    k,
    reach,
    best: -1,
  };
}

/** 画布像素 (px, py) 到这张网格上最近网点边缘的有符号距离（融合时是揉过的距离） */
function distanceAt(c: ScreenContext, px: number, py: number): number {
  const s = c.screen;
  const dx = px - c.cx;
  const dy = py - c.cy;
  const u = (c.cos * dx + c.sin * dy + s.offsetX) * c.invPitchX + 0.5;
  const v = (-c.sin * dx + c.cos * dy + s.offsetY) * c.invPitchY + 0.5;
  const j0 = Math.floor(v);
  const R = c.reach;
  let d = Infinity;
  let bestD = Infinity;
  let best = -1;
  for (let jj = j0 - R; jj <= j0 + R; jj++) {
    const rj = jj - s.j0;
    if (rj < 0 || rj >= s.rows) continue;
    const shift = rowShift(c.lattice, jj);
    const ic = Math.floor(u - shift);
    const ly = (v - (jj + 0.5)) * s.pitchY;
    const rowBase = rj * s.cols;
    for (let ii = ic - R; ii <= ic + R; ii++) {
      const ri = ii - s.i0;
      if (ri < 0 || ri >= s.cols) continue;
      const idx = rowBase + ri;
      const sz = s.size[idx];
      if (sz <= 0) continue;
      const lx = (u - (ii + 0.5 + shift)) * s.pitchX;
      const dd = shapeDistance(c.shape, lx, ly, sz * c.r0, c.halfWidth);
      d = c.k > 0 ? smoothMin(d, dd, c.k) : dd < d ? dd : d;
      if (dd < bestD) {
        bestD = dd;
        best = idx;
      }
    }
  }
  c.best = best;
  return d;
}

export function renderHalftone(g: HalftoneGeometry): RGBAFrame {
  const { width, height } = g;
  const out = new Uint8ClampedArray(width * height * 4);
  const ctxs = g.screens.map((s) => prepare(g, s));
  const [pr, pg, pb] = g.paper;
  const aa = g.antialias;
  const coverage = (d: number) => (aa ? (d <= -0.5 ? 1 : d >= 0.5 ? 0 : 0.5 - d) : d <= 0 ? 1 : 0);

  if (g.mode === 'cmyk') {
    const inks = ctxs.map((c) => c.screen.ink.map((v) => 1 - v / 255));
    for (let y = 0; y < height; y++) {
      const py = y + 0.5;
      for (let x = 0; x < width; x++) {
        const px = x + 0.5;
        let r = pr;
        let gg = pg;
        let b = pb;
        for (let n = 0; n < ctxs.length; n++) {
          const cov = coverage(distanceAt(ctxs[n], px, py));
          if (cov <= 0) continue;
          const ink = inks[n];
          r *= 1 - cov * ink[0];
          gg *= 1 - cov * ink[1];
          b *= 1 - cov * ink[2];
        }
        const o = (y * width + x) * 4;
        out[o] = r;
        out[o + 1] = gg;
        out[o + 2] = b;
        out[o + 3] = 255;
      }
    }
    return { width, height, data: out };
  }

  const c = ctxs[0];
  const color = c.screen.color;
  const [ir, ig, ib] = c.screen.ink;
  for (let y = 0; y < height; y++) {
    const py = y + 0.5;
    for (let x = 0; x < width; x++) {
      const cov = coverage(distanceAt(c, x + 0.5, py));
      const o = (y * width + x) * 4;
      if (cov <= 0) {
        out[o] = pr;
        out[o + 1] = pg;
        out[o + 2] = pb;
      } else if (color && c.best >= 0) {
        const k = c.best * 3;
        out[o] = pr + (color[k] - pr) * cov;
        out[o + 1] = pg + (color[k + 1] - pg) * cov;
        out[o + 2] = pb + (color[k + 2] - pb) * cov;
      } else {
        out[o] = pr + (ir - pr) * cov;
        out[o + 1] = pg + (ig - pg) * cov;
        out[o + 2] = pb + (ib - pb) * cov;
      }
      out[o + 3] = 255;
    }
  }
  return { width, height, data: out };
}
