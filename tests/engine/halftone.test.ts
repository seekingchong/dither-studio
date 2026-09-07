import { describe, expect, it } from 'vitest';
import {
  CMYK_ANGLES,
  MAX_SVG_DOTS,
  Pipeline,
  buildHalftone,
  buildWarp,
  countDots,
  coverageToSize,
  DEFAULT_HALFTONE,
  extendRowEnds,
  gridTransform,
  halftoneToSvg,
  hermite,
  hermiteSlope,
  monotoneSlope,
  renderHalftone,
  renderImage,
  ribbonProfile,
  scaleParamsForPreview,
  shapeDistance,
  shapeVertices,
  smoothMin,
  type HalftoneGeometry,
  type HalftoneSettings,
  type HalftoneShape,
  type HalftoneSource,
} from '@/engine';
import { halftoneSampleSize } from '@/engine/pipeline';
import { defaultParams } from '@/params';
import { makeFrame } from './helpers';

const px = (f: { width: number; data: Uint8ClampedArray }, x: number, y: number) => {
  const i = (y * f.width + x) * 4;
  return [f.data[i], f.data[i + 1], f.data[i + 2]];
};

/** 单一亮度（或颜色）的采样源：画布 width × height，不缩小 */
function flatSource(width: number, height: number, gray: number, rgb?: [number, number, number]): HalftoneSource {
  const n = width * height;
  const src: HalftoneSource = { width, height, sample: 1, grayWidth: width, grayHeight: height, gray: new Float32Array(n).fill(gray), linear: false };
  if (rgb) {
    src.rgb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      src.rgb[i * 3] = rgb[0];
      src.rgb[i * 3 + 1] = rgb[1];
      src.rgb[i * 3 + 2] = rgb[2];
    }
  }
  return src;
}

const opts = (patch: Partial<HalftoneSettings> = {}): HalftoneSettings => ({ ...DEFAULT_HALFTONE, ...patch });

describe('网点形状距离场', () => {
  it.each(['circle', 'square', 'roundsquare', 'diamond', 'triangle', 'hexagon', 'line', 'smoothline', 'cross'] as HalftoneShape[])('%s：中心在里面，远处在外面，边界附近过零', (shape) => {
    expect(shapeDistance(shape, 0, 0, 5, 6)).toBeLessThan(0);
    expect(shapeDistance(shape, 40, 40, 5, 6)).toBeGreaterThan(0);
    // 100% 时不越出 2r × 2r 的格子：格子四角之外一律为正
    expect(shapeDistance(shape, 5.01, 5.01, 5, 5)).toBeGreaterThanOrEqual(0);
  });

  it('圆与方的距离是精确的欧氏距离', () => {
    expect(shapeDistance('circle', 3, 4, 5, 0)).toBeCloseTo(0, 6);
    expect(shapeDistance('circle', 6, 8, 5, 0)).toBeCloseTo(5, 6);
    expect(shapeDistance('square', 7, 0, 5, 0)).toBeCloseTo(2, 6);
    expect(shapeDistance('square', 0, 0, 5, 0)).toBeCloseTo(-5, 6);
    expect(shapeDistance('diamond', 5, 0, 5, 0)).toBeCloseTo(0, 6);
  });

  it('线条横向铺满格子，粗细由 r 决定', () => {
    expect(shapeDistance('line', 5.9, 0, 1, 6)).toBeLessThan(0);
    expect(shapeDistance('line', 0, 1.5, 1, 6)).toBeGreaterThan(0);
    expect(shapeDistance('line', 0, 0.5, 1, 6)).toBeLessThan(0);
  });

  it('多边形顶点与距离场同一套几何：顶点落在边界上', () => {
    for (const shape of ['diamond', 'triangle', 'hexagon', 'cross'] as HalftoneShape[]) {
      const pts = shapeVertices(shape, 8, 6)!;
      expect(pts.length).toBeGreaterThanOrEqual(3);
      for (const [x, y] of pts) expect(Math.abs(shapeDistance(shape, x, y, 8, 6)), `${shape} (${x},${y})`).toBeLessThan(0.05);
    }
    expect(shapeVertices('circle', 8, 6)).toBeNull();
  });

  it('smoothMin 在两值相近时低于两者，相差远时就是最小值', () => {
    expect(smoothMin(1, 1, 2)).toBeLessThan(1);
    expect(smoothMin(1, 10, 2)).toBe(1);
    expect(smoothMin(1, 10, 0)).toBe(1);
  });
});

