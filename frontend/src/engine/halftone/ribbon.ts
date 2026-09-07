import type { HalftoneScreen } from './geometry';

/**
 * 平滑线条（`smoothline`）：一行格子连成一条粗细顺滑起伏的带子，而不是「线条」那样一格一段、粗细在格子边界上打台阶。
 * 每格网点的大小就是带子在这一格中心处的半粗（结点），结点之间按单调三次 Hermite 曲线插值——
 * 结点处的斜率取两侧割线的调和平均（Fritsch–Butland），两侧同号才有斜率，异号或有一侧为零就放平：
 * 曲线处处一阶连续，连续变粗（或变细）的好几格是一整条平滑的坡道，不会每格拐一下；
 * 也不会过冲——细处不会被压成负数、粗处不会越出格子，局部最粗 / 最细的那一格刚好落在结点上。
 * 网格扰动的纵向位移同样插成一条平滑的中线；横向位移对连成一条的线没有意义，忽略。
 * 光栅（`render.ts`）与 SVG（`svg.ts`）都从这里取曲线，两边出自同一套几何。
 */

/** 带子在某个横向位置的剖面。半粗以「网点大小」为单位（乘 r0 得画布像素），中线偏移以格为单位（乘 pitchY），斜率都是对格坐标 x 的导数 */
export interface RibbonProfile {
  r: number;
  dr: number;
  y: number;
  dy: number;
  /** 离这个位置最近的结点在行内的列号（原图色模式取它的颜色） */
  near: number;
}

/** 结点处的斜率：两侧割线（相邻结点的差）的调和平均；异号或有一侧为零就是 0，曲线在局部极值处放平，不过冲 */
export function monotoneSlope(prev: number, cur: number, next: number): number {
  const a = cur - prev;
  const b = next - cur;
  if (a * b <= 0) return 0;
  return (2 * a * b) / (a + b);
}

/** 单位区间上的三次 Hermite 曲线在 t 处的值：y0 / y1 是两端的值，m0 / m1 是两端的斜率 */
export function hermite(t: number, y0: number, m0: number, y1: number, m1: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * m1;
}

/** 同一条曲线在 t 处的导数 */
export function hermiteSlope(t: number, y0: number, m0: number, y1: number, m1: number): number {
  const t2 = t * t;
  return (6 * t2 - 6 * t) * y0 + (3 * t2 - 4 * t + 1) * m0 + (-6 * t2 + 6 * t) * y1 + (3 * t2 - 2 * t) * m1;
}

/** 行内第 k 个结点的半粗（负数当 0），行首 / 行尾之外按端点延伸 */
function knotSize(size: Float32Array, base: number, cols: number, k: number): number {
  const v = size[base + (k < 0 ? 0 : k >= cols ? cols - 1 : k)];
  return v > 0 ? v : 0;
}

function knotOffset(dy: Float32Array, base: number, cols: number, k: number): number {
  return dy[base + (k < 0 ? 0 : k >= cols ? cols - 1 : k)];
}

/**
 * 第 rj 行（行内下标）的带子在行坐标 x 处的剖面。x 以格为单位，行首格子（列 0）的中心是 0，结点 k 落在 x = k；
 * 行首 / 行尾之外按端点的值平着延伸。结果写进 `out` 免得逐像素分配。
 */
