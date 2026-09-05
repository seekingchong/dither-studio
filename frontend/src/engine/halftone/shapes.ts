/**
 * Halftone 网点形状的有符号距离场（SDF）。
 * 坐标 (x, y) 是相对网点中心、沿网格坐标轴的画布像素；r 是"半径"——网点大小 100% 时 r 等于格子短边的一半，
 * 每种形状都按"r 是它刚好放进 2r × 2r 格子里的尺寸"定义：圆的半径、方块的半边、菱形的半对角线、
 * 三角的半边长、六边形的外接圆半径、线条的半粗、十字的臂长。所以 100% 时任何形状都不越出自己的格子。
 * 返回值负数在形状里面，绝对值就是到边缘的距离，渲染用它做 1px 抗锯齿，点融合用它做平滑最小值。
 */

export type HalftoneShape = 'circle' | 'square' | 'roundsquare' | 'diamond' | 'triangle' | 'hexagon' | 'line' | 'cross';

export const HALFTONE_SHAPE_IDS: readonly HalftoneShape[] = ['circle', 'square', 'roundsquare', 'diamond', 'triangle', 'hexagon', 'line', 'cross'];

const SQRT3 = 1.7320508075688772;
const SQRT1_2 = Math.SQRT1_2;

/** 圆角方的圆角半径占半边的比例 */
export const ROUND_SQUARE_CORNER = 0.3;
/** 十字臂的半粗占臂长的比例 */
export const CROSS_ARM = 0.28;
/** 十字臂至少这么粗（画布像素），免得小点上臂细到看不见 */
export const CROSS_MIN_HALF_ARM = 0.35;

/** 轴对齐矩形的精确 SDF，hx / hy 为半宽 / 半高 */
function box(x: number, y: number, hx: number, hy: number): number {
  const qx = Math.abs(x) - hx;
  const qy = Math.abs(y) - hy;
  const ox = qx > 0 ? qx : 0;
  const oy = qy > 0 ? qy : 0;
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0);
}

/**
 * 形状距离。`halfWidth` 只有线条用：线条横向铺满整个格子（半宽 = 格宽一半，多出半像素盖住格间接缝），
 * 纵向粗细才随明暗变化。y 轴按屏幕方向（向下为正），三角的尖朝上。
 */
export function shapeDistance(shape: HalftoneShape, x: number, y: number, r: number, halfWidth: number): number {
  switch (shape) {
    case 'circle':
      return Math.sqrt(x * x + y * y) - r;
    case 'square':
      return box(x, y, r, r);
    case 'roundsquare': {
      const corner = r * ROUND_SQUARE_CORNER;
      return box(x, y, r - corner, r - corner) - corner;
    }
    case 'diamond':
      // 顶点在 (±r, 0) 与 (0, ±r) 的菱形：到边的精确距离
      return (Math.abs(x) + Math.abs(y) - r) * SQRT1_2;
    case 'triangle': {
      // iq 的等边三角形 SDF：r 为半边长，重心在原点；屏幕 y 向下，取负让尖朝上
      let px = Math.abs(x) - r;
      let py = -y + r / SQRT3;
      if (px + SQRT3 * py > 0) {
        const nx = (px - SQRT3 * py) / 2;
        const ny = (-SQRT3 * px - py) / 2;
        px = nx;
        py = ny;
      }
      px -= Math.min(Math.max(px, -2 * r), 0);
      const len = Math.sqrt(px * px + py * py);
      return py > 0 ? -len : len;
    }
    case 'hexagon': {
      // iq 的正六边形 SDF，参数是内切圆半径；这里 r 是外接圆半径，平边在上下
      const a = r * (SQRT3 / 2);
      let px = Math.abs(x);
      let py = Math.abs(y);
      const kx = -0.8660254037844386;
      const ky = 0.5;
      const kz = 0.5773502691896257;
      const dot = Math.min(kx * px + ky * py, 0);
      px -= 2 * dot * kx;
      py -= 2 * dot * ky;
      px -= Math.min(Math.max(px, -kz * a), kz * a);
      py -= a;
      const len = Math.sqrt(px * px + py * py);
      return py > 0 ? len : -len;
    }
    case 'line':
      return box(x, y, halfWidth, r);
    case 'cross': {
      // iq 的十字 SDF：b = (臂长, 臂半粗)
      const bx = r;
      const by = Math.max(r * CROSS_ARM, CROSS_MIN_HALF_ARM);
      let px = Math.abs(x);
      let py = Math.abs(y);
      if (py > px) {
        const t = px;
        px = py;
        py = t;
      }
      const qx = px - bx;
      const qy = py - by;
      const k = Math.max(qy, qx);
      let wx: number;
      let wy: number;
      if (k > 0) {
        wx = qx;
        wy = qy;
      } else {
        wx = by - px;
        wy = -k;
      }
      const mx = wx > 0 ? wx : 0;
      const my = wy > 0 ? wy : 0;
      const len = Math.sqrt(mx * mx + my * my);
      return k > 0 ? len : -len;
    }
  }
}

/**
 * 多边形顶点（SVG 导出用），与 SDF 同一套几何：返回相对中心的 [x, y] 序列，圆与矩形不在此列。
 * 三角尖朝上（屏幕 y 向下所以是负 y），六边形平边在上下。
 */
export function shapeVertices(shape: HalftoneShape, r: number, halfWidth: number): Array<[number, number]> | null {
  switch (shape) {
    case 'diamond':
      return [
        [0, -r],
        [r, 0],
        [0, r],
        [-r, 0],
      ];
    case 'triangle': {
      const top = (2 * r) / SQRT3;
      const base = r / SQRT3;
      return [
        [0, -top],
        [r, base],
        [-r, base],
      ];
    }
    case 'hexagon': {
      const pts: Array<[number, number]> = [];
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k;
        pts.push([r * Math.cos(a), r * Math.sin(a)]);
      }
      return pts;
    }
    case 'cross': {
      const t = Math.max(r * CROSS_ARM, CROSS_MIN_HALF_ARM);
      return [
        [-t, -r],
        [t, -r],
        [t, -t],
        [r, -t],
        [r, t],
        [t, t],
        [t, r],
        [-t, r],
        [-t, t],
        [-r, t],
        [-r, -t],
        [-t, -t],
      ];
    }
    case 'line':
      return [
        [-halfWidth, -r],
        [halfWidth, -r],
        [halfWidth, r],
        [-halfWidth, r],
      ];
    default:
      return null;
  }
}