describe('墨量 → 网点大小', () => {
  it('两端落在最小 / 最大网点上，面积正比走平方根', () => {
    const o = { size: 1, minSize: 0.1, mapping: 'area' as const, gain: 0, stepped: false, levels: 6 };
    expect(coverageToSize(0, o)).toBeCloseTo(0.1);
    expect(coverageToSize(1, o)).toBeCloseTo(1);
    expect(coverageToSize(0.25, o)).toBeCloseTo(0.1 + 0.9 * 0.5);
    expect(coverageToSize(0.25, { ...o, mapping: 'linear' })).toBeCloseTo(0.1 + 0.9 * 0.25);
    // 最小网点大于最大网点时以最大为准
    expect(coverageToSize(0, { ...o, size: 0.2, minSize: 0.5 })).toBeCloseTo(0.2);
  });

  it('增益放大或缩小中间调；分级后只剩 N 档', () => {
    const o = { size: 1, minSize: 0, mapping: 'linear' as const, gain: 0, stepped: false, levels: 6 };
    expect(coverageToSize(0.5, { ...o, gain: 0.5 })).toBeGreaterThan(0.5);
    expect(coverageToSize(0.5, { ...o, gain: -0.5 })).toBeLessThan(0.5);
    const sizes = new Set<number>();
    for (let c = 0; c <= 1; c += 0.01) sizes.add(coverageToSize(c, { ...o, stepped: true, levels: 4 }));
    expect(sizes.size).toBe(4);
    expect([...sizes].sort().map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 1 / 3, 2 / 3, 1].map((v) => Math.round(v * 1e6) / 1e6));
  });
});

describe('网格几何', () => {
  it('画布 ↔ 网格坐标互逆，且绕画布中心旋转', () => {
    const t = gridTransform(100, 60, { angle: 30, pitchX: 10, pitchY: 8, offsetX: 3, offsetY: -2 });
    const [u, v] = t.toGrid(37, 21);
    const [x, y] = t.toCanvas(u, v);
    expect(x).toBeCloseTo(37, 6);
    expect(y).toBeCloseTo(21, 6);
    // 画布中心在任何角度下都是格子 (0, 0) 的中心
    for (const angle of [0, 30, 77]) {
      const [u, v] = gridTransform(100, 60, { angle, pitchX: 10, pitchY: 8, offsetX: 0, offsetY: 0 }).toGrid(50, 30);
      expect(u).toBeCloseTo(0.5);
      expect(v).toBeCloseTo(0.5);
    }
  });

  it('从左到右的渐变：网点从右往左越来越大', () => {
    const width = 96;
    const height = 24;
    const gray = new Float32Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) gray[y * width + x] = x / (width - 1);
    const src: HalftoneSource = { width, height, sample: 1, grayWidth: width, grayHeight: height, gray, linear: false };
    const g = buildHalftone(src, opts({ pitchX: 12, pitchY: 12, minSize: 0 }));
    expect(g.screens.length).toBe(1);
    const s = g.screens[0];
    // 取穿过画布中线的那一行格子，按列收集大小
    const [, vMid] = gridTransform(width, height, s).toGrid(width / 2, height / 2);
    const row = Math.floor(vMid) - s.j0;
    const sizes: number[] = [];
    for (let c = 0; c < s.cols; c++) {
      const v = s.size[row * s.cols + c];
      if (v > 0) sizes.push(v);
    }
    expect(sizes.length).toBe(9);
    for (let k = 1; k < sizes.length; k++) expect(sizes[k]).toBeLessThan(sizes[k - 1]);
    // 画布外的格子不画
    expect(countDots(g)).toBeLessThan(s.cols * s.rows);
  });

  it('CMYK 分色出四张网格，网线角度是常规角 + 网格角度；纯青只有青版有墨', () => {
    const src = flatSource(48, 48, 0.5, [0, 1, 1]);
    const g = buildHalftone(src, opts({ mode: 'cmyk', angle: 10, minSize: 0, pitchX: 8, pitchY: 8 }));
    expect(g.screens.map((s) => s.angle)).toEqual(CMYK_ANGLES.map((a) => a + 10));
    const inkOf = (k: number) => Math.max(...g.screens[k].size);
    expect(inkOf(0)).toBeCloseTo(1);
    expect(inkOf(1)).toBe(0);
    expect(inkOf(2)).toBe(0);
    expect(inkOf(3)).toBe(0);
  });

  it('原图色模式每格带颜色', () => {
    const src = flatSource(32, 32, 0.2, [0.8, 0.2, 0.1]);
    const g = buildHalftone(src, opts({ mode: 'source', pitchX: 8, pitchY: 8 }));
    const s = g.screens[0];
    expect(s.color).toBeDefined();
    const k = s.size.findIndex((v) => v > 0);
    expect([...s.color!.subarray(k * 3, k * 3 + 3)]).toEqual([204, 51, 26]);
  });
});

