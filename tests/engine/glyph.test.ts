import { describe, expect, it } from 'vitest';
import {
  ACCENT_MIN_SIZE,
  DEFAULT_GLYPH,
  GLYPHS,
  GLYPH_CODE,
  GLYPH_IDS,
  GLYPH_MAX_LEVELS,
  GLYPH_RAMPS,
  GLYPH_RAMP_KINDS,
  Pipeline,
  buildGlyphScreen,
  glyphBand,
  glyphCoverage,
  glyphDistance,
  glyphsByCoverage,
  gridTransform,
  halftoneToSvg,
  levelGray,
  levelSizes,
  rampFor,
  rampIsMonotonic,
  renderHalftone,
  renderImage,
  resolveGlyphRamp,
  resolveLevelColors,
  scaleParamsForPreview,
  sortByCoverage,
  type GlyphId,
  type GlyphRampKind,
  type GlyphSettings,
  type HalftoneGeometry,
  type HalftoneSource,
} from '@/engine';
import { defaultParams, glyphShapeId, type Params } from '@/params';
import { builtinPresetParams, findBuiltinPreset } from '@/state';
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

/** 从左（黑）到右（白）的渐变 */
function gradient(width: number, height: number): HalftoneSource {
  const gray = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) gray[y * width + x] = x / (width - 1);
  return { width, height, sample: 1, grayWidth: width, grayHeight: height, gray, linear: false };
}

/** 画布中线那一行格子，按列从左到右的（符号编码, 下标） */
function middleRow(g: HalftoneGeometry): Array<{ code: number; idx: number }> {
  const s = g.screens[0];
  const [, v] = gridTransform(g.width, g.height, s).toGrid(g.width / 2, g.height / 2);
  const row = Math.floor(v) - s.j0;
  const out: Array<{ code: number; idx: number }> = [];
  for (let c = 0; c < s.cols; c++) {
    const idx = row * s.cols + c;
    if (s.size[idx] > 0) out.push({ code: s.glyph![idx], idx });
  }
  return out;
}

/** 测试用的基线设置：12px 方格、不混合、不点缀、不抗锯齿、黑符号白纸，自定义序列由 shapes 给 */
const glyph = (patch: Partial<GlyphSettings> = {}): GlyphSettings => ({
  ...DEFAULT_GLYPH,
  pitchX: 12,
  pitchY: 12,
  size: 1,
  mix: 0,
  accent: 0,
  antialias: false,
  ink: [0, 0, 0],
  paper: [255, 255, 255],
  ...patch,
});
const custom = (shapes: GlyphId[], patch: Partial<GlyphSettings> = {}) => glyph({ ramp: 'custom', levels: shapes.length, shapes, ...patch });

const RAMP_KINDS = GLYPH_RAMP_KINDS.map((k) => k.id).filter((k): k is Exclude<GlyphRampKind, 'custom'> => k !== 'custom');

