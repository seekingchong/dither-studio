import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HATCH,
  Pipeline,
  crossWidths,
  hatchLayers,
  hatchToSvg,
  levelWidths,
  quantizeHatch,
  renderHatch,
  renderImage,
  scaleParamsForPreview,
  type GrayFrame,
  type HatchOptions,
  type LevelFrame,
  type RGBAFrame,
} from '@/engine';
import { PARAM_SCHEMA, defaultParams, getParamDef, isParamVisible } from '@/params';
import { BUILTIN_PRESETS, DEFAULT_PRESET_ID, HATCH_DEFAULT_PRESET_ID, builtinPresetParams, defaultPresetIdFor, findBuiltinPreset, isParamExposed, presetStyle, summarizeParams } from '@/state';
import { makeFrame } from './helpers';

const px = (f: { width: number; data: Uint8ClampedArray }, x: number, y: number) => {
  const i = (y * f.width + x) * 4;
  return [f.data[i], f.data[i + 1], f.data[i + 2]];
};

const inkCount = (f: RGBAFrame, ink: [number, number, number]) => {
  let n = 0;
  for (let i = 0; i < f.data.length; i += 4) if (f.data[i] === ink[0] && f.data[i + 1] === ink[1] && f.data[i + 2] === ink[2]) n++;
  return n;
};

/** 单格：一整块画布就是一个格子，level 为它的暗度档位 */
const cell = (level: number, levels = 2): LevelFrame => ({ width: 1, height: 1, levels, data: new Uint8Array([level]) });

const opts = (patch: Partial<HatchOptions> = {}): HatchOptions => ({ ...DEFAULT_HATCH, ink: [0, 0, 0], paper: [255, 255, 255], ...patch });

describe('排线几何', () => {
  it('45° 方格：弦长是对角线，相邻平行线间距是边长的 1/√2', () => {
    const [layer] = hatchLayers(opts(), 10, 10);
    expect(layer.chord).toBeCloseTo(10 * Math.SQRT2, 5);
    expect(layer.pitch).toBeCloseTo(10 / Math.SQRT2, 5);
    expect(layer.length).toBeCloseTo(10 * Math.SQRT2 * DEFAULT_HATCH.length, 5);
  });

  it('0° 横线：弦长是格子宽，间距是行距——首尾相接的邻居不算旁边的线', () => {
    const [layer] = hatchLayers(opts({ angle: 0 }), 6, 12);
    expect(layer.chord).toBeCloseTo(6, 5);
    expect(layer.pitch).toBeCloseTo(12, 5);
  });

  it('90° 竖线：弦长是格子高，间距是列距', () => {
    const [layer] = hatchLayers(opts({ angle: 90 }), 6, 12);
    expect(layer.chord).toBeCloseTo(12, 5);
    expect(layer.pitch).toBeCloseTo(6, 5);
  });

  it('粗细按档位线性，非零的至少 1px；最细为 0 时最亮档不画', () => {
    const w = levelWidths(4, 0, 1, 12);
    expect([...w].map((v) => Math.round(v * 100) / 100)).toEqual([0, 4, 8, 12]);
    expect(levelWidths(3, 0.02, 1, 10)[0]).toBe(1);
    expect(levelWidths(2, 0.5, 0.5, 10)[0]).toBe(5);
  });

  it('交叉层：暗度过了起点才出现，到最暗档达到最粗', () => {
    expect([...crossWidths(5, 1, 0.5, 10)]).toEqual([0, 0, 0, 5, 10]);
    expect([...crossWidths(3, 1, 1, 10)]).toEqual([0, 0, 0]);
  });

  it('开交叉排线多出一层，方向垂直于主层', () => {
    const layers = hatchLayers(opts({ cross: true }), 10, 10);
    expect(layers).toHaveLength(2);
    expect(layers[0].dx * layers[1].dx + layers[0].dy * layers[1].dy).toBeCloseTo(0, 6);
  });
});

describe('明暗分档', () => {
  it('档位均分，最亮 0、最暗 N-1', () => {
    const gray: GrayFrame = { width: 5, height: 1, data: new Float32Array([1, 0.75, 0.5, 0.25, 0]) };
    expect([...quantizeHatch(gray, 4).data]).toEqual([0, 1, 2, 3, 3]);
    expect([...quantizeHatch(gray, 2).data]).toEqual([0, 0, 1, 1, 1]);
  });

  it('超出 0..1 的亮度夹住', () => {
    const gray: GrayFrame = { width: 2, height: 1, data: new Float32Array([1.4, -0.3]) };
    expect([...quantizeHatch(gray, 6).data]).toEqual([0, 5]);
  });

  it('错行时奇数行在相邻两格之间插值取明暗', () => {
    const gray: GrayFrame = { width: 2, height: 2, data: new Float32Array([1, 0, 1, 0]) };
    expect([...quantizeHatch(gray, 2, 0).data]).toEqual([0, 1, 0, 1]);
    // 奇数行第 0 格取 (1 + 0) / 2 = 0.5 → 暗档
    expect([...quantizeHatch(gray, 2, 0.5).data]).toEqual([0, 1, 1, 1]);
  });
});