describe('网点渲染', () => {
  it('全黑画面：格子中心是网点色，四角是底色；全白且无最小网点时整张是底色', () => {
    const black = renderHalftone(buildHalftone(flatSource(24, 24, 0), opts({ pitchX: 12, pitchY: 12, minSize: 0, size: 0.8, dot: [200, 0, 0], paper: [250, 250, 250] })));
    // 画布中心 (12, 12) 是一颗网点的中心，(6, 6) 是四颗点之间的空档
    expect(px(black, 12, 12)).toEqual([200, 0, 0]);
    expect(px(black, 6, 6)).toEqual([250, 250, 250]);
    const white = renderHalftone(buildHalftone(flatSource(24, 24, 1), opts({ pitchX: 12, pitchY: 12, minSize: 0, dot: [200, 0, 0], paper: [250, 250, 250] })));
    for (let i = 0; i < white.data.length; i += 4) expect(white.data[i]).toBe(250);
  });

  it('最小网点让全白画面也留一颗小点', () => {
    const out = renderHalftone(buildHalftone(flatSource(24, 24, 1), opts({ pitchX: 12, pitchY: 12, minSize: 0.3, dot: [0, 0, 0], paper: [255, 255, 255] })));
    expect(px(out, 12, 12)).toEqual([0, 0, 0]);
    expect(px(out, 6, 6)).toEqual([255, 255, 255]);
  });

  it('抗锯齿开着有中间色，关掉只剩两种颜色', () => {
    const colors = (aa: boolean) => {
      const out = renderHalftone(buildHalftone(flatSource(24, 24, 0.5), opts({ pitchX: 12, pitchY: 12, antialias: aa, dot: [0, 0, 0], paper: [255, 255, 255] })));
      const set = new Set<number>();
      for (let i = 0; i < out.data.length; i += 4) set.add(out.data[i]);
      return set;
    };
    expect(colors(false).size).toBe(2);
    expect(colors(true).size).toBeGreaterThan(2);
  });

  it('点融合把相邻两个点之间接上，远处不受影响', () => {
    const between = (merge: number) => renderHalftone(buildHalftone(flatSource(48, 12, 0.1), opts({ pitchX: 12, pitchY: 12, size: 0.75, minSize: 0, merge, antialias: false, dot: [0, 0, 0], paper: [255, 255, 255] })));
    // 画布中心 (24, 6) 是一颗点，左边一颗在 (12, 6)；两颗之间的 (18, 6) 只有融合后才是墨色
    expect(px(between(0), 18, 6)).toEqual([255, 255, 255]);
    expect(px(between(0.9), 18, 6)).toEqual([0, 0, 0]);
    expect(px(between(0.9), 18, 0)).toEqual([255, 255, 255]);
  });

  it('线条：整行连成线，粗细随明暗', () => {
    const out = renderHalftone(buildHalftone(flatSource(36, 12, 0.3), opts({ shape: 'line', pitchX: 12, pitchY: 12, minSize: 0, antialias: false, dot: [0, 0, 0], paper: [255, 255, 255] })));
    for (let x = 0; x < 36; x++) expect(px(out, x, 6)).toEqual([0, 0, 0]);
    expect(px(out, 6, 0)).toEqual([255, 255, 255]);
  });

  it('CMYK：纯青画面的网点是青色墨，纸色留白', () => {
    const out = renderHalftone(buildHalftone(flatSource(48, 48, 0.5, [0, 1, 1]), opts({ mode: 'cmyk', pitchX: 12, pitchY: 12, minSize: 0, antialias: false, paper: [255, 255, 255] })));
    const seen = new Set<string>();
    for (let i = 0; i < out.data.length; i += 4) seen.add(`${out.data[i]},${out.data[i + 1]},${out.data[i + 2]}`);
    expect(seen.has('0,174,239')).toBe(true);
    expect(seen.has('255,255,255')).toBe(true);
    expect(seen.size).toBe(2);
  });

  it('原图色：网点用格子自己的颜色', () => {
    const out = renderHalftone(buildHalftone(flatSource(24, 24, 0.2, [0.8, 0.2, 0.1]), opts({ mode: 'source', pitchX: 12, pitchY: 12, antialias: false, paper: [255, 255, 255] })));
    expect(px(out, 12, 12)).toEqual([204, 51, 26]);
  });
});