describe('符号库', () => {
  it('每种符号：格子里有墨，远处没有；「空」哪里都没有；老的 16 个编码不变', () => {
    const r = 5;
    const hw = 0.7;
    for (const id of GLYPH_IDS) {
      const code = GLYPH_CODE[id];
      expect(glyphDistance(code, 40, 40, r, hw, 6.5, 6.5), id).toBeGreaterThan(0);
      let inside = 0;
      for (let y = -6; y <= 6; y += 0.5) for (let x = -6; x <= 6; x += 0.5) if (glyphDistance(code, x, y, r, hw, 6.5, 6.5) < 0) inside++;
      if (id === 'blank') expect(inside).toBe(0);
      else expect(inside, id).toBeGreaterThan(0);
    }
    expect(GLYPH_IDS.slice(0, 16)).toEqual(['blank', 'dot', 'ring', 'dash', 'bar', 'slash', 'backslash', 'x', 'plus', 'hash', 'tri', 'triline', 'four', 'six', 'percent', 'dotslash']);
    expect(GLYPH_IDS.length).toBeGreaterThanOrEqual(48);
    expect(new Set(GLYPH_IDS).size).toBe(GLYPH_IDS.length);
    for (const g of GLYPHS) expect(g.label && g.desc && g.group, g.id).toBeTruthy();
    // 实心点是精确的圆；斜线过格心；圆圈的中心是空的
    expect(glyphDistance(GLYPH_CODE.dot, 3, 4, 5, hw, 6.5, 6.5)).toBeCloseTo(0, 6);
    expect(glyphDistance(GLYPH_CODE.slash, 0, 0, r, hw, 6.5, 6.5)).toBeLessThan(0);
    expect(glyphDistance(GLYPH_CODE.slash, 3, 3, r, hw, 6.5, 6.5)).toBeGreaterThan(0);
    expect(glyphDistance(GLYPH_CODE.ring, 0, 0, r, hw, 6.5, 6.5)).toBeGreaterThan(0);
    expect(glyphDistance(GLYPH_CODE.ring, r - hw, 0, r, hw, 6.5, 6.5)).toBeLessThan(0);
  });

  it('墨量：空最少，密网 / 点线最多，描边版总比实心版少，小点比圆点少', () => {
    const c = (id: GlyphId) => glyphCoverage(GLYPH_CODE[id]);
    expect(c('blank')).toBe(0);
    for (const id of GLYPH_IDS) {
      expect(c(id)).toBeGreaterThanOrEqual(0);
      expect(c(id)).toBeLessThanOrEqual(1);
    }
    expect(c('pip')).toBeLessThan(c('dot'));
    expect(c('ring')).toBeLessThan(c('dot'));
    expect(c('triline')).toBeLessThan(c('tri'));
    expect(c('squareline')).toBeLessThan(c('square'));
    expect(c('diamondline')).toBeLessThan(c('diamond'));
    expect(c('slash')).toBeLessThan(c('x'));
    expect(c('hash')).toBeLessThan(c('hashx'));
    const sorted = glyphsByCoverage();
    expect(sorted[0]).toBe('blank');
    expect(sorted.length).toBe(GLYPH_IDS.length);
    for (let k = 1; k < sorted.length; k++) expect(c(sorted[k])).toBeGreaterThanOrEqual(c(sorted[k - 1]));
    expect(sortByCoverage(['dot', 'blank', 'pip'])).toEqual(['blank', 'pip', 'dot']);
  });
});