describe('renderHatch', () => {
  it('最暗格子：笔画沿对角线穿过格心，远离对角线的角落是纸色', () => {
    const out = renderHatch(cell(1), 20, 20, 20, 20, 0, 0, opts({ length: 1, maxWidth: 0.5 }));
    expect(px(out, 10, 10)).toEqual([0, 0, 0]);
    // 45° 是「/」：右上角在线上，左上角不在
    expect(px(out, 19, 0)).toEqual([0, 0, 0]);
    expect(px(out, 0, 0)).toEqual([255, 255, 255]);
    expect(px(out, 0, 19)).toEqual([0, 0, 0]);
    expect(px(out, 19, 19)).toEqual([255, 255, 255]);
  });

  it('越暗越粗；最细为 0 时最亮格子整格留白', () => {
    const o = opts({ minWidth: 0.1, maxWidth: 0.8 });
    const light = renderHatch(cell(0, 4), 24, 24, 24, 24, 0, 0, o);
    const mid = renderHatch(cell(2, 4), 24, 24, 24, 24, 0, 0, o);
    const dark = renderHatch(cell(3, 4), 24, 24, 24, 24, 0, 0, o);
    const ink: [number, number, number] = [0, 0, 0];
    expect(inkCount(light, ink)).toBeGreaterThan(0);
    expect(inkCount(mid, ink)).toBeGreaterThan(inkCount(light, ink));
    expect(inkCount(dark, ink)).toBeGreaterThan(inkCount(mid, ink));
    const blank = renderHatch(cell(0, 4), 24, 24, 24, 24, 0, 0, opts({ minWidth: 0 }));
    expect(inkCount(blank, [255, 255, 255])).toBe(24 * 24);
  });

  it('前景 / 背景色直接落到像素上', () => {
    const out = renderHatch(cell(1), 20, 20, 20, 20, 0, 0, opts({ ink: [10, 20, 30], paper: [200, 210, 220], length: 1 }));
    expect(px(out, 10, 10)).toEqual([10, 20, 30]);
    expect(px(out, 0, 0)).toEqual([200, 210, 220]);
  });

  it('横向 / 纵向连线穿过格心，在笔画之下', () => {
    const blank = opts({ minWidth: 0, linkWidth: 2, linkColor: [90, 90, 90] });
    const row = renderHatch(cell(0), 20, 20, 20, 20, 0, 0, { ...blank, link: 'row' });
    expect(px(row, 2, 9)).toEqual([90, 90, 90]);
    expect(px(row, 2, 10)).toEqual([90, 90, 90]);
    expect(px(row, 2, 4)).toEqual([255, 255, 255]);
    expect(px(row, 9, 2)).toEqual([255, 255, 255]);
    const col = renderHatch(cell(0), 20, 20, 20, 20, 0, 0, { ...blank, link: 'col' });
    expect(px(col, 9, 2)).toEqual([90, 90, 90]);
    expect(px(col, 4, 2)).toEqual([255, 255, 255]);
    const grid = renderHatch(cell(0), 20, 20, 20, 20, 0, 0, { ...blank, link: 'grid' });
    expect(px(grid, 9, 2)).toEqual([90, 90, 90]);
    expect(px(grid, 2, 9)).toEqual([90, 90, 90]);
    // 有笔画时笔画盖在连线上
    const over = renderHatch(cell(1), 20, 20, 20, 20, 0, 0, { ...blank, link: 'row', length: 1 });
    expect(px(over, 10, 10)).toEqual([0, 0, 0]);
  });

  it('沿斜线连线贯穿整格：在对角线上、不在另一条对角线上', () => {
    const out = renderHatch(cell(0), 20, 20, 20, 20, 0, 0, opts({ minWidth: 0, link: 'stroke', linkWidth: 2, linkColor: [90, 90, 90] }));
    expect(px(out, 10, 9)).toEqual([90, 90, 90]);
    expect(px(out, 19, 0)).toEqual([90, 90, 90]);
    expect(px(out, 0, 0)).toEqual([255, 255, 255]);
  });

  it('交叉排线在最暗格子里再画一条垂直方向的笔画', () => {
    const single = renderHatch(cell(1), 20, 20, 20, 20, 0, 0, opts({ length: 1, maxWidth: 0.5 }));
    const cross = renderHatch(cell(1), 20, 20, 20, 20, 0, 0, opts({ length: 1, maxWidth: 0.5, cross: true, crossStart: 0 }));
    expect(px(single, 0, 0)).toEqual([255, 255, 255]);
    expect(px(cross, 0, 0)).toEqual([0, 0, 0]);
    expect(px(cross, 19, 19)).toEqual([0, 0, 0]);
  });

  it('错行把奇数行的笔画右移', () => {
    const two: LevelFrame = { width: 2, height: 2, levels: 2, data: new Uint8Array([1, 1, 1, 1]) };
    const o = opts({ angle: 90, length: 0.6, maxWidth: 0.3, roundness: 0 });
    const straight = renderHatch(two, 20, 20, 10, 10, 0, 0, o);
    const staggered = renderHatch(two, 20, 20, 10, 10, 0, 0, { ...o, stagger: 0.5 });
    // 第 0 行不动：竖笔画在 x = 5 与 15
    expect(px(straight, 5, 5)).toEqual([0, 0, 0]);
    expect(px(staggered, 5, 5)).toEqual([0, 0, 0]);
    // 第 1 行右移半格：竖笔画挪到 x = 10
    expect(px(straight, 5, 15)).toEqual([0, 0, 0]);
    expect(px(staggered, 5, 15)).toEqual([255, 255, 255]);
    expect(px(staggered, 10, 15)).toEqual([0, 0, 0]);
  });

  it('网格偏移把格子整体挪开', () => {
    const o = opts({ angle: 90, length: 0.6, maxWidth: 0.3, roundness: 0 });
    const a = renderHatch(cell(1), 20, 20, 20, 20, 0, 0, o);
    const b = renderHatch(cell(1), 20, 20, 20, 20, 5, 0, o);
    expect(px(a, 10, 10)).toEqual([0, 0, 0]);
    expect(px(b, 10, 10)).toEqual([255, 255, 255]);
    expect(px(b, 5, 10)).toEqual([0, 0, 0]);
  });

  it('边缘抗锯齿：只在笔画边上出现中间灰，整幅不透明', () => {
    const out = renderHatch(cell(1), 20, 20, 20, 20, 0, 0, opts({ length: 1, maxWidth: 0.5 }));
    let mids = 0;
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i + 3]).toBe(255);
      if (out.data[i] > 0 && out.data[i] < 255) mids++;
    }
    expect(mids).toBeGreaterThan(0);
    expect(mids).toBeLessThan(20 * 20 * 0.3);
  });
});