describe('平滑线条', () => {
  /** 从左（黑）到右（白）的横向渐变 */
  function gradientSource(width: number, height: number): HalftoneSource {
    const gray = new Float32Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) gray[y * width + x] = x / (width - 1);
    return { width, height, sample: 1, grayWidth: width, grayHeight: height, gray, linear: false };
  }
  /** 每一列的墨量（按像素覆盖率累加，抗锯齿的半透明像素按比例算） */
  function inkPerColumn(f: { width: number; height: number; data: Uint8ClampedArray }): number[] {
    const ink: number[] = [];
    for (let x = 0; x < f.width; x++) {
      let sum = 0;
      for (let y = 0; y < f.height; y++) sum += (255 - f.data[(y * f.width + x) * 4]) / 255;
      ink.push(sum);
    }
    return ink;
  }
  const maxStep = (v: number[]) => Math.max(...v.slice(1).map((n, k) => Math.abs(n - v[k])));

  it('结点斜率：单调处取两侧割线的调和平均，极值处放平；Hermite 曲线过两端、切线对得上', () => {
    expect(monotoneSlope(0, 1, 2)).toBeCloseTo(1);
    expect(monotoneSlope(0, 1, 3)).toBeCloseTo(4 / 3);
    expect(monotoneSlope(0, 1, 1)).toBe(0);
    expect(monotoneSlope(1, 0, 1)).toBe(0);
    expect(hermite(0, 0.2, 0.5, 0.8, -0.1)).toBeCloseTo(0.2);
    expect(hermite(1, 0.2, 0.5, 0.8, -0.1)).toBeCloseTo(0.8);
    expect(hermiteSlope(0, 0.2, 0.5, 0.8, -0.1)).toBeCloseTo(0.5);
    expect(hermiteSlope(1, 0.2, 0.5, 0.8, -0.1)).toBeCloseTo(-0.1);
    // 两端放平就是 smoothstep：中点正好一半
    expect(hermite(0.5, 0, 0, 1, 0)).toBeCloseTo(0.5);
  });

  it('剖面：连续变粗的几格是一条直坡，单独一格的尖峰不过冲，行首行尾之外平着延伸', () => {
    const out = { r: 0, dr: 0, y: 0, dy: 0, near: 0 };
    const ramp = { cols: 6, size: new Float32Array([0.2, 0.4, 0.6, 0.8, 0.8, 0.8]) };
    // 结点 1、2 两侧的割线都是 0.2：这一段就是直线
    expect(ribbonProfile(ramp, 0, 1.5, out).r).toBeCloseTo(0.5);
    expect(out.dr).toBeCloseTo(0.2);
    expect(ribbonProfile(ramp, 0, 1.25, out).r).toBeCloseTo(0.45);
    // 结点 3 后面是平台、斜率放平：进入平台前缓一下，略高于弦、不过冲
    const ease = ribbonProfile(ramp, 0, 2.25, out).r;
    expect(ease).toBeGreaterThan(0.65);
    expect(ease).toBeLessThan(0.7);
    let prev = -1;
    for (let x = 0; x <= 5; x += 0.05) {
      const r = ribbonProfile(ramp, 0, x, out).r;
      expect(r).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = r;
    }
    expect(ribbonProfile(ramp, 0, -3, out).r).toBeCloseTo(0.2);
    expect(ribbonProfile(ramp, 0, 9, out).r).toBeCloseTo(0.8);
    expect(ribbonProfile(ramp, 0, 1.4, out).near).toBe(1);
    expect(ribbonProfile(ramp, 0, 1.6, out).near).toBe(2);
    const spike = { cols: 3, size: new Float32Array([0, 1, 0]) };
    for (let x = 0; x <= 2; x += 0.05) {
      const r = ribbonProfile(spike, 0, x, out).r;
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(ribbonProfile(spike, 0, 1, out).r).toBeCloseTo(1);
    // 没采到的格子（负数）当 0；纵向位移同样插值
    const warped = { cols: 3, size: new Float32Array([-1, 0.5, 0.5]), dy: new Float32Array([0, 0, 0.4]) };
    expect(ribbonProfile(warped, 0, 0, out).r).toBe(0);
    expect(ribbonProfile(warped, 0, 1.5, out).y).toBeCloseTo(0.2);
  });

  it('行首行尾画布之外的格子补成边上那格的大小与颜色，纯白的格子不补', () => {
    const screen = { cols: 5, rows: 1, size: new Float32Array([0, 0, 0.4, 0.6, 0]), color: new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 10, 20, 30, 40, 50, 60, 0, 0, 0]) };
    extendRowEnds(screen, new Uint8Array([0, 0, 1, 1, 0]));
    expect([...screen.size]).toEqual([0.4, 0.4, 0.4, 0.6, 0.6].map((v) => Math.fround(v)));
    expect([...screen.color.subarray(0, 3)]).toEqual([10, 20, 30]);
    expect([...screen.color.subarray(12, 15)]).toEqual([40, 50, 60]);
    const white = { cols: 3, rows: 1, size: new Float32Array([0, 0.5, 0]) };
    extendRowEnds(white, new Uint8Array([1, 1, 1]));
    expect([...white.size]).toEqual([0, 0.5, 0]);
  });

  it('渐变画面：线条一格一段在格子边界打台阶，平滑线条的粗细逐列缓缓变化、单调不回头', () => {
    const src = gradientSource(192, 48);
    const render = (shape: HalftoneShape) => inkPerColumn(renderHalftone(buildHalftone(src, opts({ shape, pitchX: 24, pitchY: 48, minSize: 0, mapping: 'linear', dot: [0, 0, 0], paper: [255, 255, 255] }))));
    const stepped = render('line');
    const smooth = render('smoothline');
    expect(maxStep(stepped)).toBeGreaterThan(3);
    expect(maxStep(smooth)).toBeLessThan(1.5);
    for (let x = 1; x < smooth.length; x++) expect(smooth[x], `x=${x}`).toBeLessThanOrEqual(smooth[x - 1] + 0.02);
    expect(smooth[0]).toBeGreaterThan(smooth[191] + 20);
    // 两个格心中间的粗细约等于两边格心的平均：坡是直的
    expect(smooth[84]).toBeCloseTo((smooth[72] + smooth[96]) / 2, 0);
    // 画布边缘的格子外面补成同样的大小：最边上一列的粗细和它所在格心的一样
    expect(smooth[0]).toBeCloseTo(smooth[1], 0);
  });

  it('画面一色时整行粗细相同，到画布边缘也不收尖；纯白处真的没墨，不留发丝线', () => {
    const flat = inkPerColumn(renderHalftone(buildHalftone(flatSource(60, 12, 0.5), opts({ shape: 'smoothline', pitchX: 12, pitchY: 12, minSize: 0, mapping: 'linear', dot: [0, 0, 0], paper: [255, 255, 255] }))));
    for (let x = 0; x < 60; x++) expect(flat[x], `x=${x}`).toBeCloseTo(flat[30], 5);
    expect(flat[30]).toBeCloseTo(6, 0);
    // 左半黑右半白：带子在黑白交界后收尖，再往右一格之外整列都是纸色
    const width = 120;
    const gray = new Float32Array(width * 12);
    for (let y = 0; y < 12; y++) for (let x = 0; x < width; x++) gray[y * width + x] = x < 48 ? 0 : 1;
    const src: HalftoneSource = { width, height: 12, sample: 1, grayWidth: width, grayHeight: 12, gray, linear: false };
    const out = renderHalftone(buildHalftone(src, opts({ shape: 'smoothline', pitchX: 12, pitchY: 12, minSize: 0, dot: [0, 0, 0], paper: [255, 255, 255] })));
    const ink = inkPerColumn(out);
    expect(ink[24]).toBeCloseTo(12, 0);
    for (let x = 72; x < width; x++) expect(ink[x], `x=${x}`).toBe(0);
    for (let x = 48; x < 60; x++) expect(ink[x], `x=${x}`).toBeGreaterThan(ink[x + 1]);
  });

  it('网格扰动的纵向位移把带子整条挪开', () => {
    const g = buildHalftone(flatSource(36, 24, 0.5), opts({ shape: 'smoothline', pitchX: 12, pitchY: 12, minSize: 0, mapping: 'linear', antialias: false, dot: [0, 0, 0], paper: [255, 255, 255] }));
    const s = g.screens[0];
    expect(px(renderHalftone(g), 18, 10)).toEqual([0, 0, 0]);
    expect(px(renderHalftone(g), 18, 17)).toEqual([255, 255, 255]);
    s.dx = new Float32Array(s.size.length);
    s.dy = new Float32Array(s.size.length).fill(0.25);
    s.warpMax = 0.25;
    const moved = renderHalftone(g);
    expect(px(moved, 18, 8)).toEqual([255, 255, 255]);
    expect(px(moved, 18, 17)).toEqual([0, 0, 0]);
  });

  it('SVG：一行一条闭合 path，上下沿各一串贝塞尔；原图色模式逐格切开各填各的颜色', () => {
    const svg = halftoneToSvg(buildHalftone(gradientSource(96, 12), opts({ shape: 'smoothline', pitchX: 12, pitchY: 12, minSize: 0.1 })));
    expect((svg.match(/<path /g) ?? []).length).toBe(1);
    expect(svg).not.toContain('<rect x=');
    expect(svg).toMatch(/<path d="M [^"]* C [^"]* L [^"]* C [^"]* Z"\/>/);
    const colored = halftoneToSvg(buildHalftone(flatSource(48, 12, 0.3, [0.8, 0.2, 0.1]), opts({ shape: 'smoothline', mode: 'source', pitchX: 12, pitchY: 12 })));
    expect((colored.match(/<path [^>]*fill="#CC331A"/g) ?? []).length).toBeGreaterThanOrEqual(4);
    // 一色画面的带子上沿是一条水平线：所有贝塞尔控制点的 y 都等于 -半粗
    const flat = halftoneToSvg(buildHalftone(flatSource(48, 12, 0.5), opts({ shape: 'smoothline', pitchX: 12, pitchY: 12, minSize: 0, mapping: 'linear' })));
    const d = /<path d="([^"]*)"/.exec(flat)![1];
    const ys = d.match(/-?\d+(\.\d+)? (-?\d+(\.\d+)?)/g)!.map((pair) => Number(pair.split(' ')[1]));
    expect(new Set(ys.map((v) => Math.abs(v)))).toEqual(new Set([3]));
  });
});