describe('推荐序列', () => {
  it('每套 8 个不重复的符号；任意阶数抽出来的都按墨量从少到多，两端总是最亮与最暗的那两个', () => {
    for (const kind of RAMP_KINDS) {
      const full = GLYPH_RAMPS[kind];
      expect(full.length, kind).toBe(GLYPH_MAX_LEVELS);
      expect(new Set(full).size, kind).toBe(GLYPH_MAX_LEVELS);
      const sorted = sortByCoverage(full);
      for (let n = 2; n <= GLYPH_MAX_LEVELS; n++) {
        const ramp = rampFor(kind, n);
        expect(ramp.length, `${kind}/${n}`).toBe(n);
        expect(rampIsMonotonic(ramp), `${kind}/${n}`).toBe(true);
        expect(ramp[0], `${kind}/${n}`).toBe(sorted[0]);
        expect(ramp[n - 1], `${kind}/${n}`).toBe(sorted[GLYPH_MAX_LEVELS - 1]);
        expect(new Set(ramp).size, `${kind}/${n}`).toBe(n);
      }
      expect(rampFor(kind, 8)).toEqual(sorted);
    }
    // 阶数夹在 2..8
    expect(rampFor('sketch', 1).length).toBe(2);
    expect(rampFor('sketch', 99).length).toBe(8);
    // 草图 5 阶：短竖 → 斜线 → 十字 → 网格 → 密网；打字机与字符从留白起
    expect(rampFor('sketch', 5)).toEqual(['tick', 'slash', 'plus', 'hash', 'hashx']);
    expect(rampFor('typewriter', 7)[0]).toBe('blank');
    expect(rampFor('typewriter', 7)[6]).toBe('dot');
    expect(rampFor('ascii', 8)[0]).toBe('blank');
  });

  it('自定义序列取存下来的那几个，不够就用最后一个补；推荐序列忽略存下来的形状', () => {
    expect(resolveGlyphRamp({ ramp: 'custom', levels: 3, shapes: ['dot', 'slash', 'plus', 'hash'] })).toEqual(['dot', 'slash', 'plus']);
    expect(resolveGlyphRamp({ ramp: 'custom', levels: 4, shapes: ['dot', 'slash'] })).toEqual(['dot', 'slash', 'slash', 'slash']);
    expect(resolveGlyphRamp({ ramp: 'mesh', levels: 4, shapes: ['dot'] })).toEqual(rampFor('mesh', 4));
  });

  it('每一阶的大小与代表亮度：亮部缩小让最亮一阶缩到 size × (1 − taper)，暗部是 size', () => {
    expect(levelSizes(0.8, 0, 5)).toEqual([0.8, 0.8, 0.8, 0.8, 0.8]);
    const s = levelSizes(0.88, 0.68, 5);
    expect(s[0]).toBeCloseTo(0.88 * 0.32, 6);
    expect(s[4]).toBeCloseTo(0.88, 6);
    for (let k = 1; k < s.length; k++) expect(s[k]).toBeGreaterThan(s[k - 1]);
    expect(levelSizes(1, 1, 2)).toEqual([0, 1]);
    expect(levelGray(0, 4)).toBeCloseTo(0.875, 6);
    expect(levelGray(3, 4)).toBeCloseTo(0.125, 6);
  });

  it('每一阶的颜色：统一色铺满、分级配色各取各的、原图色没有', () => {
    const colors: [number, number, number][] = [
      [1, 1, 1],
      [2, 2, 2],
      [3, 3, 3],
    ];
    expect(resolveLevelColors({ colorMode: 'mono', levels: 3, ink: [9, 9, 9], colors })).toEqual([
      [9, 9, 9],
      [9, 9, 9],
      [9, 9, 9],
    ]);
    expect(resolveLevelColors({ colorMode: 'levels', levels: 2, ink: [9, 9, 9], colors })).toEqual([
      [1, 1, 1],
      [2, 2, 2],
    ]);
    expect(resolveLevelColors({ colorMode: 'levels', levels: 4, ink: [9, 9, 9], colors })![3]).toEqual([3, 3, 3]);
    expect(resolveLevelColors({ colorMode: 'source', levels: 3, ink: [9, 9, 9], colors })).toBeNull();
  });

  it('明暗分档均分，两端夹住；交界抖动最多挪半档', () => {
    expect(glyphBand(0, 5, 0, 0.5)).toBe(0);
    expect(glyphBand(0.5, 5, 0, 0.5)).toBe(2);
    expect(glyphBand(1, 5, 0, 0.5)).toBe(4);
    expect(glyphBand(1.2, 5, 0, 0.5)).toBe(4);
    // 0.39 离 0.4 的界很近：噪声偏亮就跨到下一档，偏暗就留在原档；档中间的 0.5 怎么抖都不动
    expect(glyphBand(0.39, 5, 1, 1)).toBe(2);
    expect(glyphBand(0.39, 5, 1, 0)).toBe(1);
    expect(glyphBand(0.5, 5, 1, 0.9)).toBe(2);
    expect(glyphBand(0.5, 5, 1, 0.1)).toBe(2);
  });
});