export function ribbonProfile(screen: Pick<HalftoneScreen, 'cols' | 'size' | 'dy'>, rj: number, x: number, out: RibbonProfile): RibbonProfile {
  const { cols, size, dy } = screen;
  const base = rj * cols;
  const k = Math.floor(x);
  const t = x - k;
  const s0 = knotSize(size, base, cols, k - 1);
  const s1 = knotSize(size, base, cols, k);
  const s2 = knotSize(size, base, cols, k + 1);
  const s3 = knotSize(size, base, cols, k + 2);
  const m1 = monotoneSlope(s0, s1, s2);
  const m2 = monotoneSlope(s1, s2, s3);
  out.r = hermite(t, s1, m1, s2, m2);
  out.dr = hermiteSlope(t, s1, m1, s2, m2);
  if (dy) {
    const y0 = knotOffset(dy, base, cols, k - 1);
    const y1 = knotOffset(dy, base, cols, k);
    const y2 = knotOffset(dy, base, cols, k + 1);
    const y3 = knotOffset(dy, base, cols, k + 2);
    const n1 = monotoneSlope(y0, y1, y2);
    const n2 = monotoneSlope(y1, y2, y3);
    out.y = hermite(t, y1, n1, y2, n2);
    out.dy = hermiteSlope(t, y1, n1, y2, n2);
  } else {
    out.y = 0;
    out.dy = 0;
  }
  const near = t < 0.5 ? k : k + 1;
  out.near = near < 0 ? 0 : near >= cols ? cols - 1 : near;
  return out;
}

/**
 * 把每一行首尾没采到画面（在画布之外）的格子补成最近一个采到的格子的大小（与颜色）：带子到画布边缘保持粗细，不收尖。
 * `sampled[idx]` 非零表示这一格采到了画面；采到了但是纯白（大小 0）的格子不算在内，带子在那儿照常收尖。
 */
export function extendRowEnds(screen: Pick<HalftoneScreen, 'cols' | 'rows' | 'size' | 'color'>, sampled: Uint8Array): void {
  const { cols, rows, size, color } = screen;
  const copy = (to: number, from: number) => {
    size[to] = size[from];
    if (color) {
      color[to * 3] = color[from * 3];
      color[to * 3 + 1] = color[from * 3 + 1];
      color[to * 3 + 2] = color[from * 3 + 2];
    }
  };
  for (let rj = 0; rj < rows; rj++) {
    const base = rj * cols;
    let first = -1;
    let last = -1;
    for (let k = 0; k < cols; k++) {
      if (!sampled[base + k]) continue;
      if (first < 0) first = k;
      last = k;
    }
    if (first < 0) continue;
    for (let k = 0; k < first; k++) copy(base + k, base + first);
    for (let k = last + 1; k < cols; k++) copy(base + k, base + last);
  }
}

/** 三次贝塞尔：[x0, y0, x1, y1, x2, y2, x3, y3] */
type Cubic = number[];

/** 把一段贝塞尔在 t = 0.5 处切开（de Casteljau），取前半或后半 */
function halfCubic(c: Cubic, second: boolean): Cubic {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = c;
  const x01 = (x0 + x1) / 2;
  const y01 = (y0 + y1) / 2;
  const x12 = (x1 + x2) / 2;
  const y12 = (y1 + y2) / 2;
  const x23 = (x2 + x3) / 2;
  const y23 = (y2 + y3) / 2;
  const x012 = (x01 + x12) / 2;
  const y012 = (y01 + y12) / 2;
  const x123 = (x12 + x23) / 2;
  const y123 = (y12 + y23) / 2;
  const xm = (x012 + x123) / 2;
  const ym = (y012 + y123) / 2;
  return second ? [xm, ym, x123, y123, x23, y23, x3, y3] : [x0, y0, x01, y01, x012, y012, xm, ym];
}

/** 倒着走同一段贝塞尔 */
const reverseCubic = (c: Cubic): Cubic => [c[6], c[7], c[4], c[5], c[2], c[3], c[0], c[1]];

/**
 * 平滑线条第 rj 行（行内下标）的 SVG 路径。x0 / y0 是行首结点（列 0）的中心在网格坐标系里的位置（画布像素，旋转之前），
 * r0 是 100% 网点的半粗。每一串连续有墨的结点（两头各带一个大小为 0 的结点收尖）出一条闭合路径：
 * 上沿从左到右、下沿从右到左，每两个结点之间一段三次贝塞尔——Hermite 换成贝塞尔就是控制点从端点沿切线走三分之一，
 * 与光栅同一条曲线。`perCell`（原图色模式）时带子在相邻结点的中点切开、每格一条路径各填自己的颜色。
 * 返回的 idx 是这条路径归属的格子下标（整张网格里的）。
 */