describe('SVG 导出', () => {
  it('每个网点一个图形，网格旋转交给 <g transform>', () => {
    const g = buildHalftone(flatSource(48, 24, 0.4), opts({ pitchX: 12, pitchY: 12, angle: 30 }));
    const svg = halftoneToSvg(g);
    expect((svg.match(/<circle /g) ?? []).length).toBe(countDots(g));
    expect(svg).toContain('rotate(30)');
    expect(svg).toContain('fill="#11192D"');
    expect(svg).not.toContain('filter');
  });

  it('形状、融合、CMYK 都体现在 SVG 里', () => {
    const tri = halftoneToSvg(buildHalftone(flatSource(24, 24, 0.4), opts({ shape: 'triangle', pitchX: 12, pitchY: 12 })));
    expect(tri).toContain('<polygon ');
    const goo = halftoneToSvg(buildHalftone(flatSource(24, 24, 0.4), opts({ pitchX: 12, pitchY: 12, merge: 0.5 })));
    expect(goo).toContain('<filter id="goo"');
    expect(goo).toContain('filter="url(#goo)"');
    const cmyk = halftoneToSvg(buildHalftone(flatSource(24, 24, 0.4, [0.3, 0.6, 0.2]), opts({ mode: 'cmyk', pitchX: 12, pitchY: 12 })));
    expect((cmyk.match(/mix-blend-mode:multiply/g) ?? []).length).toBe(4);
    const src = halftoneToSvg(buildHalftone(flatSource(24, 24, 0.4, [0.3, 0.6, 0.2]), opts({ mode: 'source', pitchX: 12, pitchY: 12 })));
    expect(src).toMatch(/<circle [^>]*fill="#4D9933"/);
  });

  it('网点太多就拒绝', () => {
    const g: HalftoneGeometry = {
      width: 10,
      height: 10,
      shape: 'circle',
      mode: 'mono',
      paper: [255, 255, 255],
      merge: 0,
      antialias: true,
      glyphStroke: 0.12,
      screens: [{ angle: 0, pitchX: 1, pitchY: 1, offsetX: 0, offsetY: 0, lattice: 'square', i0: 0, j0: 0, cols: MAX_SVG_DOTS + 1, rows: 1, size: new Float32Array(MAX_SVG_DOTS + 1).fill(1), ink: [0, 0, 0] }],
    };
    expect(() => halftoneToSvg(g)).toThrow(/网点/);
  });
});

