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
  hexToRgb,
  levelGray,
  levelSizes,
  parseStack,
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
    expect(GLYPH_IDS.length).toBe(107);
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

  it('终端字符：14 个等宽字母与标点接在老符号后面，墨量从逗号一路排到 W', () => {
    const NEW: GlyphId[] = ['ay', 'see', 'dee', 'gee', 'jay', 'kay', 'ar', 'ess', 'you', 'dubya', 'comma', 'semicolon', 'underscore', 'bracket'];
    for (const id of NEW) {
      expect(GLYPH_CODE[id], id).toBeGreaterThanOrEqual(75);
      expect(GLYPHS.find((g) => g.id === id)?.desc, id).toBeTruthy();
      expect(GLYPHS.find((g) => g.id === id)?.group, id).toBe('chars');
    }
    // 墨量：逗号比全库任何字符都轻，分号比它重；字母之间笔画越多越重
    expect(c('comma')).toBeLessThan(c('colon'));
    expect(c('semicolon')).toBeGreaterThan(c('comma'));
    expect(c('see')).toBeLessThan(c('percent'));
    expect(c('kay')).toBeGreaterThan(c('see'));
    expect(c('dubya')).toBeGreaterThan(c('kay'));
    // 下划线贴着底边贯穿，与左右邻格接成一条：总有一整行从左通到右
    const under = renderHalftone(buildGlyphScreen(flatSource(24, 24, 0.5), custom(['underscore', 'underscore'])));
    const rows = Array.from({ length: 24 }, (_, y) => Array.from({ length: 24 }, (_, x) => px(under, x, y)[0]).filter((v) => v === 0).length);
    expect(Math.max(...rows)).toBe(24);
    // 字母出的是线段
    const svg = halftoneToSvg(buildGlyphScreen(flatSource(24, 24, 0.5), custom(['kay', 'kay'])));
    expect((svg.match(/<line /g) ?? []).length).toBeGreaterThan(2);
  });
  it('「终端」序列：留白 → 逗号 → 双点 → C → K → % → Ø → 实心块，墨量一路加多', () => {
    expect(GLYPH_RAMPS.terminal).toEqual(['blank', 'comma', 'colon', 'see', 'kay', 'percent', 'oslash', 'block']);
    expect(rampFor('terminal', GLYPH_MAX_LEVELS)).toEqual([...GLYPH_RAMPS.terminal]);
    expect(rampIsMonotonic(rampFor('terminal', 5))).toBe(true);
  });

  it('PETSCII Glitch 预设：「终端」序列 8 阶，青绿两色逐阶交替，黑底反相；亮部整格填实、暗部只剩零星标点', () => {
    const p = builtinPresetParams(findBuiltinPreset('glyph-petscii')!);
    expect(p['style.type']).toBe('glyph');
    expect(p['glyph.ramp']).toBe('terminal');
    expect(p['glyph.levels']).toBe(8);
    expect(p['glyph.colorMode']).toBe('levels');
    // 从第 3 阶起青、绿逐阶交替，同一片明暗里两色掺在一起
    expect([3, 4, 5, 6, 7, 8].map((k) => p[glyphColorId(k)])).toEqual(['#29C8E0', '#C3E82B', '#29C8E0', '#C3E82B', '#29C8E0', '#C3E82B']);
    expect(p['glyph.paper']).toBe('#05070B');
    // 实心块要在邻格之间接上，所以符号大小 100%、亮部不缩小
    expect(p['glyph.size']).toBe(100);
    expect(p['glyph.taper']).toBe(0);
    expect(Number(p['glyph.mix'])).toBeGreaterThanOrEqual(60);
    expect(p['tone.invert']).toBe(true);
    expect(String(p['effects.stack'])).toContain('scanlines');

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
        const same = Math.abs(r - paper[0]) < 12 && Math.abs(g - paper[1]) < 12 && Math.abs(b - paper[2]) < 12;
        if (x < 44 && !same) leftInk++;
        if (x >= 132 && !same) rightInk++;
        if (x >= 88) {
          if (b > 130 && r < 120) cyan++;
          if (g > 130 && b < 120) lime++;
        }
      }
    }
    // 深底：左（黑）边只有零星标点，右（白）边整格填实，两种颜色都在
    expect(rightInk).toBeGreaterThan(leftInk * 3);
    expect(cyan).toBeGreaterThan(50);
    expect(lime).toBeGreaterThan(50);
  });

  it('Acid Cipher 预设：柠檬绿底墨色 8 阶自定义序列，全从符号库取、墨量单调递增，浅底深符号不反相', () => {
    const cipher = builtinPresetParams(findBuiltinPreset('glyph-cipher')!);
    expect(cipher['style.type']).toBe('glyph');
    expect(cipher['glyph.ramp']).toBe('custom');
    expect(cipher['glyph.levels']).toBe(8);
    const shapes = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => cipher[glyphShapeId(k)] as GlyphId);
    expect(shapes).toEqual(['pip', 'ringtiny', 'quad', 'ring', 'ringdot', 'circlex', 'rings3', 'ringthick']);
    expect(rampIsMonotonic(shapes)).toBe(true);
    expect(cipher['glyph.colorMode']).toBe('mono');
    expect(cipher['glyph.ink']).toBe('#0E150A');
    expect(cipher['glyph.paper']).toBe('#C9F52C');
    expect(cipher['tone.invert']).toBe(false);
    // 参考图整体是亮的，把调子往上推一档才留得住大片纸色
    expect(Number(cipher['tone.brightness'])).toBeGreaterThan(0);
    expect(cipher['glyph.accent']).toBe(0);
    expect(cipher['tile.pitchX']).toBe(12);
    expect(cipher['tile.pitchY']).toBe(12);
    // 最亮一阶的小点缩到最暗一阶的 62%
    expect(levelSizes(Number(cipher['glyph.size']) / 100, Number(cipher['glyph.taper']) / 100, 8)[0]).toBeCloseTo(0.82 * 0.62, 5);
    // 八阶的墨量匀速递增，没有哪两阶挤在一起：最暗一阶比最亮一阶多四倍以上的墨
    const cs = shapes.map((id) => glyphCoverage(GLYPH_CODE[id]));
    expect(cs[7] / cs[0]).toBeGreaterThan(4);
    for (let k = 1; k < cs.length; k++) expect(cs[k] - cs[k - 1], `第 ${k + 1} 阶`).toBeGreaterThan(0.02);
    // 浅底：左（黑）边墨多、右（白）边基本只剩纸色与小点
    const out = renderImage(makeFrame(64, 40, (x) => [Math.round((x / 63) * 255), Math.round((x / 63) * 255), Math.round((x / 63) * 255)]), { ...cipher, 'canvas.width': 72, 'canvas.height': 36 });
    expect(out.width).toBe(72);
    let leftInk = 0;
    let rightInk = 0;
    const paper = [0xc9, 0xf5, 0x2c];
    for (let y = 0; y < 36; y++) {
      for (let x = 0; x < 72; x++) {
        const same = px(out, x, y).every((v, i) => Math.abs(v - paper[i]) < 8);
        if (x < 18 && !same) leftInk++;
        if (x >= 54 && !same) rightInk++;
      }
    }
    expect(leftInk).toBeGreaterThan(rightInk);
    expect(rightInk).toBeGreaterThan(0);
  });

  it('圆环一家的四个新符号：墨量从小圈到粗圈递增，粗环中间留得住孔、外缘落在符号半径上', () => {
    const c = (id: GlyphId) => glyphCoverage(GLYPH_CODE[id]);
    // 小圈补在小点与圆圈之间；三环比双圈重，粗圈最重但仍比实心圆点轻
    expect(c('pip')).toBeLessThan(c('ringtiny'));
    expect(c('ringtiny')).toBeLessThan(c('ring'));
    expect(c('rings')).toBeLessThan(c('rings3'));
    expect(c('rings3')).toBeLessThan(c('ringthick'));
    expect(c('ringthick')).toBeLessThan(c('dot'));
    expect(c('circlex')).toBeLessThan(c('ringorb'));

    const r = 10;
    const hw = 1.2;
    // 粗圈：外缘正好在 r 上，带里是墨，中间的孔与格子外都是纸
    expect(glyphDistance(GLYPH_CODE.ringthick, r - 0.3, 0, r, hw, 6.5, 6.5)).toBeLessThan(0);
    expect(glyphDistance(GLYPH_CODE.ringthick, r * 0.6, 0, r, hw, 6.5, 6.5)).toBeLessThan(0);
    expect(glyphDistance(GLYPH_CODE.ringthick, 0, 0, r, hw, 6.5, 6.5)).toBeGreaterThan(0);
    expect(glyphDistance(GLYPH_CODE.ringthick, r + 0.3, 0, r, hw, 6.5, 6.5)).toBeGreaterThan(0);
    // 带宽不跟线粗走：线粗改一倍，粗圈的孔还在原处
    expect(glyphDistance(GLYPH_CODE.ringthick, 0, 0, r, hw * 2, 6.5, 6.5)).toBeGreaterThan(0);
    // 环心球：正中是球，往外一圈纸缝，再往外是环
    expect(glyphDistance(GLYPH_CODE.ringorb, 0, 0, r, hw, 6.5, 6.5)).toBeLessThan(0);
    expect(glyphDistance(GLYPH_CODE.ringorb, r * 0.52, 0, r, hw, 6.5, 6.5)).toBeGreaterThan(0);
    expect(glyphDistance(GLYPH_CODE.ringorb, r * 0.9, 0, r, hw, 6.5, 6.5)).toBeLessThan(0);
    // 三环：三道墨（中线在 r−hw、0.62r−hw、0.26r−hw）之间夹着两道纸
    expect(glyphDistance(GLYPH_CODE.rings3, r * 0.95, 0, r, hw, 6.5, 6.5)).toBeLessThan(0);
    expect(glyphDistance(GLYPH_CODE.rings3, r * 0.5, 0, r, hw, 6.5, 6.5)).toBeLessThan(0);
    expect(glyphDistance(GLYPH_CODE.rings3, r * 0.14, 0, r, hw, 6.5, 6.5)).toBeLessThan(0);
    expect(glyphDistance(GLYPH_CODE.rings3, r * 0.7, 0, r, hw, 6.5, 6.5)).toBeGreaterThan(0);
    expect(glyphDistance(GLYPH_CODE.rings3, r * 0.32, 0, r, hw, 6.5, 6.5)).toBeGreaterThan(0);
  });

  it('SVG：粗环出一个自带 stroke-width 的描边 <circle>，盖掉 <g> 上的线粗', () => {
    const svg = halftoneToSvg(buildGlyphScreen(flatSource(24, 24, 0.5), custom(['ringthick', 'ringthick'])));
    expect(svg).toMatch(/<circle [^>]*fill="none" stroke-width="[\d.]+"/);
    // 三环一格三个描边圆，小圈一格一个
    const rings3 = halftoneToSvg(buildGlyphScreen(flatSource(12, 12, 0.5), custom(['rings3', 'rings3'])));
    expect((rings3.match(/<circle /g) ?? []).length).toBe(3);
    const tiny = halftoneToSvg(buildGlyphScreen(flatSource(12, 12, 0.5), custom(['ringtiny', 'ringtiny'])));
    expect((tiny.match(/<circle /g) ?? []).length).toBe(1);
  });
});