describe('排线 SVG', () => {
  const two: LevelFrame = { width: 2, height: 1, levels: 2, data: new Uint8Array([0, 1]) };

  it('底色一块矩形，每档一个圆角矩形定义，格子上用 use 摆到笔心', () => {
    const svg = hatchToSvg(two, 20, 10, 10, 10, 0, 0, opts({ minWidth: 0, ink: [0, 0, 0], paper: [217, 217, 217] }));
    expect(svg).toContain('<rect width="20" height="10" fill="#D9D9D9"/>');
    expect(svg).toContain('<rect id="s0-1"');
    expect(svg).not.toContain('id="s0-0"');
    expect(svg.match(/<use /g)).toHaveLength(1);
    expect(svg).toContain('x="15" y="5"');
    expect(svg).toContain('rotate(-45)');
    expect(svg).toContain('<g fill="#000000">');
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('最细大于 0 时最亮格子也有一笔；交叉排线多一层定义', () => {
    const svg = hatchToSvg(two, 20, 10, 10, 10, 0, 0, opts({ minWidth: 0.1, cross: true, crossStart: 0 }));
    expect(svg.match(/<use /g)).toHaveLength(3);
    expect(svg).toContain('id="s1-1"');
    expect(svg).toContain('rotate(-135)');
  });

  it('连线出成 path：横向每行一根，沿斜线每格一段', () => {
    const row = hatchToSvg(two, 20, 10, 10, 10, 0, 0, opts({ link: 'row', linkWidth: 2, linkColor: [90, 90, 90] }));
    expect(row).toContain('stroke="#5A5A5A" stroke-width="2"');
    expect(row).toContain('d="M0 5H20"');
    const along = hatchToSvg(two, 20, 10, 10, 10, 0, 0, opts({ link: 'stroke' }));
    expect(along.match(/M[-\d.]+ [-\d.]+L/g)).toHaveLength(2);
    expect(hatchToSvg(two, 20, 10, 10, 10, 0, 0, opts())).not.toContain('stroke-width');
  });

  it('格子太多就报错，让人调大间距', () => {
    const huge: LevelFrame = { width: 1000, height: 400, levels: 2, data: new Uint8Array(400_000) };
    expect(() => hatchToSvg(huge, 1000, 400, 1, 1, 0, 0, opts())).toThrow(/间距/);
  });
});

describe('流水线 · 排线', () => {
  const source = () => makeFrame(64, 40, (x) => [Math.round((x / 63) * 255), Math.round((x / 63) * 255), Math.round((x / 63) * 255)]);
  const params = (patch: Record<string, unknown> = {}) => ({ ...defaultParams(), 'style.type': 'hatch', 'canvas.width': 64, 'canvas.height': 40, 'hatch.spacingX': 8, 'hatch.spacingY': 8, ...patch });

  it('输出画布尺寸、全部不透明，颜色只在前景与背景之间', () => {
    const out = renderImage(source(), params({ 'hatch.ink': '#000000', 'hatch.paper': '#FFFFFF' }));
    expect(out.width).toBe(64);
    expect(out.height).toBe(40);
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i + 3]).toBe(255);
      expect(out.data[i]).toBe(out.data[i + 1]);
      expect(out.data[i]).toBe(out.data[i + 2]);
    }
  });

  it('暗的一侧墨多，亮的一侧墨少', () => {
    const out = renderImage(source(), params({ 'hatch.ink': '#000000', 'hatch.paper': '#FFFFFF', 'hatch.minWidth': 0 }));
    const inkIn = (x0: number, x1: number) => {
      let n = 0;
      for (let y = 0; y < 40; y++) for (let x = x0; x < x1; x++) if (out.data[(y * 64 + x) * 4] < 128) n++;
      return n;
    };
    expect(inkIn(0, 16)).toBeGreaterThan(inkIn(48, 64) * 3);
  });

  it('改笔画参数只重画，改色阶重新分档，改影调从影调起重算', () => {
    const p = new Pipeline();
    const src = source();
    p.run(src, 'a', params());
    expect(p.lastStats.recomputed).toContain('quantize:hatch');
    expect(p.lastStats.recomputed).toContain('render:hatch');
    expect(p.lastStats.recomputed.some((s) => s.startsWith('dither:'))).toBe(false);
    p.run(src, 'a', params({ 'hatch.angle': 60 }));
    expect(p.lastStats.recomputed).toEqual(['render:hatch']);
    p.run(src, 'a', params({ 'hatch.angle': 60, 'hatch.levels': 4 }));
    expect(p.lastStats.recomputed).toEqual(['quantize:hatch', 'render:hatch']);
    p.run(src, 'a', params({ 'hatch.angle': 60, 'hatch.levels': 4, 'tone.brightness': 20 }));
    expect(p.lastStats.recomputed).toEqual(['tone', 'gray', 'quantize:hatch', 'render:hatch']);
    p.run(src, 'a', params({ 'hatch.angle': 60, 'hatch.levels': 4, 'tone.brightness': 20 }));
    expect(p.lastStats.recomputed).toEqual([]);
  });

  it('影调调整对排线生效：提亮后墨更少，反相后明暗对调', () => {
    const base = params({ 'hatch.ink': '#000000', 'hatch.paper': '#FFFFFF', 'hatch.minWidth': 0 });
    const dark = (out: RGBAFrame) => {
      let n = 0;
      for (let i = 0; i < out.data.length; i += 4) if (out.data[i] < 128) n++;
      return n;
    };
    const normal = renderImage(source(), base);
    const bright = renderImage(source(), { ...base, 'tone.brightness': 60 });
    expect(dark(bright)).toBeLessThan(dark(normal));
    const inverted = renderImage(source(), { ...base, 'tone.invert': true });
    const left = (out: RGBAFrame) => {
      let n = 0;
      for (let y = 0; y < 40; y++) for (let x = 0; x < 16; x++) if (out.data[(y * 64 + x) * 4] < 128) n++;
      return n;
    };
    expect(left(inverted)).toBeLessThan(left(normal));
  });

  it('排线状态只在排线风格下存在，抖动风格不受影响', () => {
    const p = new Pipeline();
    p.run(source(), 'a', params());
    expect(p.currentHatch).toBeDefined();
    expect(p.currentHatch!.sx).toBe(8);
    expect(p.currentLevels!.levels).toBe(6);
    p.run(source(), 'a', { ...params(), 'style.type': 'dither' });
    expect(p.currentHatch).toBeUndefined();
    expect(p.lastStats.recomputed.some((s) => s.startsWith('dither:'))).toBe(true);
  });

  it('横纵间距不同就是长方格', () => {
    const p = new Pipeline();
    p.run(source(), 'a', params({ 'hatch.spacingX': 8, 'hatch.spacingY': 20 }));
    expect(p.currentLevels!.width).toBe(8);
    expect(p.currentLevels!.height).toBe(2);
  });

  it('预览降分辨率按间距缩，百分比参数不动', () => {
    const { params: scaled, scale } = scaleParamsForPreview(params({ 'hatch.spacingX': 14, 'hatch.spacingY': 14, 'canvas.width': 1000, 'canvas.height': 600, 'hatch.linkWidth': 2 }), 0.5);
    expect(scale).toBe(0.5);
    expect(scaled['hatch.spacingX']).toBe(7);
    expect(scaled['hatch.spacingY']).toBe(7);
    expect(scaled['canvas.width']).toBe(500);
    expect(scaled['hatch.linkWidth']).toBe(1);
    expect(scaled['hatch.length']).toBe(80);
    expect(scaled['pixel.size']).toBe(4);
  });
});