describe('网格扰动', () => {
  it('网格扰动：位移不超过强度，同种子可复现，涟漪 / 波浪 / 流动平滑而随机逐点独立', () => {
    const cells = { cols: 40, rows: 30, i0: -20, j0: -15 };
    const noShift = () => 0;
    expect(buildWarp(cells, noShift, { warp: 'none', warpAmount: 0.5, warpScale: 10, warpSeed: 1 })).toBeUndefined();
    expect(buildWarp(cells, noShift, { warp: 'ripple', warpAmount: 0, warpScale: 10, warpSeed: 1 })).toBeUndefined();
    for (const warp of ['ripple', 'wave', 'noise', 'jitter'] as const) {
      const a = buildWarp(cells, noShift, { warp, warpAmount: 0.5, warpScale: 10, warpSeed: 1 })!;
      const b = buildWarp(cells, noShift, { warp, warpAmount: 0.5, warpScale: 10, warpSeed: 1 })!;
      const c = buildWarp(cells, noShift, { warp, warpAmount: 0.5, warpScale: 10, warpSeed: 2 })!;
      expect(a.max, warp).toBeGreaterThan(0.1);
      expect(a.max, warp).toBeLessThanOrEqual(0.5 + 1e-6);
      for (let k = 0; k < a.dx.length; k++) {
        expect(Math.abs(a.dx[k]), warp).toBeLessThanOrEqual(0.5 + 1e-6);
        expect(Math.abs(a.dy[k]), warp).toBeLessThanOrEqual(0.5 + 1e-6);
      }
      expect([...a.dx]).toEqual([...b.dx]);
      expect([...a.dx]).not.toEqual([...c.dx]);
      // 相邻格子的位移之差：平滑场里远小于强度，随机则常常接近整个范围
      let maxStep = 0;
      for (let k = 1; k < cells.cols; k++) maxStep = Math.max(maxStep, Math.abs(a.dx[k] - a.dx[k - 1]));
      if (warp === 'jitter') expect(maxStep).toBeGreaterThan(0.5);
      else expect(maxStep, warp).toBeLessThan(0.35);
    }
  });

  it('网格扰动：点挪到哪就采哪一块画面，画在哪；SVG 的圆心跟着挪', () => {
    // 左半黑右半白，随机扰动最多挪一格：每颗点的大小由它挪开后所在的位置决定
    const width = 240;
    const height = 48;
    const gray = new Float32Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) gray[y * width + x] = x < width / 2 ? 0 : 1;
    const src: HalftoneSource = { width, height, sample: 1, grayWidth: width, grayHeight: height, gray, linear: false };
    const g = buildHalftone(src, opts({ pitchX: 12, pitchY: 12, minSize: 0, warp: 'jitter', warpAmount: 1, warpSeed: 3 }));
    const s = g.screens[0];
    expect(s.dx).toBeDefined();
    expect(s.warpMax).toBeGreaterThan(0.9);
    const t = gridTransform(width, height, s);
    let checked = 0;
    for (let jj = 0; jj < s.rows; jj++) {
      for (let ii = 0; ii < s.cols; ii++) {
        const k = jj * s.cols + ii;
        const [x, y] = t.toCanvas(s.i0 + ii + 0.5 + s.dx![k], s.j0 + jj + 0.5 + s.dy![k]);
        // 离黑白分界一格以内的格子会采到两边，挪出画布边缘的格子采不到画面，都跳过
        if (Math.abs(x - width / 2) < 12 || x < 12 || x > width - 12 || y < 12 || y > height - 12) continue;
        checked++;
        if (x < width / 2) expect(s.size[k]).toBeCloseTo(1, 5);
        else expect(s.size[k]).toBe(0);
      }
    }
    expect(checked).toBeGreaterThan(20);

    // 手动把画布中心那颗点右挪半格：墨落在挪开后的位置，原位空着；SVG 圆心同样右挪
    const one = buildHalftone(flatSource(24, 24, 0), opts({ pitchX: 12, pitchY: 12, size: 0.5, minSize: 0, antialias: false, dot: [0, 0, 0], paper: [255, 255, 255] }));
    const sc = one.screens[0];
    const [u, v] = gridTransform(24, 24, sc).toGrid(12, 12);
    const center = (Math.floor(v) - sc.j0) * sc.cols + (Math.floor(u) - sc.i0);
    sc.dx = new Float32Array(sc.size.length);
    sc.dy = new Float32Array(sc.size.length);
    sc.dx[center] = 0.5;
    sc.warpMax = 0.5;
    const out = renderHalftone(one);
    expect(px(out, 18, 12)).toEqual([0, 0, 0]);
    expect(px(out, 12, 12)).toEqual([255, 255, 255]);
    expect(halftoneToSvg(one)).toContain('<circle cx="6" cy="0" r="3"/>');
  });

  it('网格扰动：点挪出自己的格子后，渲染会多看几圈邻格把它找回来', () => {
    // 36×12 的画布三个格子，只留最左边那颗点并把它整整右挪一格：没有多看邻格的话中间格子里就找不到它
    const g = buildHalftone(flatSource(36, 12, 0), opts({ pitchX: 12, pitchY: 12, size: 0.5, minSize: 0, antialias: false, dot: [0, 0, 0], paper: [255, 255, 255] }));
    const s = g.screens[0];
    const t = gridTransform(36, 12, s);
    const idxAt = (x: number) => {
      const [u, v] = t.toGrid(x, 6);
      return (Math.floor(v) - s.j0) * s.cols + (Math.floor(u) - s.i0);
    };
    const left = idxAt(6);
    for (let k = 0; k < s.size.length; k++) if (k !== left) s.size[k] = 0;
    s.dx = new Float32Array(s.size.length);
    s.dy = new Float32Array(s.size.length);
    s.dx[left] = 1;
    s.warpMax = 1;
    const out = renderHalftone(g);
    expect(px(out, 18, 6)).toEqual([0, 0, 0]);
    expect(px(out, 6, 6)).toEqual([255, 255, 255]);
    expect(px(out, 30, 6)).toEqual([255, 255, 255]);
  });

  it('流水线：网格扰动能出图，Yellow Pop 预设带涟漪', () => {
    const params = { ...defaultParams(), 'style.type': 'halftone', 'canvas.width': 48, 'canvas.height': 24, 'screen.pitchX': 6, 'screen.pitchY': 6, 'screen.warp': 'ripple', 'screen.warpAmount': 60 };
    const out = renderImage(makeFrame(64, 40, (x) => [Math.round((x / 63) * 255), Math.round((x / 63) * 255), Math.round((x / 63) * 255)]), params);
    expect(out.width).toBe(48);
    const p = new Pipeline();
    p.run(makeFrame(64, 40, () => [128, 128, 128]), 'a', params);
    expect(p.currentHalftone!.screens[0].dx).toBeDefined();
    p.run(makeFrame(64, 40, () => [128, 128, 128]), 'a', { ...params, 'screen.warp': 'none' });
    expect(p.lastStats.recomputed).toEqual(['halftone', 'render']);
    expect(p.currentHalftone!.screens[0].dx).toBeUndefined();
  });
});