describe('符号网格几何', () => {
  it('渐变上从暗到亮依次用完每一阶的符号，大小按阶递减；白纸上留白的阶不算要画的', () => {
    const g = buildGlyphScreen(gradient(120, 24), glyph({ ramp: 'sketch', levels: 5, taper: 0.5 }));
    expect(g.shape).toBe('glyph');
    expect(g.glyphStroke).toBeCloseTo(DEFAULT_GLYPH.stroke, 6);
    const row = middleRow(g);
    const codes = rampFor('sketch', 5).map((id) => GLYPH_CODE[id]);
    expect(row[0].code).toBe(codes[4]);
    expect(row[row.length - 1].code).toBe(codes[0]);
    // 只出现序列里的符号，顺序单调；同一阶大小一样，暗的阶大
    const s = g.screens[0];
    for (let k = 1; k < row.length; k++) {
      expect(codes.indexOf(row[k].code)).toBeLessThanOrEqual(codes.indexOf(row[k - 1].code));
      expect(s.size[row[k].idx]).toBeLessThanOrEqual(s.size[row[k - 1].idx] + 1e-6);
    }
    expect(new Set(row.map((r) => r.code)).size).toBe(5);
    const sizes = new Set([...s.size].filter((v) => v > 0).map((v) => Math.round(v * 1000)));
    expect(sizes.size).toBe(5);
    expect(Math.max(...sizes) / 1000).toBeCloseTo(1, 3);
    expect(Math.min(...sizes) / 1000).toBeCloseTo(0.5, 3);

    const tw = buildGlyphScreen(flatSource(24, 24, 1), glyph({ ramp: 'typewriter', levels: 7 }));
    expect(tw.screens[0].glyph!.every((c) => c === 0)).toBe(true);
  });

  it('分级配色：每格带上这一阶的颜色；统一色不带；原图色取画面', () => {
    const colors: [number, number, number][] = [
      [10, 20, 30],
      [40, 50, 60],
      [70, 80, 90],
    ];
    const levels = buildGlyphScreen(gradient(120, 24), custom(['pip', 'dot', 'square'], { colorMode: 'levels', colors }));
    const s = levels.screens[0];
    expect(s.color).toBeDefined();
    for (const { code, idx } of middleRow(levels)) {
      const band = ['pip', 'dot', 'square'].indexOf(GLYPH_IDS[code]);
      expect([s.color![idx * 3], s.color![idx * 3 + 1], s.color![idx * 3 + 2]]).toEqual(colors[band]);
    }
    expect(levels.mode).toBe('mono');
    const mono = buildGlyphScreen(gradient(120, 24), custom(['pip', 'dot', 'square']));
    expect(mono.screens[0].color).toBeUndefined();
    expect(mono.screens[0].ink).toEqual([0, 0, 0]);
    const source = buildGlyphScreen(flatSource(24, 24, 0.5, [0.2, 0.4, 0.6]), custom(['dot', 'dot'], { colorMode: 'source' }));
    expect(source.mode).toBe('source');
    const c = source.screens[0].color!;
    const k = middleRow(source)[0].idx;
    expect([c[k * 3], c[k * 3 + 1], c[k * 3 + 2]]).toEqual([51, 102, 153]);
  });

  it('交界混合只搅动两阶交界附近的格子；点缀按密度撒圆圈 / 三角框并把格子撑大', () => {
    const src = gradient(240, 24);
    const shapes: GlyphId[] = ['tick', 'slash', 'plus', 'hash', 'hashx'];
    const clean = middleRow(buildGlyphScreen(src, custom(shapes)));
    const mixed = middleRow(buildGlyphScreen(src, custom(shapes, { mix: 1 })));
    expect(mixed.length).toBe(clean.length);
    let changed = 0;
    const codes = shapes.map((id) => GLYPH_CODE[id]);
    for (let k = 0; k < clean.length; k++) {
      if (mixed[k].code === clean[k].code) continue;
      changed++;
      // 换的只会是相邻那一阶
      expect(Math.abs(codes.indexOf(mixed[k].code) - codes.indexOf(clean[k].code))).toBe(1);
    }
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThan(clean.length / 2);

    const none = buildGlyphScreen(flatSource(96, 96, 0.9), custom(['pip', 'dot'], { accent: 0, size: 0.8, taper: 0.75 }));
    const some = buildGlyphScreen(flatSource(96, 96, 0.9), custom(['pip', 'dot'], { accent: 1, size: 0.8, taper: 0.75 }));
    const accents = new Set([GLYPH_CODE.ring, GLYPH_CODE.triline]);
    expect([...none.screens[0].glyph!].some((c) => accents.has(c))).toBe(false);
    const s = some.screens[0];
    let n = 0;
    for (let k = 0; k < s.glyph!.length; k++) {
      if (!accents.has(s.glyph![k])) continue;
      n++;
      expect(s.size[k]).toBeGreaterThanOrEqual(0.8 * ACCENT_MIN_SIZE - 1e-6);
    }
    expect(n).toBeGreaterThan(0);
    // 换个种子落点不同
    const other = buildGlyphScreen(flatSource(96, 96, 0.9), custom(['pip', 'dot'], { accent: 1, size: 0.8, taper: 0.75, seed: 7 }));
    expect([...other.screens[0].glyph!]).not.toEqual([...s.glyph!]);
  });

  it('网格扰动、交错排列与角度都沿用网点那一套', () => {
    const g = buildGlyphScreen(flatSource(96, 48, 0.5), custom(['dot', 'dot'], { warp: 'jitter', warpAmount: 0.5, lattice: 'hex', angle: 30 }));
    const s = g.screens[0];
    expect(s.dx).toBeDefined();
    expect(s.warpMax).toBeGreaterThan(0.3);
    expect(s.lattice).toBe('hex');
    expect(s.angle).toBe(30);
  });
});