describe('新增符号：横板与穿孔块', () => {
  const NEW: GlyphId[] = ['slabthin', 'slab', 'slabwide', 'blockhole', 'blockhalf'];
  const c = (id: GlyphId) => glyphCoverage(GLYPH_CODE[id]);

  it('5 种都在符号库里且排在老的 62 个后面，编码不变；墨量关系：横条越厚越多，穿孔块比实心方少、比横板多', () => {
    for (const id of NEW) {
      expect(GLYPH_CODE[id], id).toBeGreaterThanOrEqual(62);
      expect(GLYPHS.find((g) => g.id === id)?.desc, id).toBeTruthy();
    }
    expect(GLYPH_IDS.length).toBe(107);
    // 三档横条：比横线粗，越厚墨越多，最厚的也没到实心方
    expect(c('slabthin')).toBeGreaterThan(c('dash'));
    expect(c('slabthin')).toBeLessThan(c('slab'));
    expect(c('slab')).toBeLessThan(c('slabwide'));
    expect(c('slabwide')).toBeLessThan(c('square'));
    // 穿孔块：实心方冲掉一个孔，所以比实心方少；孔很小，仍比横板多
    expect(c('blockhole')).toBeLessThan(c('square'));
    expect(c('blockhole')).toBeGreaterThan(c('slab'));
    // 半块正好是实心方的一半上下
    expect(c('blockhalf')).toBeGreaterThan(c('square') * 0.4);
    expect(c('blockhalf')).toBeLessThan(c('square') * 0.6);
  });

  it('渲染：横条按档变粗、左右邻格接成一条，厚板上下留缝；穿孔块中间是纸、四边是墨；半块只有下半截', () => {
    // 12px 方格、符号 100% → 半宽正好半格：三格并排（格心在 6 / 18 / 30）时格间那道缝也是墨，接成一条长线
    const thin = renderHalftone(buildGlyphScreen(flatSource(36, 12, 0.5), custom(['slabthin', 'slabthin'])));
    expect(px(thin, 6, 6)).toEqual([0, 0, 0]);
    expect(px(thin, 12, 6)).toEqual([0, 0, 0]);
    expect(px(thin, 18, 6)).toEqual([0, 0, 0]);
    // 细板半高 0.22 × 6 = 1.32px：格心那一行是墨，离格心 3px 已经是纸
    expect(px(thin, 6, 3)).toEqual([255, 255, 255]);
    // 横板半高 0.4 × 6 = 2.4px：离格心 2px 还是墨，4px 是纸
    const mid = renderHalftone(buildGlyphScreen(flatSource(36, 12, 0.5), custom(['slab', 'slab'])));
    expect(px(mid, 6, 4)).toEqual([0, 0, 0]);
    expect(px(mid, 6, 2)).toEqual([255, 255, 255]);
    expect(px(mid, 12, 6)).toEqual([0, 0, 0]);
    // 厚板半高 0.66 × 6 = 3.96px：格心上下 3px 是墨，格子上下两头是纸——成片时是带白缝的黑带
    const wide = renderHalftone(buildGlyphScreen(flatSource(12, 36, 0.5), custom(['slabwide', 'slabwide'])));
    expect(px(wide, 6, 3)).toEqual([0, 0, 0]);
    expect(px(wide, 6, 9)).toEqual([0, 0, 0]);
    expect(px(wide, 6, 0)).toEqual([255, 255, 255]);
    expect(px(wide, 6, 11)).toEqual([255, 255, 255]);
    // 穿孔块：中间那一小块是纸，四边是墨，块外还是纸
    const holed = renderHalftone(buildGlyphScreen(flatSource(12, 12, 0.5), custom(['blockhole', 'blockhole'])));
    expect(px(holed, 6, 6)).toEqual([255, 255, 255]);
    expect(px(holed, 9, 6)).toEqual([0, 0, 0]);
    expect(px(holed, 6, 9)).toEqual([0, 0, 0]);
    expect(px(holed, 0, 0)).toEqual([255, 255, 255]);
    // 半块：下半截是墨、上半截是纸
    const half = renderHalftone(buildGlyphScreen(flatSource(12, 12, 0.5), custom(['blockhalf', 'blockhalf'])));
    expect(px(half, 6, 9)).toEqual([0, 0, 0]);
    expect(px(half, 6, 3)).toEqual([255, 255, 255]);
  });

  it('SVG：横板是一个实心 <rect>，穿孔块是围着孔的四个 <rect>，孔里不出图形', () => {
    const bg = (svg: string) => (svg.match(/<rect /g) ?? []).length;
    // 铺底一个 + 图元
    expect(bg(halftoneToSvg(buildGlyphScreen(flatSource(12, 12, 0.5), custom(['slab', 'slab']))))).toBe(2);
    expect(bg(halftoneToSvg(buildGlyphScreen(flatSource(12, 12, 0.5), custom(['blockhole', 'blockhole']))))).toBe(5);
    expect(bg(halftoneToSvg(buildGlyphScreen(flatSource(12, 12, 0.5), custom(['blockhalf', 'blockhalf']))))).toBe(2);
    // 横板：宽是整格、高是半高的两倍
    const slab = halftoneToSvg(buildGlyphScreen(flatSource(12, 12, 0.5), custom(['slab', 'slab'])));
    const rect = [...slab.matchAll(/<rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].at(-1)!;
    expect(Number(rect[3])).toBeCloseTo(12, 5);
    expect(Number(rect[4])).toBeCloseTo(4.8, 5);
  });
});

describe('新增符号：竖栅一家', () => {
  const WEIGHTS: GlyphId[] = ['grillehair', 'grillefine', 'grillemid', 'grillebold', 'grillefull'];
  const c = (id: GlyphId) => glyphCoverage(GLYPH_CODE[id]);

  it('六种都排在老的 69 个后面，编码不变；五档粗细的墨量逐档递增，实心格最满', () => {
    for (const id of [...WEIGHTS, 'block' as GlyphId]) {
      expect(GLYPH_CODE[id], id).toBeGreaterThanOrEqual(69);
      expect(GLYPHS.find((g) => g.id === id)?.desc, id).toBeTruthy();
    }
    expect(GLYPH_IDS.length).toBe(107);
    for (let k = 1; k < WEIGHTS.length; k++) expect(c(WEIGHTS[k]), WEIGHTS[k]).toBeGreaterThan(c(WEIGHTS[k - 1]));
    expect(c('grillehair')).toBeGreaterThan(c('bar'));
    expect(c('grillefull')).toBeLessThan(c('block'));
    expect(c('block')).toBe(1);
    // 三道带子，每道宽 w 格，墨量就是 3w：微 15% → 满 87%，五档等差 18%
    const want = [0.15, 0.33, 0.51, 0.69, 0.87];
    WEIGHTS.forEach((id, k) => expect(c(id), id).toBeCloseTo(want[k], 1));
  });

  it('渲染：栅距不随粗细变，三道带子中心都在格宽的三等分点上，上下贯穿整格、邻格接得上', () => {
    // 24px 格、两格竖排：带子中心在 x = 4 / 12 / 20（格宽的三等分点），缝在中间
    const rows = (id: GlyphId) => renderHalftone(buildGlyphScreen(flatSource(24, 48, 0.5), custom([id, id], { pitchX: 24, pitchY: 24 })));
    const mid = rows('grillemid');
    // 中间那道从上到下整列是墨，跨过 y = 24 的格线也没断
    for (const y of [0, 12, 23, 24, 36, 47]) expect(px(mid, 12, y), `y=${y}`).toEqual([0, 0, 0]);
    for (const x of [4, 20]) expect(px(mid, x, 12), `x=${x}`).toEqual([0, 0, 0]);
    for (const x of [0, 8, 16]) expect(px(mid, x, 12), `x=${x}`).toEqual([255, 255, 255]);
    // 换成「微」：带子中心与缝的位置一模一样，只是细了——中间那道还在，「中」盖住的 x = 4 退回纸
    const hair = rows('grillehair');
    for (const y of [0, 23, 24, 47]) expect(px(hair, 12, y), `y=${y}`).toEqual([0, 0, 0]);
    for (const x of [0, 8, 16]) expect(px(hair, x, 12), `x=${x}`).toEqual([255, 255, 255]);
    expect(px(hair, 4, 12)).toEqual([255, 255, 255]);
    // 「满」只剩细缝：三等分点上还是墨，缝窄到只剩一像素
    const full = rows('grillefull');
    for (const x of [4, 12, 20]) expect(px(full, x, 12), `x=${x}`).toEqual([0, 0, 0]);
    for (const x of [7, 16]) expect(px(full, x, 12), `x=${x}`).toEqual([255, 255, 255]);
    // 实心格：整格是墨，缝也没了，邻格拼成一整片
    const block = renderHalftone(buildGlyphScreen(flatSource(24, 12, 0.5), custom(['block', 'block'])));
    for (let x = 0; x < 24; x++) expect(px(block, x, 6), `x=${x}`).toEqual([0, 0, 0]);
  });

  it('竖带的粗细不跟「符号大小」「线粗」走，细带也不会被冲淡', () => {
    const wide = buildGlyphScreen(flatSource(12, 12, 0.5), custom(['grillemid', 'grillemid'], { size: 0.4, stroke: 0.4 }));
    const narrow = buildGlyphScreen(flatSource(12, 12, 0.5), custom(['grillemid', 'grillemid'], { size: 1.5, stroke: 0.04 }));
    expect(renderHalftone(wide).data).toEqual(renderHalftone(narrow).data);
  });

  it('SVG：竖带出实心 <rect>，实心格一格一个铺满的 <rect>', () => {
    // 铺底一个 + 三道带子
    const midSvg = halftoneToSvg(buildGlyphScreen(flatSource(12, 12, 0.5), custom(['grillemid', 'grillemid'])));
    expect((midSvg.match(/<rect /g) ?? []).length).toBe(4);
    expect(midSvg).not.toMatch(/<rect [^>]*fill="none"/);
    // 铺底一个 + 一格一个铺满的
    const blockSvg = halftoneToSvg(buildGlyphScreen(flatSource(12, 12, 0.5), custom(['block', 'block'])));
    expect((blockSvg.match(/<rect /g) ?? []).length).toBe(2);
  });

  it('Aperture Grille 预设：7 阶从留空、五档竖栅到实心格，黑底反相、非线性空间，越亮的地方栅线越粗越暖', () => {
    const p = builtinPresetParams(findBuiltinPreset('glyph-grille')!);
    expect(p['style.type']).toBe('glyph');
    expect(p['glyph.ramp']).toBe('custom');
    expect(p['glyph.levels']).toBe(7);
    expect([1, 2, 3, 4, 5, 6, 7].map((k) => p[glyphShapeId(k)])).toEqual(['blank', ...WEIGHTS, 'block']);
    expect(p['glyph.colorMode']).toBe('levels');
    expect(p['glyph.color2']).toBe('#0E2B57');
    expect(p['glyph.color7']).toBe('#FFF6E2');
    expect(p['glyph.paper']).toBe('#04070C');
    expect(p['tone.invert']).toBe(true);
    // 关掉线性空间，7 个阶才均匀铺在明暗上
    expect(p['tone.linear']).toBe(false);

    // 左黑右白的渐变：墨量从左到右单调变多，颜色从深靛升到暖白
    const out = renderImage(makeFrame(224, 64, (x) => [Math.round((x / 223) * 255), Math.round((x / 223) * 255), Math.round((x / 223) * 255)]), { ...p, 'canvas.width': 224, 'canvas.height': 64 });
    const paper = px(out, 0, 0);
    expect(paper).toEqual([4, 7, 12]);
    const ink = (x0: number, x1: number) => {
      let n = 0;
      for (let y = 0; y < 64; y++) for (let x = x0; x < x1; x++) if (!px(out, x, y).every((v, i) => Math.abs(v - paper[i]) < 8)) n++;
      return n;
    };
    const thirds = [ink(0, 74), ink(74, 148), ink(148, 224)];
    expect(thirds[1]).toBeGreaterThan(thirds[0]);
    expect(thirds[2]).toBeGreaterThan(thirds[1]);
    // 最亮那头烧成整片暖白，最暗那头基本是黑底
    expect(px(out, 220, 32)[0]).toBeGreaterThan(200);
    expect(thirds[0] / (74 * 64)).toBeLessThan(0.3);
  });

  it('Ink Atlas 预设：暖白纸上 7 阶自定义序列，圆角方铺满时格间只留一道细缝，圆点刚好一格宽', () => {
    const p = builtinPresetParams(findBuiltinPreset('glyph-atlas')!);
    expect(p['style.type']).toBe('glyph');
    expect(p['glyph.ramp']).toBe('custom');
    expect(p['glyph.levels']).toBe(7);
    expect([1, 2, 3, 4, 5, 6, 7].map((k) => p[glyphShapeId(k)])).toEqual(['blank', 'pip', 'slashdash', 'plus', 'tri', 'dot', 'roundsquare']);
    expect(p['glyph.colorMode']).toBe('mono');
    expect(p['glyph.ink']).toBe('#16202D');
    expect(p['glyph.paper']).toBe('#FAF7F1');
    // 亮纸暗符号，不反相
    expect(p['tone.invert']).toBe(false);

    const size = Number(p['glyph.size']) / 100;
    const sizes = levelSizes(size, Number(p['glyph.taper']) / 100, 7);
    // 逐阶放大，最暗一阶就是「符号大小」本身
    for (let k = 1; k < 7; k++) expect(sizes[k], `第 ${k + 1} 阶`).toBeGreaterThan(sizes[k - 1]);
    expect(sizes[6]).toBeCloseTo(size, 6);
    // 圆角方的半边是 0.85r：最暗一阶抵过格子边，成片的黑连起来，格间只剩一道细缝
    expect(sizes[6] * 0.85).toBeGreaterThan(1);
    // 圆点那一阶刚好一格宽：邻格相切而不糊成一片
    expect(sizes[5]).toBeCloseTo(1, 1);
    expect(sizes[5]).toBeLessThan(1.06);
    // 最亮的小点（半径 0.45r）连三成格子都占不到
    expect(sizes[1] * 0.45 * 2).toBeLessThan(0.3);

    // 源图与画布同尺寸，免得适配裁掉渐变的两端
    const out = renderImage(makeFrame(182, 65, (x) => [Math.round((x / 181) * 255), Math.round((x / 181) * 255), Math.round((x / 181) * 255)]), { ...p, 'canvas.width': 182, 'canvas.height': 65 });
    expect(out.width).toBe(182);
    const paper = px(out, 181, 0);
    // 纸是暖白：偏红、不是纯白
    expect(paper[0]).toBeGreaterThan(paper[2]);
    expect(paper[0]).toBeLessThan(255);
    let darkInk = 0;
    let lightInk = 0;
    let seam = 0;
    for (let y = 0; y < 65; y++) {
      for (let x = 0; x < 182; x++) {
        const [r, g, b] = px(out, x, y);
        const same = Math.abs(r - paper[0]) < 8 && Math.abs(g - paper[1]) < 8 && Math.abs(b - paper[2]) < 8;
        if (x < 26) {
          if (!same) darkInk++;
          // 纯墨与纸之间的灰：铺满的实心方之间那道格线
          if (!same && r > 40) seam++;
        }
        if (x >= 156 && !same) lightInk++;
      }
    }
    // 亮纸暗符号：暗的一端几乎铺满墨，亮的一端只有零星小点
    expect(darkInk / (26 * 65)).toBeGreaterThan(0.9);
    expect(lightInk).toBeLessThan(darkInk / 10);
    // 铺满的黑不是纯粹一整块墨：圆角方之间仍留着一层细格线与格点上的纸色星芒
    expect(seam / darkInk).toBeGreaterThan(0.02);
  });

  it('Raster Poster 预设：同一家竖栅但换成扁格子，7 阶从一条细竖线到满档竖栅，黑底反相，淡黄那片还留着竖栅的缝', () => {
    const p = builtinPresetParams(findBuiltinPreset('glyph-raster')!);
    expect(p['style.type']).toBe('glyph');
    expect(p['glyph.ramp']).toBe('custom');
    expect(p['glyph.levels']).toBe(7);
    expect([1, 2, 3, 4, 5, 6, 7].map((k) => p[glyphShapeId(k)])).toEqual(['blank', 'bar', ...WEIGHTS]);
    // 扁格子：竖栅密、横向分层粗，与方格子的 Aperture Grille 分开
    expect(Number(p['tile.pitchX'])).toBeGreaterThan(Number(p['tile.pitchY']));
    expect(p['glyph.colorMode']).toBe('levels');
    expect(p[glyphColorId(6)]).toBe('#F2EC9A');
    expect(p[glyphColorId(7)]).toBe('#FAF7EA');
    expect(p['glyph.paper']).toBe('#05080D');
    expect(p['tone.invert']).toBe(true);

    // 左黑右白的渐变：墨量从左到右单调变多
    const out = renderImage(makeFrame(216, 63, (x) => [Math.round((x / 215) * 255), Math.round((x / 215) * 255), Math.round((x / 215) * 255)]), { ...p, 'canvas.width': 216, 'canvas.height': 63 });
    const paper = px(out, 0, 0);
    const ink = (x0: number, x1: number) => {
      let n = 0;
      for (let y = 0; y < 63; y++) for (let x = x0; x < x1; x++) if (!px(out, x, y).every((v, i) => Math.abs(v - paper[i]) < 24)) n++;
      return n;
    };
    const thirds = [ink(0, 72), ink(72, 144), ink(144, 216)];
    expect(thirds[1]).toBeGreaterThan(thirds[0]);
    expect(thirds[2]).toBeGreaterThan(thirds[1]);
    // 最暗那头基本是黑底
    expect(thirds[0] / (72 * 63)).toBeLessThan(0.3);

    // 淡黄那一阶（粗档竖栅）成片出现，而且同一片里还留着竖栅的暗缝
    let yellow = 0;
    let x0 = 216;
    let x1 = 0;
    for (let y = 0; y < 63; y++) {
      for (let x = 0; x < 216; x++) {
        const [r, g, b] = px(out, x, y);
        if (r > 180 && g > 180 && b < 200) {
          yellow++;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
        }
      }
    }
    expect(yellow).toBeGreaterThan(800);
    let slit = 0;
    for (let y = 0; y < 63; y++) for (let x = x0; x <= x1; x++) if (px(out, x, y)[1] < 90) slit++;
    expect(slit).toBeGreaterThan(100);
  });
});

describe('新增符号：断斜线与圆角方', () => {
  const c = (id: GlyphId) => glyphCoverage(GLYPH_CODE[id]);

  it('两种都接在老的 79 个后面，编码不变；断斜线短于贯穿的斜线，圆角方少于实心方', () => {
    expect(GLYPH_IDS.length).toBe(107);
    for (const id of ['slashdash', 'roundsquare'] as GlyphId[]) {
      expect(GLYPH_CODE[id], id).toBeGreaterThanOrEqual(79);
      expect(GLYPHS.find((g) => g.id === id)?.desc, id).toBeTruthy();
    }
    // 断斜线是收了两头的贯穿斜线：比贯穿的少墨，比格内的短斜线多
    expect(c('slashdash')).toBeLessThan(c('slash'));
    expect(c('slashdash')).toBeGreaterThan(c('slashshort'));
    // 圆角方是磨了角的实心方：比它少一点墨，比空心的圆角框多得多
    expect(c('roundsquare')).toBeLessThan(c('square'));
    expect(c('roundsquare')).toBeGreaterThan(c('roundbox'));
  });

  it('渲染：断斜线在格角断开、贯穿的斜线不断，长度不随符号大小变；圆角方铺满时格点上留着纸色星芒', () => {
    // 24×24、12px 方格（格心在 0 / 12 / 24）：「/」是沿左下—右上的邻格接起来的，两段在格点 (6, 6) 交班
    const slash = renderHalftone(buildGlyphScreen(flatSource(24, 24, 0.5), custom(['slash', 'slash'])));
    const dash = renderHalftone(buildGlyphScreen(flatSource(24, 24, 0.5), custom(['slashdash', 'slashdash'])));
    // 格心一段都在
    expect(px(slash, 12, 11)).toEqual([0, 0, 0]);
    expect(px(dash, 12, 11)).toEqual([0, 0, 0]);
    // 交班的格点上：贯穿的接得上，断斜线断开
    expect(px(slash, 6, 6)).toEqual([0, 0, 0]);
    expect(px(dash, 6, 6)).toEqual([255, 255, 255]);
    // 断斜线是跨格图元：符号大小减半，断口还在同一处
    const small = renderHalftone(buildGlyphScreen(flatSource(24, 24, 0.5), custom(['slashdash', 'slashdash'], { size: 0.5 })));
    expect(px(small, 12, 11)).toEqual([0, 0, 0]);
    expect(px(small, 6, 6)).toEqual([255, 255, 255]);

    // 24px 方格、122% 的圆角方：四条边都抵过格子边，成片连成黑，但四格相聚的格点 (12, 12) 上留着纸色星芒
    const big = { size: 1.22, pitchX: 24, pitchY: 24 };
    const rsq = renderHalftone(buildGlyphScreen(flatSource(48, 48, 0.5), custom(['roundsquare', 'roundsquare'], big)));
    expect(px(rsq, 12, 12)).toEqual([255, 255, 255]);
    // 格边中点与格心都是墨：远看还是整块黑
    expect(px(rsq, 12, 24)).toEqual([0, 0, 0]);
    expect(px(rsq, 24, 24)).toEqual([0, 0, 0]);
    // 同样大小的实心方把格点也盖住，没有星芒
    const square = renderHalftone(buildGlyphScreen(flatSource(48, 48, 0.5), custom(['square', 'square'], big)));
    expect(px(square, 12, 12)).toEqual([0, 0, 0]);
  });

  it('SVG：断斜线出一条 <line>，圆角方出一个带 rx 的实心 <rect>', () => {
    const dash = halftoneToSvg(buildGlyphScreen(flatSource(12, 12, 0.5), custom(['slashdash', 'slashdash'])));
    expect((dash.match(/<line /g) ?? []).length).toBe(1);
    const rsq = halftoneToSvg(buildGlyphScreen(flatSource(12, 12, 0.5), custom(['roundsquare', 'roundsquare'])));
    // 铺底一个 + 圆角方一个，只有圆角方带 rx
    expect((rsq.match(/<rect /g) ?? []).length).toBe(2);
    expect((rsq.match(/ rx="/g) ?? []).length).toBe(1);
    expect(rsq).not.toMatch(/<rect [^>]*rx="[^"]*"[^>]*fill="none"/);
  });
});

describe('新增符号：密竖纹', () => {
  const c = (id: GlyphId) => glyphCoverage(GLYPH_CODE[id]);

  it('排在老的 97 个后面，编码不变；墨量比竖纹与竖栅·微都多，比实心格少', () => {
    expect(GLYPH_CODE.bars).toBeGreaterThanOrEqual(97);
    expect(GLYPHS.find((g) => g.id === 'bars')?.desc).toBeTruthy();
    expect(GLYPH_IDS.length).toBe(107);
    expect(c('bars')).toBeGreaterThan(c('stripes'));
    expect(c('bars')).toBeGreaterThan(c('grillehair'));
    expect(c('bars')).toBeLessThan(c('block'));
  });

  it('渲染：五道整列铺满、比竖纹密，左右两道压在格线上与邻格接成一道', () => {
    // 12px 格、100% 大小：跨格半长是 6.5，五道竖线落在格心 ±5.2 / ±2.6 / 0 → x = 0.8 / 3.4 / 6 / 8.6 / 11.2
    const bars = renderHalftone(buildGlyphScreen(flatSource(12, 24, 0.5), custom(['bars', 'bars'])));
    for (let y = 0; y < 24; y++) expect(px(bars, 6, y), `y=${y}`).toEqual([0, 0, 0]);
    expect(px(bars, 3, 6)).toEqual([0, 0, 0]);
    expect(px(bars, 8, 6)).toEqual([0, 0, 0]);
    expect(px(bars, 0, 6)).toEqual([0, 0, 0]);
    expect(px(bars, 11, 6)).toEqual([0, 0, 0]);
    // 两道之间留纸；竖纹在同一处是空的，密竖纹确实更密
    expect(px(bars, 4, 6)).toEqual([255, 255, 255]);
    const stripes = renderHalftone(buildGlyphScreen(flatSource(12, 24, 0.5), custom(['stripes', 'stripes'])));
    expect(px(stripes, 3, 6)).toEqual([255, 255, 255]);
  });

  it('SVG：出五条 <line>', () => {
    const bars = halftoneToSvg(buildGlyphScreen(flatSource(12, 12, 0.5), custom(['bars', 'bars'])));
    expect((bars.match(/<line /g) ?? []).length).toBe(5);
  });

  it('Pixel Blocks 预设：8 阶自定义序列从小点、小方点到实心方，亮处橙、暗处蓝，米纸不反相，带颗粒纸纹', () => {
    const p = builtinPresetParams(findBuiltinPreset('glyph-pixel-blocks')!);
    expect(p['style.type']).toBe('glyph');
    expect(p['glyph.ramp']).toBe('custom');
    expect(p['glyph.levels']).toBe(8);
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((k) => p[glyphShapeId(k)])).toEqual(['blank', 'pip', 'tinysquare', 'tri', 'dot', 'checker', 'bars', 'square']);
    expect(p['glyph.colorMode']).toBe('levels');
    // 中间调三阶是橙，往暗处两阶是蓝、最暗一阶更深
    expect([3, 4, 5].map((k) => p[glyphColorId(k)])).toEqual(['#F26A1B', '#F26A1B', '#F26A1B']);
    expect([6, 7].map((k) => p[glyphColorId(k)])).toEqual(['#6C79C1', '#6C79C1']);
    expect(p[glyphColorId(8)]).toBe('#4E5CAE');
    expect(p['glyph.paper']).toBe('#EBE7DD');
    // 实心方、密竖纹、棋盘格都要在邻格之间接上；亮部缩小让小方点真的小
    expect(p['glyph.size']).toBe(100);
    expect(Number(p['glyph.taper'])).toBeGreaterThanOrEqual(50);
    // 浅底不反相
    expect(p['tone.invert']).toBe(false);
    expect(String(p['effects.stack'])).toContain('grain');

    // 源图与画布同尺寸，免得适配裁掉渐变的两端
    const out = renderImage(makeFrame(192, 64, (x) => {
      const v = Math.round((x / 191) * 255);
      return [v, v, v];
    }), { ...p, 'canvas.width': 192, 'canvas.height': 64 });
    expect(out.width).toBe(192);
    let orange = 0;
    let blue = 0;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 192; x++) {
        const [r, g, b] = px(out, x, y);
        // 暗的一半应当是蓝，亮的一半应当是橙
        if (x < 96 && b > r + 40) blue++;
        if (x >= 96 && r > 180 && b < 120) orange++;
      }
    }
    expect(blue).toBeGreaterThan(300);
    expect(orange).toBeGreaterThan(300);
  });
});

describe('新增符号：位图密度阶', () => {
  const NEW: GlyphId[] = ['xdot', 'quarter', 'trio'];
  const c = (id: GlyphId) => glyphCoverage(GLYPH_CODE[id]);

  it('3 种都在符号库里且排在老的 100 个后面，编码不变；墨量从小方点、小叉、小圈一路排到角块 ¼、棋盘 ² ⁄ ₄、缺角块 ¾、实心格 4/4', () => {
    for (const id of NEW) {
      expect(GLYPH_CODE[id], id).toBeGreaterThanOrEqual(100);
      expect(GLYPHS.find((g) => g.id === id)?.desc, id).toBeTruthy();
    }
    // 亮处那三个小记号都比一个象限少墨，彼此也分得开
    expect(c('tinysquare')).toBeLessThan(c('xdot'));
    expect(c('xdot')).toBeLessThan(c('ringtiny'));
    expect(c('ringtiny')).toBeLessThan(c('quarter'));
    // 小记号都缩在格子里：比同一路的大号少墨
    expect(c('tinysquare')).toBeLessThan(c('square'));
    expect(c('xdot')).toBeLessThan(c('xmark'));
    // 密度阶：填的象限一个比一个多，实心格铺满整格、是整个符号库里最暗的一个
    expect(c('quarter')).toBeLessThan(c('checker'));
    expect(c('checker')).toBeLessThan(c('trio'));
    expect(c('trio')).toBeLessThan(c('block'));
    expect(c('block')).toBe(1);
  });

  it('渲染：角块只占左上一个象限，缺角块只剩左下角是纸，接缝上不留半墨的发丝线；两个都按格铺、不随符号大小缩放', () => {
    // 12px 格、36×36 画布：格心落在 6 / 18 / 30，横纵各三格
    // 角块：只有格心左上那个象限是墨，另外三个象限是纸
    const quarter = renderHalftone(buildGlyphScreen(flatSource(36, 36, 0.5), custom(['quarter', 'quarter'])));
    expect(px(quarter, 14, 14)).toEqual([0, 0, 0]);
    expect(px(quarter, 22, 14)).toEqual([255, 255, 255]);
    expect(px(quarter, 14, 22)).toEqual([255, 255, 255]);
    expect(px(quarter, 22, 22)).toEqual([255, 255, 255]);
    // 缺角块：四个象限里只有左下是纸，格内两道接缝上是实墨、不是半墨
    const trio = renderHalftone(buildGlyphScreen(flatSource(36, 36, 0.5), custom(['trio', 'trio'])));
    expect(px(trio, 14, 14)).toEqual([0, 0, 0]);
    expect(px(trio, 22, 14)).toEqual([0, 0, 0]);
    expect(px(trio, 22, 22)).toEqual([0, 0, 0]);
    expect(px(trio, 18, 14)).toEqual([0, 0, 0]);
    expect(px(trio, 22, 18)).toEqual([0, 0, 0]);
    expect(px(trio, 14, 22)).toEqual([255, 255, 255]);
    // 墨一阶比一阶多：角块 ⊂ 棋盘 ⊂ 缺角块 ⊂ 实心格
    const checker = renderHalftone(buildGlyphScreen(flatSource(36, 36, 0.5), custom(['checker', 'checker'])));
    const block = renderHalftone(buildGlyphScreen(flatSource(36, 36, 0.5), custom(['block', 'block'])));
    const ink = (f: { data: Uint8ClampedArray }) => {
      let n = 0;
      for (let k = 0; k < f.data.length; k += 4) if (f.data[k] === 0) n++;
      return n;
    };
    expect(ink(quarter)).toBeLessThan(ink(checker));
    expect(ink(checker)).toBeLessThan(ink(trio));
    expect(ink(trio)).toBeLessThan(ink(block));
    // 按格铺：符号大小缩到一半，两个块画出来一模一样
    for (const id of ['quarter', 'trio'] as GlyphId[]) {
      const full = renderHalftone(buildGlyphScreen(flatSource(24, 24, 0.5), custom([id, id])));
      const half = renderHalftone(buildGlyphScreen(flatSource(24, 24, 0.5), custom([id, id], { size: 0.5 })));
      expect(Array.from(half.data), id).toEqual(Array.from(full.data));
    }
  });

  it('SVG：角块与缺角块是跨格的实心 <rect>，小叉是两条 <line>', () => {
    const quarter = halftoneToSvg(buildGlyphScreen(flatSource(12, 12, 0.5), custom(['quarter', 'quarter'])));
    // 铺底一个 + 角块自己一个；矢量里跨格图元多出 0.25px（`glyphSpan(screen, 0.25)`），
    // 半格 6.25 × 0.56 = 3.5 见方、格心左上
    const rects = quarter.match(/<rect [^>]*>/g) ?? [];
    expect(rects.length).toBe(2);
    expect(rects[1]).toMatch(/x="-6.62" y="-6.62" width="7" height="7"/);
    const trio = halftoneToSvg(buildGlyphScreen(flatSource(12, 12, 0.5), custom(['trio', 'trio'])));
    expect((trio.match(/<rect /g) ?? []).length).toBe(4);
    const xdot = halftoneToSvg(buildGlyphScreen(flatSource(12, 12, 0.5), custom(['xdot', 'xdot'])));
    expect((xdot.match(/<line /g) ?? []).length).toBe(2);
  });
});

describe('符号预设：Ultramarine Bitmap', () => {
  it('Ultramarine Bitmap 预设：8 阶自定义序列从小方点、小叉、小圈到角块、棋盘、缺角块与实心格，同族群青逐阶变深，浅纸深墨不反相，暗处铺成整片实底', () => {
    const p = builtinPresetParams(findBuiltinPreset('glyph-ultramarine')!);
    expect(p['style.type']).toBe('glyph');
    expect(p['glyph.ramp']).toBe('custom');
    expect(p['glyph.levels']).toBe(8);
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((k) => p[glyphShapeId(k)])).toEqual(['blank', 'tinysquare', 'xdot', 'ringtiny', 'quarter', 'checker', 'trio', 'block']);
    expect(p['glyph.colorMode']).toBe('levels');
    expect(p['glyph.paper']).toBe('#F0EEF7');
    // 浅纸深墨，不反相；点缀符号关掉，大片实心里不掺圈和三角
    expect(p['tone.invert']).toBe(false);
    expect(p['glyph.accent']).toBe(0);
    // 棋盘要在邻格之间接上；角块 / 缺角块 / 实心格按格铺，本来就不随大小缩放
    expect(p['glyph.size']).toBe(100);
    expect(p['glyph.taper']).toBe(0);
    // 交界处两阶的符号掺在一起，边界才碎得开
    expect(Number(p['glyph.mix'])).toBeGreaterThanOrEqual(60);

    // 分级配色是同一族群青：每一阶都蓝得明显，第 2 阶起逐阶变深
    const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const levelHexes = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => String(p[glyphColorId(k)]));
    const lum = (h: string) => {
      const [r, g, b] = hex(h);
      return 0.299 * r + 0.587 * g + 0.114 * b;
    };
    for (const h of levelHexes) {
      const [r, g, b] = hex(h);
      expect(b, h).toBeGreaterThan(r + 60);
      expect(b, h).toBeGreaterThan(g + 60);
    }
    for (let k = 2; k < levelHexes.length; k++) expect(lum(levelHexes[k]), levelHexes[k]).toBeLessThan(lum(levelHexes[k - 1]));

    // 源图与画布同尺寸，免得适配裁掉渐变的两端
    const out = renderImage(makeFrame(176, 66, (x) => [Math.round((x / 175) * 255), Math.round((x / 175) * 255), Math.round((x / 175) * 255)]), { ...p, 'canvas.width': 176, 'canvas.height': 66 });
    expect(out.width).toBe(176);
    const paper = px(out, 175, 0);
    // 右上角是最亮的一端，落在「空」阶上，看到的就是纸色
    expect(paper).toEqual([240, 238, 247]);
    let darkInk = 0;
    let lightInk = 0;
    for (let y = 0; y < 66; y++) {
      for (let x = 0; x < 176; x++) {
        const [r, g, b] = px(out, x, y);
        const same = Math.abs(r - paper[0]) < 8 && Math.abs(g - paper[1]) < 8 && Math.abs(b - paper[2]) < 8;
        if (!same) {
          // 墨都是群青
          expect(b).toBeGreaterThan(r);
          expect(b).toBeGreaterThan(g);
        }
        if (x < 22 && !same) darkInk++;
        if (x >= 154 && !same) lightInk++;
      }
    }
    // 浅纸：左（黑）边被实心格铺成一整片实底，右（白）边只剩零星小记号
    expect(darkInk).toBe(22 * 66);
    expect(lightInk).toBeLessThan(22 * 66 * 0.1);
  });
});