export function ribbonPaths(
  screen: Pick<HalftoneScreen, 'cols' | 'pitchX' | 'pitchY' | 'size' | 'dy'>,
  rj: number,
  r0: number,
  x0: number,
  y0: number,
  perCell: boolean,
  fmt: (n: number) => string,
): Array<{ d: string; idx: number }> {
  const { cols, pitchX, pitchY, size, dy } = screen;
  const base = rj * cols;
  const R = new Float64Array(cols);
  const Y = new Float64Array(cols);
  for (let k = 0; k < cols; k++) {
    const v = size[base + k];
    R[k] = v > 0 ? v * r0 : 0;
    Y[k] = y0 + (dy ? dy[base + k] * pitchY : 0);
  }
  const mR = new Float64Array(cols);
  const mY = new Float64Array(cols);
  for (let k = 0; k < cols; k++) {
    const p = k > 0 ? k - 1 : k;
    const n = k < cols - 1 ? k + 1 : k;
    mR[k] = monotoneSlope(R[p], R[k], R[n]);
    mY[k] = monotoneSlope(Y[p], Y[k], Y[n]);
  }
  const h = pitchX;
  const X = (k: number) => x0 + k * h;
  /** 结点 k → k+1 这一段的上沿（sign = -1）或下沿（sign = 1） */
  const edge = (k: number, sign: -1 | 1): Cubic => {
    const ya = Y[k] + sign * R[k];
    const yb = Y[k + 1] + sign * R[k + 1];
    const ma = mY[k] + sign * mR[k];
    const mb = mY[k + 1] + sign * mR[k + 1];
    return [X(k), ya, X(k) + h / 3, ya + ma / 3, X(k + 1) - h / 3, yb - mb / 3, X(k + 1), yb];
  };
  const seg = (c: Cubic) => ` C ${fmt(c[2])} ${fmt(c[3])} ${fmt(c[4])} ${fmt(c[5])} ${fmt(c[6])} ${fmt(c[7])}`;
  const close = (top: Cubic[], bottom: Cubic[]) => {
    let d = `M ${fmt(top[0][0])} ${fmt(top[0][1])}`;
    for (const c of top) d += seg(c);
    d += ` L ${fmt(bottom[0][0])} ${fmt(bottom[0][1])}`;
    for (const c of bottom) d += seg(c);
    return `${d} Z`;
  };

  const out: Array<{ d: string; idx: number }> = [];
  let k = 0;
  while (k < cols) {
    if (R[k] <= 0) {
      k++;
      continue;
    }
    let e = k;
    while (e + 1 < cols && R[e + 1] > 0) e++;
    const lo = Math.max(0, k - 1);
    const hi = Math.min(cols - 1, e + 1);
    if (hi > lo) {
      if (perCell) {
        for (let c = lo; c <= hi; c++) {
          const top: Cubic[] = [];
          const bottom: Cubic[] = [];
          if (c > lo) top.push(halfCubic(edge(c - 1, -1), true));
          if (c < hi) top.push(halfCubic(edge(c, -1), false));
          if (c < hi) bottom.push(reverseCubic(halfCubic(edge(c, 1), false)));
          if (c > lo) bottom.push(reverseCubic(halfCubic(edge(c - 1, 1), true)));
          out.push({ d: close(top, bottom), idx: base + c });
        }
      } else {
        const top: Cubic[] = [];
        const bottom: Cubic[] = [];
        for (let c = lo; c < hi; c++) top.push(edge(c, -1));
        for (let c = hi - 1; c >= lo; c--) bottom.push(reverseCubic(edge(c, 1)));
        out.push({ d: close(top, bottom), idx: base + k });
      }
    }
    k = e + 1;
  }
  return out;
}
