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
import { defaultParams, glyphColorId, glyphShapeId, type Params } from '@/params';
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

describe('新增符号：荧光电路与棋盘', () => {
  const NEW: GlyphId[] = ['slashshort', 'xmark', 'rings', 'clover', 'roundbox', 'boxdot', 'hexline', 'flower', 'zigzag', 'stripes', 'checker', 'rook'];
  const c = (id: GlyphId) => glyphCoverage(GLYPH_CODE[id]);

  it('12 种都在符号库里且排在老的 50 个后面，编码不变；墨量关系：不出格的比贯穿的少，描边比实心少', () => {
    for (const id of NEW) {
      expect(GLYPH_CODE[id], id).toBeGreaterThanOrEqual(50);
      expect(GLYPHS.find((g) => g.id === id)?.desc, id).toBeTruthy();
    }
    expect(GLYPH_IDS.length).toBe(62);
    expect(c('slashshort')).toBeLessThan(c('slash'));
    expect(c('xmark')).toBeLessThan(c('x'));
    expect(c('rings')).toBeGreaterThan(c('ring'));
    expect(c('rings')).toBeLessThan(c('dot'));
    expect(c('roundbox')).toBeLessThan(c('square'));
    expect(c('boxdot')).toBeGreaterThan(c('roundbox'));
    expect(c('hexline')).toBeLessThan(c('hex'));
    expect(c('clover')).toBeGreaterThan(c('quad'));
    expect(c('flower')).toBeGreaterThan(c('asterisk'));
    expect(c('stripes')).toBeGreaterThan(c('bar'));
    // 棋盘格：两个象限实心，默认 80% 大小下盖住 0.8² / 2 ≈ 32%
    expect(c('checker')).toBeGreaterThan(0.28);
    expect(c('checker')).toBeLessThan(0.36);
    expect(c('rook')).toBeGreaterThan(c('checker'));
  });

  it('渲染：棋盘格 100% 时与邻格拼成棋盘，折线上下接成锯齿，竖纹整列铺满，城堡平底、顶上开豁口', () => {
    // 12px 格、三格并排（格心在 6 / 18 / 30）：左上与右下象限实心 → 6px 的棋盘格，跨格也对得上
    const checker = renderHalftone(buildGlyphScreen(flatSource(36, 12, 0.5), custom(['checker', 'checker'])));
    expect(px(checker, 3, 3)).toEqual([0, 0, 0]);
    expect(px(checker, 9, 3)).toEqual([255, 255, 255]);
    expect(px(checker, 9, 9)).toEqual([0, 0, 0]);
    expect(px(checker, 3, 9)).toEqual([255, 255, 255]);
    expect(px(checker, 15, 3)).toEqual([0, 0, 0]);
    expect(px(checker, 21, 3)).toEqual([255, 255, 255]);
    expect(px(checker, 27, 3)).toEqual([0, 0, 0]);
    // 折线：三格竖排（格心在 6 / 18 / 30）：< 的尖在左边格线中点 (0, 18)，两头落在右边格线上，上下两格在 (12, 12) 附近接上；格心是空的
    const zigzag = renderHalftone(buildGlyphScreen(flatSource(12, 36, 0.5), custom(['zigzag', 'zigzag'])));
    expect(px(zigzag, 0, 18)).toEqual([0, 0, 0]);
    expect(px(zigzag, 11, 12)).toEqual([0, 0, 0]);
    expect(px(zigzag, 6, 18)).toEqual([255, 255, 255]);
    expect(px(zigzag, 1, 12)).toEqual([255, 255, 255]);
    // 竖纹：中间那道从上到下整列是墨，两道之间是纸
    const stripes = renderHalftone(buildGlyphScreen(flatSource(12, 24, 0.5), custom(['stripes', 'stripes'])));
    for (let y = 0; y < 24; y++) expect(px(stripes, 6, y), `y=${y}`).toEqual([0, 0, 0]);
    expect(px(stripes, 4, 6)).toEqual([255, 255, 255]);
    expect(px(stripes, 8, 6)).toEqual([255, 255, 255]);
    // 城堡：底边与身体实心，顶上中间的豁口是纸、两侧的齿是墨
    const rook = renderHalftone(buildGlyphScreen(flatSource(12, 12, 0.5), custom(['rook', 'rook'])));
    expect(px(rook, 6, 11)).toEqual([0, 0, 0]);
    expect(px(rook, 6, 6)).toEqual([0, 0, 0]);
    expect(px(rook, 6, 1)).toEqual([255, 255, 255]);
    expect(px(rook, 2, 1)).toEqual([0, 0, 0]);
    expect(px(rook, 9, 1)).toEqual([0, 0, 0]);
    // 双圈：中心是纸，外圈与内圈是墨，两圈之间是纸；圆角框中心是纸，框点中心是墨
    const r = 6;
    const hw = 0.72;
    expect(glyphDistance(GLYPH_CODE.rings, 0, 0, r, hw, 6.5, 6.5)).toBeGreaterThan(0);
    expect(glyphDistance(GLYPH_CODE.rings, r - hw, 0, r, hw, 6.5, 6.5)).toBeLessThan(0);
    expect(glyphDistance(GLYPH_CODE.rings, r / 2 - hw, 0, r, hw, 6.5, 6.5)).toBeLessThan(0);
    expect(glyphDistance(GLYPH_CODE.rings, r * 0.75, 0, r, hw, 6.5, 6.5)).toBeGreaterThan(0);
    expect(glyphDistance(GLYPH_CODE.roundbox, 0, 0, r, hw, 6.5, 6.5)).toBeGreaterThan(0);
    expect(glyphDistance(GLYPH_CODE.boxdot, 0, 0, r, hw, 6.5, 6.5)).toBeLessThan(0);
    // 六边框：外缘落在外接圆半径上（平边在上下：顶边在 y = −r·√3/2），中心是纸
    expect(glyphDistance(GLYPH_CODE.hexline, 0, -r * 0.866 + 0.3, r, hw, 6.5, 6.5)).toBeLessThan(0);
    expect(glyphDistance(GLYPH_CODE.hexline, 0, -r * 0.866 - 0.3, r, hw, 6.5, 6.5)).toBeGreaterThan(0);
    expect(glyphDistance(GLYPH_CODE.hexline, 0, 0, r, hw, 6.5, 6.5)).toBeGreaterThan(0);
  });

  it('SVG：圆角框是带 rx 的描边 <rect>，六边框是描边 <polygon>，城堡是 8 个顶点的实心 <polygon>，棋盘是两个 <rect>', () => {
    const roundbox = halftoneToSvg(buildGlyphScreen(flatSource(24, 24, 0.5), custom(['roundbox', 'roundbox'])));
    expect(roundbox).toMatch(/<rect [^>]*rx="[\d.]+" fill="none" stroke=/);
    const hexline = halftoneToSvg(buildGlyphScreen(flatSource(24, 24, 0.5), custom(['hexline', 'hexline'])));
    expect(hexline).toMatch(/<polygon points="[^"]*" fill="none" stroke=/);
    const rook = halftoneToSvg(buildGlyphScreen(flatSource(24, 24, 0.5), custom(['rook', 'rook'])));
    const poly = rook.match(/<polygon points="([^"]*)"\/>/);
    expect(poly).not.toBeNull();
    expect(poly![1].split(' ').length).toBe(8);
    const checker = halftoneToSvg(buildGlyphScreen(flatSource(12, 12, 0.5), custom(['checker', 'checker'])));
    // 铺底一个 + 两个象限
    expect((checker.match(/<rect /g) ?? []).length).toBe(3);
    const zigzag = halftoneToSvg(buildGlyphScreen(flatSource(12, 12, 0.5), custom(['zigzag', 'zigzag'])));
    expect((zigzag.match(/<line /g) ?? []).length).toBe(2);
  });

  it('Lime Circuit / Checkmate 预设：自定义序列用上新符号，深底反相；Checkmate 分级配色薄荷绿与淡紫', () => {
    const circuit = builtinPresetParams(findBuiltinPreset('glyph-circuit')!);
    expect(circuit['style.type']).toBe('glyph');
    expect(circuit['glyph.ramp']).toBe('custom');
    expect(circuit['glyph.levels']).toBe(8);
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((k) => circuit[glyphShapeId(k)])).toEqual(['blank', 'pip', 'slashshort', 'plus', 'xmark', 'rings', 'roundbox', 'clover']);
    expect(circuit['tone.invert']).toBe(true);
    expect(circuit['glyph.colorMode']).toBe('mono');
    expect(circuit['glyph.ink']).toBe('#C8FF1A');
    expect(circuit['glyph.paper']).toBe('#0A0A0A');
    expect(Number(circuit['glyph.taper'])).toBeGreaterThan(0);
    const checkmate = builtinPresetParams(findBuiltinPreset('glyph-checkmate')!);
    expect(checkmate['glyph.ramp']).toBe('custom');
    expect(checkmate['glyph.levels']).toBe(7);
    expect([1, 2, 3, 4, 5, 6, 7].map((k) => checkmate[glyphShapeId(k)])).toEqual(['blank', 'pip', 'flower', 'zigzag', 'stripes', 'checker', 'rook']);
    expect(checkmate['glyph.colorMode']).toBe('levels');
    expect(checkmate['glyph.color2']).toBe('#9C9FE9');
    expect(checkmate['glyph.color7']).toBe('#5EE6A2');
    expect(checkmate['glyph.paper']).toBe('#0F5C3F');
    // 棋盘格与竖纹要在邻格之间接上，符号大小是 100%
    expect(checkmate['glyph.size']).toBe(100);
    expect(checkmate['tone.invert']).toBe(true);
    for (const p of [circuit, checkmate]) {
      const out = renderImage(makeFrame(64, 40, (x) => [Math.round((x / 63) * 255), Math.round((x / 63) * 255), Math.round((x / 63) * 255)]), { ...p, 'canvas.width': 72, 'canvas.height': 36 });
      expect(out.width).toBe(72);
      // 深底：左（黑）边基本是纸色，右（白）边有符号
      let leftInk = 0;
      let rightInk = 0;
      const paper = px(out, 0, 0);
      for (let y = 0; y < 36; y++) {
        for (let x = 0; x < 72; x++) {
          const same = px(out, x, y).every((v, i) => Math.abs(v - paper[i]) < 8);
          if (x < 18 && !same) leftInk++;
          if (x >= 54 && !same) rightInk++;
        }
      }
      expect(rightInk).toBeGreaterThan(leftInk);
    }
  });

  it('PETSCII Glitch 预设：8 阶自定义序列从小点、字母到棋盘格与密网，青绿两色逐阶交替，黑底反相，亮部同时出现两种颜色', () => {
    const p = builtinPresetParams(findBuiltinPreset('glyph-petscii')!);
    expect(p['style.type']).toBe('glyph');
    expect(p['glyph.ramp']).toBe('custom');
    expect(p['glyph.levels']).toBe(8);
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((k) => p[glyphShapeId(k)])).toEqual(['blank', 'pip', 'colon', 'tee', 'aitch', 'em', 'checker', 'hashx']);
    expect(p['glyph.colorMode']).toBe('levels');
    // 从第 4 阶起青、绿逐阶交替
    expect([4, 5, 6, 7, 8].map((k) => p[glyphColorId(k)])).toEqual(['#4DEBFF', '#C6FF4A', '#4DEBFF', '#C6FF4A', '#4DEBFF']);
    expect(p['glyph.paper']).toBe('#070A0C');
    // 棋盘格与密网要在邻格之间接上
    expect(p['glyph.size']).toBe(100);
    expect(p['glyph.taper']).toBe(0);
    expect(Number(p['glyph.mix'])).toBeGreaterThanOrEqual(60);
    expect(p['tone.invert']).toBe(true);

    // 源图与画布同尺寸，免得适配裁掉渐变的两端
    const out = renderImage(makeFrame(176, 66, (x) => [Math.round((x / 175) * 255), Math.round((x / 175) * 255), Math.round((x / 175) * 255)]), { ...p, 'canvas.width': 176, 'canvas.height': 66 });
    expect(out.width).toBe(176);
    const paper = px(out, 0, 0);
    let leftInk = 0;
    let rightInk = 0;
    let cyan = 0;
    let lime = 0;
    for (let y = 0; y < 66; y++) {
      for (let x = 0; x < 176; x++) {
        const [r, g, b] = px(out, x, y);
        const same = Math.abs(r - paper[0]) < 8 && Math.abs(g - paper[1]) < 8 && Math.abs(b - paper[2]) < 8;
        if (x < 44 && !same) leftInk++;
        if (x >= 132 && !same) rightInk++;
        if (x >= 88) {
          if (b > 150 && r < 120) cyan++;
          if (g > 150 && b < 120) lime++;
        }
      }
    }
    // 深底：左（黑）边只有零星小点，右（白）边墨多得多，而且两种颜色都在
    expect(rightInk).toBeGreaterThan(leftInk * 3);
    expect(cyan).toBeGreaterThan(50);
    expect(lime).toBeGreaterThan(50);
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