describe('流水线 Halftone 分支', () => {
  const source = () => makeFrame(64, 40, (x) => [Math.round((x / 63) * 255), Math.round((x / 63) * 255), Math.round((x / 63) * 255)]);
  const params = (patch: Record<string, unknown> = {}) => ({
    ...defaultParams(),
    'style.type': 'halftone',
    'canvas.width': 48,
    'canvas.height': 24,
    'screen.pitchX': 6,
    'screen.pitchY': 6,
    ...patch,
  });

  it('采样倍率按网格间距取，最小 1', () => {
    expect(halftoneSampleSize(12, 12)).toBe(3);
    expect(halftoneSampleSize(12, 20)).toBe(3);
    expect(halftoneSampleSize(3, 3)).toBe(1);
  });

  it('输出画布尺寸；左（黑）边网点大，右（白）边只剩最小网点', () => {
    const out = renderImage(source(), params({ 'halftone.antialias': false, 'halftone.minSize': 0 }));
    expect(out.width).toBe(48);
    expect(out.height).toBe(24);
    let leftInk = 0;
    let rightInk = 0;
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 48; x++) {
        const dark = px(out, x, y)[0] < 128;
        if (x < 12 && dark) leftInk++;
        if (x >= 36 && dark) rightInk++;
      }
    }
    expect(leftInk).toBeGreaterThan(rightInk * 3);
  });

  it('各阶段按参数缓存：改网点只重算几何与渲染，改影调从影调起重算', () => {
    const p = new Pipeline();
    const src = source();
    p.run(src, 'a', params());
    expect(p.lastStats.recomputed).toEqual(['fit', 'pixelate', 'tone', 'gray', 'halftone', 'render']);
    expect(p.lastStats.gpu).toBe(false);
    p.run(src, 'a', params());
    expect(p.lastStats.recomputed).toEqual([]);
    p.run(src, 'a', params({ 'halftone.size': 80 }));
    expect(p.lastStats.recomputed).toEqual(['halftone', 'render']);
    p.run(src, 'a', params({ 'halftone.size': 80, 'tone.brightness': 20 }));
    expect(p.lastStats.recomputed).toEqual(['tone', 'gray', 'halftone', 'render']);
    // 特效栈在网点之后叠
    p.run(src, 'a', params({ 'halftone.size': 80, 'tone.brightness': 20, 'effects.stack': JSON.stringify([{ type: 'grain', enabled: true, params: { amount: 30, size: 1, color: false, seed: 1 } }]) }));
    expect(p.lastStats.recomputed).toEqual(['effects']);
  });

  it('两种风格各有一套缓存，来回切不互相冲掉；几何只在 Halftone 运行后可取', () => {
    const p = new Pipeline();
    const src = source();
    p.run(src, 'a', params());
    expect(p.currentHalftone).toBeDefined();
    p.run(src, 'a', params({ 'style.type': 'dither', 'pixel.size': 2 }));
    expect(p.currentHalftone).toBeUndefined();
    expect(p.lastStats.recomputed).toContain('dither:ordered/bayer2');
    p.run(src, 'a', params());
    expect(p.lastStats.recomputed).toEqual([]);
    p.run(src, 'a', params({ 'style.type': 'dither', 'pixel.size': 2 }));
    expect(p.lastStats.recomputed).toEqual([]);
  });

  it('强制背景把背景换成均匀的网点', () => {
    // 左半黑主体、右半浅灰背景连着画面边缘
    const src = makeFrame(64, 40, (x) => (x < 32 ? [0, 0, 0] : [200, 200, 200]));
    const plain = new Pipeline();
    plain.run(src, 'a', params({ 'halftone.minSize': 0 }));
    const forced = new Pipeline();
    forced.run(src, 'a', params({ 'halftone.minSize': 0, 'tone.bg.enabled': true, 'tone.bg.density': 60, 'tone.bg.polarity': 'light' }));
    expect(forced.lastStats.recomputed).toContain('background');
    const right = (p: Pipeline) => {
      const s = p.currentHalftone!.screens[0];
      const t = gridTransform(48, 24, s);
      const [u, v] = t.toGrid(42, 12);
      return s.size[(Math.floor(v) - s.j0) * s.cols + (Math.floor(u) - s.i0)];
    };
    expect(right(forced)).toBeGreaterThan(right(plain));
  });

  it('预览降分辨率时网格间距同比缩小', () => {
    const { params: scaled, scale } = scaleParamsForPreview(params({ 'screen.pitchX': 12, 'screen.pitchY': 8, 'pixel.size': 4 }), 0.5);
    expect(scale).toBe(0.5);
    expect(scaled['screen.pitchX']).toBe(6);
    expect(scaled['screen.pitchY']).toBe(4);
  });
});