describe('符号渲染与 SVG', () => {
  it('渲染：斜线过格心且相邻格子连成一条，网格铺满整行整列，线粗按格子比例', () => {
    const slash = renderHalftone(buildGlyphScreen(flatSource(36, 12, 0.5), custom(['slash', 'slash'])));
    // 画布中心 (18, 6) 是一格中心，斜线从左下到右上
    expect(px(slash, 18, 6)).toEqual([0, 0, 0]);
    expect(px(slash, 21, 3)).toEqual([0, 0, 0]);
    expect(px(slash, 21, 9)).toEqual([255, 255, 255]);
    // 跨到邻格：格角 (24, 0) 附近两格的斜线接上
    expect(px(slash, 23, 0)).toEqual([0, 0, 0]);
    const hash = renderHalftone(buildGlyphScreen(flatSource(36, 24, 0.5), custom(['hash', 'hash'])));
    for (let x = 0; x < 36; x++) expect(px(hash, x, 12), `x=${x}`).toEqual([0, 0, 0]);
    for (let y = 0; y < 24; y++) expect(px(hash, 18, y), `y=${y}`).toEqual([0, 0, 0]);
    expect(px(hash, 15, 9)).toEqual([255, 255, 255]);
    // 线粗 40% 的横线上下各 2.4px 都是墨，12% 的只有 0.72px：离格心 1.5px 的像素一个有墨一个没有
    const thick = renderHalftone(buildGlyphScreen(flatSource(24, 24, 0.5), custom(['dash', 'dash'], { stroke: 0.4 })));
    const thin = renderHalftone(buildGlyphScreen(flatSource(24, 24, 0.5), custom(['dash', 'dash'], { stroke: 0.12 })));
    expect(px(thick, 12, 13)).toEqual([0, 0, 0]);
    expect(px(thin, 12, 13)).toEqual([255, 255, 255]);
    expect(px(thin, 12, 12)).toEqual([0, 0, 0]);
    // 分级配色：格子里的墨是这一阶的颜色
    const colored = renderHalftone(buildGlyphScreen(flatSource(24, 24, 0.1), custom(['pip', 'square'], { colorMode: 'levels', colors: [[1, 2, 3], [200, 100, 50]] })));
    expect(px(colored, 12, 12)).toEqual([200, 100, 50]);
  });

  it('SVG：线段与圆圈带描边，线粗写在 <g> 上，「空」不出图形，分级配色 / 原图色每笔各自带色', () => {
    const g = buildGlyphScreen(gradient(120, 24), glyph({ ramp: 'sketch', levels: 5 }));
    const svg = halftoneToSvg(g);
    // 线粗 12% × 12px 格 = 1.44px，写在 <g> 上
    expect(svg).toMatch(/<g [^>]*stroke-width="1\.44" stroke-linecap="round"/);
    expect(svg).toContain('<line ');
    expect(svg).toMatch(/<line [^>]*stroke="#000000"/);
    const blank = halftoneToSvg(buildGlyphScreen(flatSource(24, 24, 1), glyph({ ramp: 'typewriter', levels: 7 })));
    // 只有铺底的那一个 <rect>，没有任何符号图元
    expect(blank).not.toMatch(/<(circle|line|polygon) /);
    expect((blank.match(/<rect /g) ?? []).length).toBe(1);
    // 亮（墨量 0.1）落在第一阶：圆圈；暗（墨量 0.9）落在最后一阶：三角框
    const ring = halftoneToSvg(buildGlyphScreen(flatSource(24, 24, 0.9), custom(['ring', 'tri', 'triline'])));
    expect(ring).toMatch(/<circle [^>]*fill="none" stroke="#000000"/);
    const tri = halftoneToSvg(buildGlyphScreen(flatSource(24, 24, 0.1), custom(['tri', 'triline'])));
    expect(tri).toMatch(/<polygon [^>]*fill="none" stroke=/);
    const filled = halftoneToSvg(buildGlyphScreen(flatSource(24, 24, 0.9), custom(['tri', 'triline'])));
    expect(filled).toMatch(/<polygon points="[^"]*"\/>/);
    // 方框 / 实心方 / 菱 / 六边形都出对应图元
    const geo = halftoneToSvg(buildGlyphScreen(flatSource(24, 24, 0.5), custom(['squareline', 'squareline'])));
    expect(geo).toMatch(/<rect [^>]*fill="none" stroke=/);
    const hex = halftoneToSvg(buildGlyphScreen(flatSource(24, 24, 0.5), custom(['hex', 'hex'])));
    expect(hex).toMatch(/<polygon points="[^"]*"\/>/);
    const colored = halftoneToSvg(buildGlyphScreen(flatSource(24, 24, 0.5, [0.3, 0.6, 0.2]), custom(['plus', 'plus'], { colorMode: 'source' })));
    expect(colored).toMatch(/<line [^>]*stroke="#4D9933"/);
    const leveled = halftoneToSvg(buildGlyphScreen(flatSource(24, 24, 0.5), custom(['plus', 'plus'], { colorMode: 'levels', colors: [[255, 0, 0], [0, 0, 255]] })));
    expect(leveled).toMatch(/<line [^>]*stroke="#0000FF"/);
  });
});