describe('新增符号：方块马赛克', () => {
  const PIX: GlyphId[] = ['pixel', 'pixstair', 'pixcross', 'pixframe'];
  const c = (id: GlyphId) => glyphCoverage(GLYPH_CODE[id]);

  it('四种都排在老的 103 个后面，编码不变；墨量按小方块个数递增，最多的也比实心方少，最小的比「小方点」小', () => {
    for (const id of PIX) {
      expect(GLYPH_CODE[id], id).toBeGreaterThanOrEqual(103);
      expect(GLYPHS.find((g) => g.id === id)?.desc, id).toBeTruthy();
    }
    expect(GLYPH_IDS.length).toBe(107);
    for (let k = 1; k < PIX.length; k++) expect(c(PIX[k]), PIX[k]).toBeGreaterThan(c(PIX[k - 1]));
    expect(c('pixel')).toBeLessThan(c('tinysquare'));
    expect(c('pixframe')).toBeLessThan(c('square'));
    expect(c('square')).toBeLessThan(c('block'));
    // 3×3 里填了几格，墨量就是实心方的几分之九（墨量按 48×48 采样，小方块的量化误差大一点）
    const nine = c('square') / 9;
    [1, 3, 5, 8].forEach((n, k) => expect(c(PIX[k]), PIX[k]).toBeCloseTo(n * nine, 1));
  });

  it('四种切在同一张 3×3 小格上：像素方只有中心，像素十字缺四角，像素回中心是纸，外缘与实心方齐平', () => {
    const r = 12;
    const hw = 1.5;
    const span = 8;
    // 小方的中心间距：实心方的半边是 0.85r，一格 3 份
    const m = (r * 0.85 * 2) / 3;
    const d = (id: GlyphId, x: number, y: number) => glyphDistance(GLYPH_CODE[id], x, y, r, hw, span, span);
    expect(d('pixel', 0, 0)).toBeLessThan(0);
    expect(d('pixel', m, 0)).toBeGreaterThan(0);
    expect(d('pixcross', 0, 0)).toBeLessThan(0);
    expect(d('pixcross', 0, -m)).toBeLessThan(0);
    expect(d('pixcross', -m, -m)).toBeGreaterThan(0);
    expect(d('pixframe', 0, 0)).toBeGreaterThan(0);
    expect(d('pixframe', -m, -m)).toBeLessThan(0);
    expect(d('pixstair', -m, -m)).toBeLessThan(0);
    expect(d('pixstair', m, -m)).toBeGreaterThan(0);
    // 外缘与实心方齐平
    expect(d('pixframe', 0.85 * r - 0.3, 0)).toBeLessThan(0);
    expect(d('pixframe', 0.85 * r + 0.3, 0)).toBeGreaterThan(0);
    // 不跟线粗走：线粗调大也还是那几个小方
    expect(glyphDistance(GLYPH_CODE.pixel, m, 0, r, 6, span, span)).toBeGreaterThan(0);
  });

  it('SVG：像素块每一格出一个实心 <rect>，个数就是填的格数', () => {
    const rects = (id: GlyphId) => (halftoneToSvg(buildGlyphScreen(flatSource(12, 12, 0.5), custom([id, id]))).match(/<rect /g) ?? []).length;
    // 铺底一个 + 这一格里的小方
    expect(rects('pixel')).toBe(2);
    expect(rects('pixstair')).toBe(4);
    expect(rects('pixcross')).toBe(6);
    expect(rects('pixframe')).toBe(9);
  });

  it('「马赛克」推荐序列全是方块，8 个按墨量排好，最暗一阶是与邻格连成整片的实心格', () => {
    const ramp = rampFor('mosaic', 8);
    expect(ramp).toEqual(['blank', 'pixel', 'pixstair', 'pixcross', 'checker', 'pixframe', 'square', 'block']);
    expect(rampIsMonotonic(ramp)).toBe(true);
    expect(rampFor('mosaic', 2)).toEqual(['blank', 'block']);
  });

  it('Swiss Mosaic 预设：7 阶 空 → 像素方 → 像素十字 → 实心方 → 实心格，绿蓝逐阶交错，淡灰纸不反相', () => {
    const p = builtinPresetParams(findBuiltinPreset('glyph-swiss')!);
    expect(p['style.type']).toBe('glyph');
    expect(p['glyph.ramp']).toBe('custom');
    expect(p['glyph.levels']).toBe(7);
    expect([1, 2, 3, 4, 5, 6, 7].map((k) => p[glyphShapeId(k)])).toEqual(['blank', 'pixel', 'pixcross', 'square', 'square', 'square', 'block']);
    expect(p['glyph.colorMode']).toBe('levels');
    // 第 5 阶回到绿，成片的蓝里才掺得进绿方块
    expect([3, 4, 5, 6, 7].map((k) => p[glyphColorId(k)])).toEqual(['#00A05B', '#0F5FC4', '#00A05B', '#0F5FC4', '#0B4FA8']);
    expect(p['glyph.paper']).toBe('#EFEFEF');
    // 亮处的方块要比暗处小；符号大小留出格线一样的纸缝，最暗一阶的实心格不受它影响
    expect(Number(p['glyph.taper'])).toBeGreaterThan(0);
    expect(Number(p['glyph.size'])).toBeLessThan(100);
    expect(Number(p['glyph.mix'])).toBeGreaterThanOrEqual(60);
    expect(p['glyph.accent']).toBe(0);
    expect(p['tone.invert']).toBe(false);

    // 源图与画布同尺寸，免得适配裁掉渐变的两端；左黑右白
    const out = renderImage(makeFrame(400, 160, (x) => [Math.round((x / 399) * 255), Math.round((x / 399) * 255), Math.round((x / 399) * 255)]), { ...p, 'canvas.width': 400, 'canvas.height': 160 });
    expect(out.width).toBe(400);
    const paper = px(out, 399, 0);
    let darkInk = 0;
    let lightInk = 0;
    let solid = 0;
    let green = 0;
    let blue = 0;
    for (let y = 0; y < 160; y++) {
      for (let x = 0; x < 400; x++) {
        const [r, g, b] = px(out, x, y);
        const same = Math.abs(r - paper[0]) < 8 && Math.abs(g - paper[1]) < 8 && Math.abs(b - paper[2]) < 8;
        if (x < 80 && !same) darkInk++;
        if (x >= 320 && !same) lightInk++;
        // 最暗那一阶是实心格，与邻格连成整片：最黑的一条上没有纸缝
        if (x < 40 && !same) solid++;
        // 中间调：绿的一阶夹在两阶蓝之间，两色在同一片里掺着出现
        if (x >= 200 && x < 320) {
          if (g > 120 && b < 120) green++;
          if (b > 120 && g < 120) blue++;
        }
      }
    }
    expect(solid).toBe(40 * 160);
    // 亮底不反相：左（黑）边连成整片，右（白）边只剩零星几粒
    expect(darkInk).toBeGreaterThan(lightInk * 3);
    expect(green).toBeGreaterThan(200);
    expect(blue).toBeGreaterThan(200);
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

  it('Desync 预设：横板分档、黑块冲孔、黄绿占两阶——分级配色，扫描行位移与颗粒', () => {
    const desync = builtinPresetParams(findBuiltinPreset('glyph-desync')!);
    expect(desync['style.type']).toBe('glyph');
    expect(desync['glyph.ramp']).toBe('custom');
    expect(desync['glyph.levels']).toBe(8);
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((k) => desync[glyphShapeId(k)])).toEqual([
      'blank',
      'minus',
      'slabthin',
      'slab',
      'blockhole',
      'square',
      'blockhole',
      'square',
    ]);
    // 横条那三阶按墨量从少到多，暗处的横板真的更粗
    const c = (id: GlyphId) => glyphCoverage(GLYPH_CODE[id]);
    expect(c('minus')).toBeLessThan(c('slabthin'));
    expect(c('slabthin')).toBeLessThan(c('slab'));
    expect(c('slab')).toBeLessThan(c('blockhole'));
    // 荧光黄绿占第 5、6 两阶，成片而不是一条细边；其余都是墨黑
    expect(desync['glyph.colorMode']).toBe('levels');
    expect(desync['glyph.color5']).toBe('#D6FF1A');
    expect(desync['glyph.color6']).toBe('#D6FF1A');
    for (const k of [1, 2, 3, 4, 7, 8]) expect(desync[glyphColorId(k)], `第 ${k} 阶`).toBe('#111111');
    expect(desync['glyph.paper']).toBe('#F2F2EE');
    // 白纸深符号，不反相
    expect(desync['tone.invert']).toBe(false);
    // 亮部缩小把两头拉开：短横那一阶断成虚线（≤ 95%），实心方与穿孔块盖满格子、邻格之间不留线（≥ 118%）
    const sizes = levelSizes(Number(desync['glyph.size']) / 100, Number(desync['glyph.taper']) / 100, 8);
    expect(sizes[1]).toBeLessThanOrEqual(0.99);
    for (const k of [4, 5, 6, 7]) expect(sizes[k], `第 ${k + 1} 阶`).toBeGreaterThanOrEqual(1.18);
    // 特效栈：扫描行位移的带高与格子等高，整行的块一起挪；再加一点颗粒
    const stack = parseStack(desync['effects.stack']);
    expect(stack.map((e) => e.type)).toEqual(['rowShift', 'grain']);
    expect(stack.every((e) => e.enabled)).toBe(true);
    expect(stack[0].params.band).toBe(desync['tile.pitchY']);
    // 左黑右白的渐变：左边是黑块、右边是纸色，中间有黄绿，黑块里能找到纸色的孔
    // （先关掉特效，行位移会把整行绕到另一边、颗粒会让颜色不再是纯色）
    const out = renderImage(
      makeFrame(264, 66, (x) => {
        const v = Math.round((x / 263) * 255);
        return [v, v, v];
      }),
      { ...desync, 'effects.stack': '', 'canvas.width': 264, 'canvas.height': 66 },
    );
    const near = (q: number[], hex: string) => hexToRgb(hex).every((v, i) => Math.abs(q[i] - v) < 8);
    const ink = (x: number, y: number) => near(px(out, x, y), '#111111');
    let lime = 0;
    let leftBlack = 0;
    let rightPaper = 0;
    // 穿孔块的孔：一粒纸色，上下左右 3px 都还在墨里——横板之间的白缝左右也是纸，不会误判
    let holeInBlack = 0;
    for (let y = 0; y < 66; y++) {
      for (let x = 0; x < 264; x++) {
        const q = px(out, x, y);
        if (near(q, '#D6FF1A')) lime++;
        if (x < 26 && near(q, '#111111')) leftBlack++;
        if (x >= 238 && near(q, '#F2F2EE')) rightPaper++;
        if (x >= 3 && x < 261 && y >= 3 && y < 63 && near(q, '#F2F2EE') && ink(x - 3, y) && ink(x + 3, y) && ink(x, y - 3) && ink(x, y + 3)) holeInBlack++;
      }
    }
    expect(lime).toBeGreaterThan(0);
    expect(leftBlack / (26 * 66)).toBeGreaterThan(0.8);
    expect(holeInBlack).toBeGreaterThan(0);
    expect(rightPaper / (26 * 66)).toBeGreaterThan(0.9);
  });
});

describe('新增符号：丝网海报的短竖纹与叠圈', () => {
  const c = (id: GlyphId) => glyphCoverage(GLYPH_CODE[id]);

  it('两种都在符号库里、接在老的 67 个后面，老符号编码不变；短竖纹的墨量在双竖与贯穿竖纹之间', () => {
    for (const id of ['comb', 'ringpair'] as GlyphId[]) {
      expect(GLYPH_CODE[id], id).toBeGreaterThanOrEqual(67);
      expect(GLYPHS.find((g) => g.id === id)?.desc, id).toBeTruthy();
    }
    // 老的 67 个编码不动：新的两个接在半块后面
    expect(GLYPH_CODE.stripes).toBe(59);
    expect(GLYPH_CODE.rook).toBe(61);
    expect(GLYPH_CODE.comb).toBe(67);
    expect(GLYPH_CODE.ringpair).toBe(68);
    // 三道短竖：比两道短竖多，比三道贯穿的竖纹少
    expect(c('comb')).toBeGreaterThan(c('pipes'));
    expect(c('comb')).toBeLessThan(c('stripes'));
    // 叠圈是两个缩小的圆圈：比一道竖线多，比实心圆点少
    expect(c('ringpair')).toBeGreaterThan(c('bar'));
    expect(c('ringpair')).toBeLessThan(c('dot'));
  });

  it('渲染：短竖纹三道竖线上下留缝、不与邻格相连（贯穿的竖纹整列到底）；叠圈是左右错开的两个圆圈，横的比竖的宽', () => {
    // 12px 格、两格竖排：一列上既有墨也有纸——上下邻格之间断开
    const inCol = (img: { width: number; data: Uint8ClampedArray }, x: number, h: number) => {
      let ink = 0;
      for (let y = 0; y < h; y++) if (px(img, x, y)[0] < 128) ink++;
      return ink;
    };
    // 一行上有几段墨：三道竖线就是三段
    const runs = (img: { width: number; data: Uint8ClampedArray }, y: number, w: number) => {
      let n = 0;
      let prev = false;
      for (let x = 0; x < w; x++) {
        const ink = px(img, x, y)[0] < 128;
        if (ink && !prev) n++;
        prev = ink;
      }
      return n;
    };
    const comb = renderHalftone(buildGlyphScreen(flatSource(12, 24, 0.5), custom(['comb', 'comb'])));
    const stripes = renderHalftone(buildGlyphScreen(flatSource(12, 24, 0.5), custom(['stripes', 'stripes'])));
    // 中间那道所在的列：竖纹整列到底，短竖纹留出横缝
    expect(inCol(stripes, 6, 24)).toBe(24);
    expect(inCol(comb, 6, 24)).toBeGreaterThan(0);
    expect(inCol(comb, 6, 24)).toBeLessThan(24);
    // 有墨的那一行上是三段，与竖纹一样的三道间距
    expect(runs(comb, 1, 12)).toBe(3);
    expect(runs(stripes, 1, 12)).toBe(3);

    // 叠圈：两个圆心在 x = ±0.4r、半径 0.62r，圆周相交——横向铺到 1.02r，纵向只到 0.62r
    const r = 6;
    const hw = 0.72;
    const d = (x: number, y: number) => glyphDistance(GLYPH_CODE.ringpair, x, y, r, hw, 6.5, 6.5);
    // 左右两圈的外缘是墨，两个圆心是纸（描边不是实心）
    expect(d(-1.02 * r + hw, 0)).toBeLessThan(0);
    expect(d(1.02 * r - hw, 0)).toBeLessThan(0);
    expect(d(-0.4 * r, 0)).toBeGreaterThan(0);
    expect(d(0.4 * r, 0)).toBeGreaterThan(0);
    // 横向比纵向铺得远
    const reach = (dir: 'x' | 'y') => {
      let far = 0;
      for (let t = 0; t <= 2 * r; t += 0.1) if ((dir === 'x' ? d(t, 0) : d(0, t)) < 0) far = t;
      return far;
    };
    expect(reach('x')).toBeGreaterThan(reach('y'));
    // 出了两圈的范围就没墨了
    expect(d(1.02 * r + hw + 0.5, 0)).toBeGreaterThan(0);

    // SVG：短竖纹出三条 <line>，叠圈出两个描边 <circle>
    const combSvg = halftoneToSvg(buildGlyphScreen(flatSource(12, 12, 0.5), custom(['comb', 'comb'])));
    expect((combSvg.match(/<line /g) ?? []).length).toBe(3);
    const pairSvg = halftoneToSvg(buildGlyphScreen(flatSource(12, 12, 0.5), custom(['ringpair', 'ringpair'])));
    expect((pairSvg.match(/<circle [^>]*fill="none"/g) ?? []).length).toBe(2);
  });

  it('Riso Signal 预设：8 阶自定义序列黑色占 6 阶，第 3 阶橙、第 4 阶绿；米白纸不反相，渲染后三色都在且黑最多', () => {
    const p = builtinPresetParams(findBuiltinPreset('glyph-riso')!);
    expect(p['style.type']).toBe('glyph');
    expect(p['glyph.ramp']).toBe('custom');
    expect(p['glyph.levels']).toBe(8);
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((k) => p[glyphShapeId(k)])).toEqual(['blank', 'pip', 'tri', 'dot', 'ring', 'ringpair', 'comb', 'dot']);
    expect(p['glyph.colorMode']).toBe('levels');
    // 只有第 3 / 4 阶是彩色，其余六阶都是黑
    expect(p[glyphColorId(3)]).toBe('#F0562C');
    expect(p[glyphColorId(4)]).toBe('#3FAF6B');
    for (const k of [1, 2, 5, 6, 7, 8]) expect(p[glyphColorId(k)], `第 ${k} 阶`).toBe('#1A1A1A');
    expect(p['glyph.paper']).toBe('#EDEAE3');
    expect(p['tone.invert']).toBe(false);
    // 亮部缩小：橙三角小、暗处的黑圆点满格
    expect(Number(p['glyph.taper'])).toBeGreaterThan(0);
    // 最暗一阶的圆点刚好挨上而不糊成一团
    expect(Number(p['glyph.size'])).toBeLessThan(100);
    // 纸纹：胶片颗粒
    expect(String(p['effects.stack'])).toContain('grain');

    // 源图与画布同尺寸的灰度渐变：左黑右白
    const out = renderImage(makeFrame(216, 108, (x) => [Math.round((x / 215) * 255), Math.round((x / 215) * 255), Math.round((x / 215) * 255)]), {
      ...p,
      'canvas.width': 216,
      'canvas.height': 108,
    });
    expect(out.width).toBe(216);
    let leftInk = 0;
    let rightInk = 0;
    let green = 0;
    let orange = 0;
    let black = 0;
    for (let y = 0; y < 108; y++) {
      for (let x = 0; x < 216; x++) {
        const [r, g, b] = px(out, x, y);
        // 颗粒会把纸色抖开一点，放宽到 24
        const paperish = r > 200 && g > 200 && b > 200;
        if (x < 54 && !paperish) leftInk++;
        if (x >= 162 && !paperish) rightInk++;
        if (g > 120 && r < 120 && b < 140) green++;
        if (r > 170 && g > 40 && g < 140 && b < 110) orange++;
        if (r < 70 && g < 70 && b < 70) black++;
      }
    }
    // 浅底深墨：左（暗）边墨多，右（亮）边几乎是纸
    expect(leftInk).toBeGreaterThan(rightInk);
    // 三种颜色都上了画，黑色是主色
    expect(green).toBeGreaterThan(0);
    expect(orange).toBeGreaterThan(0);
    expect(black).toBeGreaterThan(green + orange);
  });
});