describe('风格与参数可见性', () => {
  it('抖动 / 颜色 / 网格只在抖动下可见，排线只在排线下可见，影调两边都有', () => {
    const dither = defaultParams();
    const hatch = { ...defaultParams(), 'style.type': 'hatch' };
    expect(dither['style.type']).toBe('dither');
    expect(isParamVisible(getParamDef('dither.family'), dither)).toBe(true);
    expect(isParamVisible(getParamDef('dither.family'), hatch)).toBe(false);
    expect(isParamVisible(getParamDef('color.mode'), hatch)).toBe(false);
    expect(isParamVisible(getParamDef('grid.dot'), hatch)).toBe(false);
    expect(isParamVisible(getParamDef('pixel.size'), hatch)).toBe(false);
    expect(isParamVisible(getParamDef('tone.linear'), hatch)).toBe(false);
    expect(isParamVisible(getParamDef('hatch.angle'), dither)).toBe(false);
    expect(isParamVisible(getParamDef('hatch.angle'), hatch)).toBe(true);
    expect(isParamVisible(getParamDef('hatch.linkWidth'), hatch)).toBe(false);
    expect(isParamVisible(getParamDef('hatch.linkWidth'), { ...hatch, 'hatch.link': 'row' })).toBe(true);
    expect(isParamVisible(getParamDef('hatch.crossStart'), { ...hatch, 'hatch.cross': true })).toBe(true);
    for (const id of ['tone.brightness', 'tone.contrast', 'tone.invert', 'tone.bg.enabled', 'pixel.method', 'effects.stack']) {
      expect(isParamVisible(getParamDef(id), dither), id).toBe(true);
      expect(isParamVisible(getParamDef(id), hatch), id).toBe(true);
    }
    // 排线分组的每个参数都在排线下可见（除了带自己条件的）
    for (const def of PARAM_SCHEMA) if (def.group === 'hatch' && !def.visibleWhen) expect(isParamVisible(def, hatch), def.id).toBe(true);
  });

  it('排线预设：风格是排线、露出排线分组，默认那套与 schema 默认值一致', () => {
    const hatchPresets = BUILTIN_PRESETS.filter((p) => presetStyle(p.params) === 'hatch');
    expect(hatchPresets.length).toBeGreaterThanOrEqual(8);
    expect(hatchPresets[0].id).toBe(HATCH_DEFAULT_PRESET_ID);
    for (const preset of hatchPresets) {
      expect(isParamExposed(getParamDef('hatch.angle'), preset.exposes), preset.id).toBe(true);
      expect(isParamExposed(getParamDef('hatch.ink'), preset.exposes), preset.id).toBe(true);
      expect(isParamExposed(getParamDef('tone.brightness'), preset.exposes), preset.id).toBe(true);
    }
    const classic = builtinPresetParams(findBuiltinPreset(HATCH_DEFAULT_PRESET_ID)!);
    const defaults = defaultParams();
    for (const def of PARAM_SCHEMA) if (def.group === 'hatch') expect(classic[def.id], def.id).toBe(defaults[def.id]);
    expect(defaultPresetIdFor('hatch')).toBe(HATCH_DEFAULT_PRESET_ID);
    expect(defaultPresetIdFor('dither')).toBe(DEFAULT_PRESET_ID);
    expect(presetStyle(findBuiltinPreset('gameboy')!.params)).toBe('dither');
    expect(summarizeParams(classic)).toBe('排线 · 45° · 间距 14×14 · 6 级');
  });
});