describe('流水线 符号 分支', () => {
  const source = () => makeFrame(64, 40, (x) => [Math.round((x / 63) * 255), Math.round((x / 63) * 255), Math.round((x / 63) * 255)]);
  const params = (patch: Partial<Params> = {}): Params => ({ ...defaultParams(), 'style.type': 'glyph', 'canvas.width': 48, 'canvas.height': 24, 'tile.pitchX': 6, 'tile.pitchY': 6, ...patch });

  it('能出图：画布尺寸、左（黑）边密符号、右（白）边稀符号', () => {
    const out = renderImage(source(), params());
    expect(out.width).toBe(48);
    expect(out.height).toBe(24);
    let leftInk = 0;
    let rightInk = 0;
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 48; x++) {
        const dark = out.data[(y * 48 + x) * 4] < 128;
        if (x < 16 && dark) leftInk++;
        if (x >= 32 && dark) rightInk++;
      }
    }
    expect(leftInk).toBeGreaterThan(rightInk);
    expect(leftInk).toBeGreaterThan(0);
  });

  it('各阶段按参数缓存：改符号只重算几何与渲染，改网格同理，改影调从影调起重算', () => {
    const p = new Pipeline();
    const src = source();
    p.run(src, 'a', params());
    expect(p.lastStats.recomputed).toEqual(['fit', 'pixelate', 'tone', 'gray', 'glyph', 'render']);
    p.run(src, 'a', params({ 'glyph.levels': 3 }));
    expect(p.lastStats.recomputed).toEqual(['glyph', 'render']);
    p.run(src, 'a', params({ 'glyph.levels': 3, 'tile.angle': 30 }));
    expect(p.lastStats.recomputed).toEqual(['glyph', 'render']);
    p.run(src, 'a', params({ 'glyph.levels': 3, 'tile.angle': 30, 'tone.brightness': 20 }));
    expect(p.lastStats.recomputed).toEqual(['tone', 'gray', 'glyph', 'render']);
    p.run(src, 'a', params({ 'glyph.levels': 3, 'tile.angle': 30, 'tone.brightness': 20 }));
    expect(p.lastStats.recomputed).toEqual([]);
  });

  it('网点与符号各有一套缓存，来回切不互相冲掉；几何在两种风格下都可取，抖动下为空', () => {
    const p = new Pipeline();
    const src = source();
    p.run(src, 'a', params());
    const glyphGeometry = p.currentHalftone;
    expect(glyphGeometry?.shape).toBe('glyph');
    p.run(src, 'a', params({ 'style.type': 'halftone' }));
    expect(p.currentHalftone?.shape).toBe('circle');
    p.run(src, 'a', params({ 'style.type': 'dither', 'pixel.size': 2 }));
    expect(p.currentHalftone).toBeUndefined();
    p.run(src, 'a', params());
    expect(p.lastStats.recomputed).toEqual([]);
    expect(p.currentHalftone).toBe(glyphGeometry);
    p.run(src, 'a', params({ 'style.type': 'halftone' }));
    expect(p.lastStats.recomputed).toEqual([]);
    // SVG 走同一条路
    expect(halftoneToSvg(glyphGeometry!)).toContain('<line ');
  });

  it('预览降分辨率时符号网格的间距同比缩小', () => {
    const { params: scaled, scale } = scaleParamsForPreview({ ...defaultParams(), 'style.type': 'glyph', 'tile.pitchX': 12, 'tile.pitchY': 12, 'tile.offsetX': 4 }, 0.5);
    expect(scale).toBe(0.5);
    expect(scaled['tile.pitchX']).toBe(6);
    expect(scaled['tile.pitchY']).toBe(6);
    expect(scaled['tile.offsetX']).toBe(2);
    expect(scaled['canvas.width']).toBe(500);
    // 网点那边的间距不动
    expect(scaled['screen.pitchX']).toBe(12);
  });

  it('挪过来的两套预设：Symbol Sketch / Typewriter 存成自定义序列，形状顺序与老的一致', () => {
    const sketch = builtinPresetParams(findBuiltinPreset('glyph-sketch')!);
    expect(sketch['style.type']).toBe('glyph');
    expect(sketch['glyph.ramp']).toBe('custom');
    expect(sketch['glyph.levels']).toBe(5);
    expect([1, 2, 3, 4, 5].map((k) => sketch[glyphShapeId(k)])).toEqual(['dot', 'slash', 'plus', 'hash', 'dotslash']);
    // 最亮一阶 88% × (1 − 68%) ≈ 28%，与老预设的最小网点一致
    expect((Number(sketch['glyph.size']) * (1 - Number(sketch['glyph.taper']) / 100)) / 100).toBeCloseTo(0.28, 2);
    const tw = builtinPresetParams(findBuiltinPreset('glyph-typewriter')!);
    expect(tw['glyph.levels']).toBe(7);
    expect([1, 2, 3, 4, 5, 6, 7].map((k) => tw[glyphShapeId(k)])).toEqual(['blank', 'dash', 'four', 'six', 'percent', 'dot', 'tri']);
    expect(tw['glyph.taper']).toBe(0);
    expect(tw['tile.pitchX']).toBe(11);
    expect(tw['tile.pitchY']).toBe(13);
    // 网点风格里已经没有这两套，也没有「符号」形状
    expect(findBuiltinPreset('ht-symbols')).toBeUndefined();
    expect(findBuiltinPreset('ht-typewriter')).toBeUndefined();
    const out = renderImage(source(), { ...sketch, 'canvas.width': 52, 'canvas.height': 26 });
    expect(out.width).toBe(52);
  });
});