describe('新增符号：几何系统的小方点、杉树与小屋', () => {
  const NEW: GlyphId[] = ['tinysquare', 'pillar', 'fir', 'hut'];
  const c = (id: GlyphId) => glyphCoverage(GLYPH_CODE[id]);

  it('4 种都在符号库里且排在老的 79 个后面，编码不变；墨量关系：小方点最少，竖板与横板一样多，杉树比实心三角略少、小屋比杉树多', () => {
    for (const id of NEW) {
      expect(GLYPH_CODE[id], id).toBeGreaterThanOrEqual(79);
      expect(GLYPHS.find((g) => g.id === id)?.desc, id).toBeTruthy();
    }
    expect(c('tinysquare')).toBeLessThan(c('square'));
    expect(c('tinysquare')).toBeLessThan(c('pip'));
    // 竖板就是横板转 90°，墨量一样
    expect(c('pillar')).toBeCloseTo(c('slab'), 2);
    // 杉树是收了腰、上层又窄的两片三角，比一整个实心三角略少；空心的三角框自然更少
    expect(c('fir')).toBeLessThan(c('tri'));
    expect(c('fir')).toBeGreaterThan(c('triline'));
    expect(c('hut')).toBeGreaterThan(c('fir'));
    expect(c('hut')).toBeLessThan(c('square'));
  });

  it('渲染：竖板上下接成一道长条，小方点四周留白，杉树两层之间收一道腰、小屋屋檐探出身子', () => {
    // 12px 格、三格上下排：竖板铺满整列，格间接缝也是实的
    const pillar = renderHalftone(buildGlyphScreen(flatSource(12, 36, 0.5), custom(['pillar', 'pillar'])));
    for (const y of [0, 6, 11, 12, 18, 23, 24, 30, 35]) expect(px(pillar, 6, y), `y=${y}`).toEqual([0, 0, 0]);
    expect(px(pillar, 0, 6)).toEqual([255, 255, 255]);
    // 小方点：格心是墨，四周留白
    const tiny = renderHalftone(buildGlyphScreen(flatSource(12, 12, 0.5), custom(['tinysquare', 'tinysquare'])));
    expect(px(tiny, 6, 6)).toEqual([0, 0, 0]);
    expect(px(tiny, 1, 6)).toEqual([255, 255, 255]);
    expect(px(tiny, 6, 1)).toEqual([255, 255, 255]);
    const inkRow = (f: { width: number; data: Uint8ClampedArray }, y: number) => {
      let n = 0;
      for (let x = 0; x < f.width; x++) if (px(f, x, y)[0] < 128) n++;
      return n;
    };
    // 杉树：上层的底比下层的顶宽，两层之间收一道腰，再往下一路变宽
    const fir = renderHalftone(buildGlyphScreen(flatSource(12, 12, 0.5), custom(['fir', 'fir'])));
    expect(inkRow(fir, 4)).toBeGreaterThan(inkRow(fir, 5));
    expect(inkRow(fir, 10)).toBeGreaterThan(inkRow(fir, 4));
    // 小屋：屋檐那一行比身子宽，身子往下一样宽
    const hut = renderHalftone(buildGlyphScreen(flatSource(12, 12, 0.5), custom(['hut', 'hut'])));
    expect(inkRow(hut, 4)).toBeGreaterThan(inkRow(hut, 6));
    expect(inkRow(hut, 6)).toBe(inkRow(hut, 10));
  });

  it('SVG：小方点与竖板出 <rect>，杉树两个 <polygon>，小屋一个 <polygon> 加一个 <rect>', () => {
    const pillar = halftoneToSvg(buildGlyphScreen(flatSource(12, 12, 0.5), custom(['pillar', 'pillar'])));
    // 铺底一个 + 一条竖板
    expect((pillar.match(/<rect /g) ?? []).length).toBe(2);
    const tiny = halftoneToSvg(buildGlyphScreen(flatSource(12, 12, 0.5), custom(['tinysquare', 'tinysquare'])));
    expect((tiny.match(/<rect /g) ?? []).length).toBe(2);
    const fir = halftoneToSvg(buildGlyphScreen(flatSource(12, 12, 0.5), custom(['fir', 'fir'])));
    expect((fir.match(/<polygon /g) ?? []).length).toBe(2);
    const hut = halftoneToSvg(buildGlyphScreen(flatSource(12, 12, 0.5), custom(['hut', 'hut'])));
    expect((hut.match(/<polygon /g) ?? []).length).toBe(1);
    expect((hut.match(/<rect /g) ?? []).length).toBe(2);
  });

  it('Shape System 预设：8 阶平涂几何，小方点、粉圆、橙三角、绿杉树、蓝小屋与横板到砖红实心方，奶白纸不反相，亮部缩小拉开大小差，末尾叠一层纸纹颗粒', () => {
    const p = builtinPresetParams(findBuiltinPreset('glyph-system')!);
    expect(p['style.type']).toBe('glyph');
    expect(p['glyph.ramp']).toBe('custom');
    expect(p['glyph.levels']).toBe(8);
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((k) => p[glyphShapeId(k)])).toEqual(['blank', 'tinysquare', 'dot', 'tri', 'fir', 'hut', 'slab', 'square']);
    expect(p['glyph.colorMode']).toBe('levels');
    expect([2, 3, 4, 5, 6, 7, 8].map((k) => p[glyphColorId(k)])).toEqual(['#EF6C1F', '#F3BAD0', '#EF6C1F', '#17643F', '#4A79CE', '#4A79CE', '#9C6161']);
    expect(p['glyph.paper']).toBe('#EDE9E2');
    // 浅纸深墨，不反相
    expect(p['tone.invert']).toBe(false);
    // 亮部缩小到最暗一阶的一半不到，同一张画里既有小方点又有整块的色块
    const sizes = levelSizes(Number(p['glyph.size']) / 100, Number(p['glyph.taper']) / 100, 8);
    expect(sizes[0]).toBeLessThan(sizes[7] / 2);
    // 符号大于一格：暗部的方块之间只剩一道纸色细缝
    expect(Number(p['glyph.size'])).toBeGreaterThan(100);
    // 纸纹：末尾一层轻颗粒
    const stack = parseStack(p['effects.stack']);
    expect(stack.map((e) => e.type)).toEqual(['grain']);
    expect(stack[0].enabled).toBe(true);

    // 左黑右白的渐变，源图与画布同尺寸
    const out = renderImage(makeFrame(440, 220, (x) => [Math.round((x / 439) * 255), Math.round((x / 439) * 255), Math.round((x / 439) * 255)]), {
      ...p,
      'canvas.width': 440,
      'canvas.height': 220,
    });
    expect(out.width).toBe(440);
    // 颗粒的振幅远小于色块与纸色的差，离纸色 40 以上才算落了墨
    const paper = hexToRgb('#EDE9E2');
    let leftInk = 0;
    let rightInk = 0;
    let pink = 0;
    let green = 0;
    let blue = 0;
    let brick = 0;
    for (let y = 0; y < 220; y++) {
      for (let x = 0; x < 440; x++) {
        const [r, g, b] = px(out, x, y);
        const ink = Math.max(Math.abs(r - paper[0]), Math.abs(g - paper[1]), Math.abs(b - paper[2])) > 40;
        if (x < 110 && ink) leftInk++;
        if (x >= 330 && ink) rightInk++;
        if (r > 210 && g > 150 && g < 210 && b > 170) pink++;
        if (r < 90 && g > 70 && g < 140 && b < 100) green++;
        if (r < 120 && g > 90 && g < 160 && b > 170) blue++;
        if (r > 120 && r < 190 && g > 60 && g < 120 && b > 60 && b < 120) brick++;
      }
    }
    // 暗的一头是接成片的实心方，亮的一头只有零星的小方点
    expect(leftInk).toBeGreaterThan(rightInk * 5);
    // 一张画里粉、绿、蓝、砖红都在
    for (const [name, count] of [['粉', pink], ['绿', green], ['蓝', blue], ['砖红', brick]] as const) expect(count, name).toBeGreaterThan(200);
  });
});
