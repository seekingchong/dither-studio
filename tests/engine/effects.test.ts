import { describe, expect, it } from 'vitest';
import { defaultParams } from '@/params';
import {
  BLOCK_MAX_COUNT,
  BLOCK_PALETTES,
  BLOCK_RATIOS,
  EFFECT_DEFS,
  FONT_COLS,
  FONT_ROWS,
  LEVEL_OUTLINE_ID,
  Pipeline,
  appendSvgFragment,
  applyEffects,
  coerceEffectParams,
  defaultEffectInstance,
  drawableChars,
  editBlockColor,
  effectsSvgFragment,
  getEffectDef,
  glyphOf,
  gridUnitOf,
  hasGlyph,
  isEffectParamVisible,
  layoutBlocks,
  levelEnabled,
  outlineMask,
  parseStack,
  renderImage,
  resolveBlockColors,
  serializeStack,
  styleLevelCount,
  toPipelineOptions,
  toneLevel,
  toneMapOf,
  type EffectParamValues,
  type RGBAFrame,
} from '@/engine';
import { makeFrame } from './helpers';

const luma = (d: Uint8ClampedArray, i: number) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
const mean = (f: RGBAFrame) => {
  let s = 0;
  for (let i = 0; i < f.data.length; i += 4) s += luma(f.data, i);
  return s / (f.data.length / 4);
};
const variance = (f: RGBAFrame) => {
  const m = mean(f);
  let s = 0;
  for (let i = 0; i < f.data.length; i += 4) s += (luma(f.data, i) - m) ** 2;
  return s / (f.data.length / 4);
};
const differs = (a: RGBAFrame, b: RGBAFrame) => {
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return true;
  return false;
};

function gradient(): RGBAFrame {
  return makeFrame(64, 48, (x, y) => [Math.round((x / 63) * 255), Math.round((y / 47) * 255), 128]);
}

describe('特效栈解析', () => {
  it('解析、收敛、序列化往返', () => {
    const stack = parseStack('[{"type":"grain","params":{"amount":500,"size":"2","bogus":1}},{"type":"nope"},{"type":"wave","enabled":false}]');
    expect(stack.length).toBe(2);
    expect(stack[0].params.amount).toBe(100);
    expect(stack[0].params.size).toBe(2);
    expect('bogus' in stack[0].params).toBe(false);
    expect(stack[1].enabled).toBe(false);
    expect(parseStack(serializeStack(stack))).toEqual(stack);
    expect(parseStack('')).toEqual([]);
    expect(parseStack('{bad')).toEqual([]);
    expect(serializeStack([])).toBe('');
  });
  it('默认实例包含全部参数默认值', () => {
    for (const def of EFFECT_DEFS) {
      const inst = defaultEffectInstance(def.id)!;
      expect(inst.enabled).toBe(true);
      for (const p of def.params) expect(inst.params[p.id]).toBe(p.default);
    }
    expect(defaultEffectInstance('nope')).toBeNull();
    expect(coerceEffectParams(getEffectDef('pixelSort')!, { direction: 'diag' }).direction).toBe('row');
  });
});

describe('各特效', () => {
  const src = gradient();

  it('每个特效保持尺寸、alpha 为 255，且确定性', () => {
    for (const def of EFFECT_DEFS) {
      const inst = defaultEffectInstance(def.id)!;
      const a = applyEffects(src, [inst]);
      const b = applyEffects(src, [inst]);
      expect(a.width).toBe(src.width);
      expect(a.height).toBe(src.height);
      expect(a.data).toEqual(b.data);
      for (let i = 3; i < a.data.length; i += 4) expect(a.data[i]).toBe(255);
      // 源帧不被修改
      expect(src.data).toEqual(gradient().data);
    }
  });

  it('扫描线：每 period 行的最后一行变暗', () => {
    const out = getEffectDef('scanlines')!.apply(src, { period: 3, darkness: 50, phosphor: 0, curvature: 0 });
    const row = (y: number) => luma(out.data, (y * 64 + 40) * 4);
    expect(row(2)).toBeLessThan(row(1) * 0.7);
    expect(row(1)).toBeCloseTo(luma(src.data, (1 * 64 + 40) * 4), 0);
    const phos = getEffectDef('scanlines')!.apply(src, { period: 3, darkness: 0, phosphor: 100, curvature: 0 });
    const i = (10 * 64 + 30) * 4;
    expect(phos.data[i + 1]).toBeLessThan(src.data[i + 1]);
  });

  it('颗粒按强度增加方差，种子不同结果不同', () => {
    const flat = makeFrame(32, 32, () => [128, 128, 128]);
    const g = getEffectDef('grain')!;
    const a = g.apply(flat, { amount: 40, size: 1, color: false, seed: 1 });
    const b = g.apply(flat, { amount: 40, size: 1, color: false, seed: 2 });
    expect(variance(a)).toBeGreaterThan(20);
    expect(differs(a, b)).toBe(true);
    expect(Math.abs(mean(a) - 128)).toBeLessThan(6);
    const c = g.apply(flat, { amount: 40, size: 1, color: true, seed: 1 });
    expect(c.data[0] !== c.data[1] || c.data[1] !== c.data[2]).toBe(true);
  });

  it('JPEG 损坏与块位移只改一部分像素', () => {
    for (const [id, params] of [
      ['jpeg', { block: 8, amount: 30, shift: 50, seed: 3 }],
      ['blockShift', { count: 4, maxShift: 20, height: 8, seed: 3 }],
      ['rowShift', { probability: 30, maxShift: 10, band: 2, rgbSplit: 0, seed: 3 }],
    ] as const) {
      const out = getEffectDef(id)!.apply(src, params);
      let changed = 0;
      for (let i = 0; i < out.data.length; i += 4) if (out.data[i] !== src.data[i] || out.data[i + 1] !== src.data[i + 1]) changed++;
      const ratio = changed / (out.data.length / 4);
      expect(ratio).toBeGreaterThan(0.02);
      expect(ratio).toBeLessThan(0.95);
    }
  });

  it('像素排序让区间内的连续像素按亮度非降', () => {
    const noisy = makeFrame(40, 4, (x, y) => {
      const v = 60 + ((x * 37 + y * 11) % 120);
      return [v, v, v];
    });
    const out = getEffectDef('pixelSort')!.apply(noisy, { direction: 'row', low: 0, high: 100, reverse: false });
    for (let y = 0; y < 4; y++) {
      for (let x = 1; x < 40; x++) {
        expect(luma(out.data, (y * 40 + x) * 4)).toBeGreaterThanOrEqual(luma(out.data, (y * 40 + x - 1) * 4) - 0.01);
      }
    }
    const rev = getEffectDef('pixelSort')!.apply(noisy, { direction: 'row', low: 0, high: 100, reverse: true });
    expect(luma(rev.data, 0)).toBeGreaterThan(luma(rev.data, 39 * 4));
    // 阈值之外的像素不动
    const partial = getEffectDef('pixelSort')!.apply(noisy, { direction: 'col', low: 90, high: 95, reverse: false });
    expect(partial.width).toBe(40);
  });

  it('波形按正弦横向位移，桶形保持中心像素', () => {
    const stripes = makeFrame(64, 48, (x) => (x % 8 < 4 ? [0, 0, 0] : [255, 255, 255]));
    const w = getEffectDef('wave')!.apply(stripes, { amplitude: 4, wavelength: 48, phase: 90, axis: 'x' });
    // 相位 90° 时第 0 行位移最大（sin = 1 → 采样 x+4），条纹整体平移半周期
    expect(w.data[(0 * 64 + 1) * 4]).toBe(255);
    const zero = getEffectDef('wave')!.apply(stripes, { amplitude: 0, wavelength: 48, phase: 0, axis: 'x' });
    expect(zero.data).toEqual(stripes.data);
    const bar = getEffectDef('barrel')!.apply(src, { amount: 60 });
    const c = (24 * 64 + 32) * 4;
    expect(Math.abs(bar.data[c] - src.data[c])).toBeLessThan(6);
    expect(differs(bar, src)).toBe(true);
    // 桶形：右上角像素采样自更靠内的位置，红色（随 x 增长）变小
    const corner = (0 * 64 + 63) * 4;
    expect(bar.data[corner]).toBeLessThan(src.data[corner]);
  });

  it('散射只在半径内搬动像素', () => {
    const out = getEffectDef('scatter')!.apply(src, { radius: 3, seed: 5 });
    expect(differs(out, src)).toBe(true);
    // 左上角像素只能来自附近，红色通道（随 x 增长）不会跳到很远
    expect(out.data[0]).toBeLessThan(40);
  });

  it('栈顺序影响结果，禁用的实例被跳过', () => {
    const a = applyEffects(src, [defaultEffectInstance('scanlines')!, defaultEffectInstance('wave')!]);
    const b = applyEffects(src, [defaultEffectInstance('wave')!, defaultEffectInstance('scanlines')!]);
    expect(differs(a, b)).toBe(true);
    const off = applyEffects(src, [{ ...defaultEffectInstance('wave')!, enabled: false }]);
    expect(off).toBe(src);
  });
});

describe('流水线特效阶段', () => {
  it('特效栈变化只重算 effects，输出与无特效不同', () => {
    const p = new Pipeline();
    const source = makeFrame(64, 40, (x) => [x * 4, x * 4, x * 4]);
    const params = { ...defaultParams(), 'canvas.width': 32, 'canvas.height': 20, 'pixel.size': 2 };
    const plain = p.run(source, 'a', params);
    const stack = serializeStack([defaultEffectInstance('scanlines')!]);
    const fx = p.run(source, 'a', { ...params, 'effects.stack': stack });
    expect(p.lastStats.recomputed).toEqual(['effects']);
    expect(differs(plain, fx)).toBe(true);
    p.run(source, 'a', { ...params, 'effects.stack': stack });
    expect(p.lastStats.recomputed).toEqual([]);
  });
});

describe('灰度块描边', () => {
  const def = getEffectDef(LEVEL_OUTLINE_ID)!;
  const RED: [number, number, number] = [255, 0, 0];
  const base = { levels: 2, width: 2, color: '#FF0000', join: 'square', fill: 'keep', paper: '#FFFFFF', mask: '' };
  /** 左半黑、右半白，分界在 x = 8 */
  const halves = () => makeFrame(16, 8, (x) => (x < 8 ? [0, 0, 0] : [255, 255, 255]));
  const px = (f: RGBAFrame, x: number, y: number) => Array.from(f.data.subarray((y * f.width + x) * 4, (y * f.width + x) * 4 + 3));
  const isRed = (f: RGBAFrame, x: number, y: number) => px(f, x, y).join() === RED.join();
  const redCount = (f: RGBAFrame) => {
    let c = 0;
    for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) if (isRed(f, x, y)) c++;
    return c;
  };

  it('分阶：抖动 / 网点四舍五入到最近一级，排线 / 符号等宽分档，0 是最亮', () => {
    expect(toneLevel(1, 8, 'round')).toBe(0);
    expect(toneLevel(0, 8, 'round')).toBe(7);
    expect(toneLevel(0.9, 8, 'round')).toBe(1); // round(0.9 × 7) = 6 → 7 − 6
    expect(toneLevel(0.9, 8, 'floor')).toBe(0); // floor(0.1 × 8) = 0
    expect(toneLevel(0.5, 2, 'round')).toBe(0);
    expect(toneLevel(0.49, 2, 'round')).toBe(1);
    expect(toneLevel(-1, 4, 'floor')).toBe(3);
    expect(toneLevel(2, 4, 'floor')).toBe(0);
    expect(levelEnabled('', 5)).toBe(true);
    expect(levelEnabled('10', 1)).toBe(false);
    expect(levelEnabled('10', 2)).toBe(true);
  });

  it('参数收敛：颜色只认 #RRGGBB，开关串只留 0 / 1', () => {
    const p = coerceEffectParams(def, { color: 'red', paper: '#abcdef', mask: 'x1y0!', levels: 99, width: 0 });
    expect(p.color).toBe('#000000');
    expect(p.paper).toBe('#ABCDEF');
    expect(p.mask).toBe('10');
    expect(p.levels).toBe(16);
    expect(p.width).toBe(1);
    expect(coerceEffectParams(def, { mask: 7 }).mask).toBe('');
  });

  it('没有上下文时按成品亮度分阶，沿分界描线，粗细与颜色照参数', () => {
    const src = halves();
    const out = def.apply(src, base);
    for (let y = 0; y < 8; y++) {
      expect(isRed(out, 7, y)).toBe(true);
      expect(isRed(out, 8, y)).toBe(true);
      expect(px(out, 6, y)).toEqual([0, 0, 0]);
      expect(px(out, 9, y)).toEqual([255, 255, 255]);
    }
    expect(redCount(out)).toBe(16);
    // 源帧不动
    expect(src.data).toEqual(halves().data);
    // 粗细 1 只占分界左侧一列，粗细 4 两侧各两列
    const thin = def.apply(src, { ...base, width: 1 });
    expect(redCount(thin)).toBe(8);
    expect(isRed(thin, 7, 0)).toBe(true);
    const thick = def.apply(src, { ...base, width: 4 });
    expect(redCount(thick)).toBe(32);
    expect(isRed(thick, 6, 0)).toBe(true);
    expect(isRed(thick, 9, 0)).toBe(true);
    expect(isRed(thick, 5, 0)).toBe(false);
    // 颜色
    const blue = def.apply(src, { ...base, color: '#0000FF' });
    expect(px(blue, 7, 0)).toEqual([0, 0, 255]);
  });

  it('每阶开关：两阶都关就没有线，关掉一阶另一阶的轮廓还在', () => {
    const src = halves();
    expect(def.apply(src, { ...base, mask: '00' }).data).toEqual(src.data);
    expect(redCount(def.apply(src, { ...base, mask: '01' }))).toBe(16);
    expect(redCount(def.apply(src, { ...base, mask: '10' }))).toBe(16);
    expect(redCount(def.apply(src, { ...base, mask: '11' }))).toBe(16);
  });

  it('只留描边：画面换成底色，线照描', () => {
    const out = def.apply(halves(), { ...base, fill: 'flat', paper: '#00FF00' });
    expect(px(out, 0, 0)).toEqual([0, 255, 0]);
    expect(px(out, 15, 7)).toEqual([0, 255, 0]);
    expect(isRed(out, 7, 3)).toBe(true);
    expect(isRed(out, 8, 3)).toBe(true);
  });

  it('转角：圆角削掉外角像素，方角把角拼满', () => {
    // 白底上一个 8×8 的黑方块，左上角在 (4, 4)
    const src = makeFrame(16, 16, (x, y) => (x >= 4 && x < 12 && y >= 4 && y < 12 ? [0, 0, 0] : [255, 255, 255]));
    const square = def.apply(src, { ...base, width: 4, join: 'square' });
    const round = def.apply(src, { ...base, width: 4, join: 'round' });
    // 线心在方块边上，两侧各 2px：外角 (2, 2) 方角有、圆角没有；边中段 (2, 8) 两者都有
    expect(isRed(square, 2, 2)).toBe(true);
    expect(isRed(round, 2, 2)).toBe(false);
    expect(isRed(square, 2, 8)).toBe(true);
    expect(isRed(round, 2, 8)).toBe(true);
    expect(redCount(round)).toBeLessThan(redCount(square));
    // 内角 (5, 5) 两者都在线里
    expect(isRed(square, 5, 5)).toBe(true);
    expect(isRed(round, 5, 5)).toBe(true);
  });

  it('按明暗分布描线：线落在格子边上，格子可以带偏移', () => {
    // 4 × 2 格，左两列暗、右两列亮，格子 4px，横向偏移 1：格子 i 覆盖 [4i − 1, 4i + 3)，分界在 x = 7
    const gray = { width: 4, height: 2, data: new Float32Array([0, 0, 1, 1, 0, 0, 1, 1]) };
    const tone = toneMapOf(gray, 4, 4, 1, 0, 'round');
    expect(tone.originX).toBe(-1);
    const mask = outlineMask(tone, 16, 8, 2, '', 2, false);
    for (let y = 0; y < 8; y++) {
      expect(mask[y * 16 + 6]).toBe(1);
      expect(mask[y * 16 + 7]).toBe(1);
      expect(mask[y * 16 + 5]).toBe(0);
      expect(mask[y * 16 + 8]).toBe(0);
    }
    // 上下两行同阶，横边不描
    expect(mask[4 * 16 + 0]).toBe(0);
    expect(mask[3 * 16 + 0]).toBe(0);
  });

  it('流水线里按格子描线：像素尺寸 4 时线贴着格子边，而不是抖动噪点边', () => {
    const p = new Pipeline();
    // 左半黑右半白，画布 64×32，像素尺寸 4，单色 Bayer：分界正好在第 8 格的边上 x = 32
    const source = makeFrame(64, 32, (x) => (x < 32 ? [0, 0, 0] : [255, 255, 255]));
    const inst = defaultEffectInstance(LEVEL_OUTLINE_ID)!;
    inst.params = { ...inst.params, levels: 2, width: 2, color: '#FF0000', join: 'square' };
    const params = { ...defaultParams(), 'canvas.width': 64, 'canvas.height': 32, 'pixel.size': 4, 'effects.stack': serializeStack([inst]) };
    const out = p.run(source, 'a', params);
    expect(p.lastStats.recomputed).toContain('effects');
    for (let y = 0; y < 32; y++) {
      expect(isRed(out, 31, y)).toBe(true);
      expect(isRed(out, 32, y)).toBe(true);
      expect(isRed(out, 30, y)).toBe(false);
      expect(isRed(out, 33, y)).toBe(false);
    }
    expect(redCount(out)).toBe(64);
    // 只改特效参数只重算 effects
    inst.params = { ...inst.params, width: 4 };
    const wide = p.run(source, 'a', { ...params, 'effects.stack': serializeStack([inst]) });
    expect(p.lastStats.recomputed).toEqual(['effects']);
    expect(redCount(wide)).toBe(128);
    // 改像素尺寸后线跟着格子走：像素尺寸 8 时分界还在 x = 32
    const big = p.run(source, 'a', { ...params, 'pixel.size': 8 });
    expect(isRed(big, 31, 0)).toBe(true);
    expect(isRed(big, 32, 0)).toBe(true);
    expect(isRed(big, 30, 0)).toBe(false);
  });

  it('排线 / 网点 / 符号风格下也描，线落在明暗分界附近', () => {
    const source = makeFrame(64, 32, (x) => (x < 32 ? [0, 0, 0] : [255, 255, 255]));
    for (const style of ['hatch', 'halftone', 'glyph'] as const) {
      const inst = defaultEffectInstance(LEVEL_OUTLINE_ID)!;
      inst.params = { ...inst.params, levels: 2, width: 2, color: '#FF0000' };
      const params = { ...defaultParams(), 'style.type': style, 'canvas.width': 64, 'canvas.height': 32, 'effects.stack': serializeStack([inst]) };
      const out = new Pipeline().run(source, style, params);
      let reds = 0;
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 64; x++) {
          if (!isRed(out, x, y)) continue;
          reds++;
          expect(Math.abs(x - 32)).toBeLessThanOrEqual(16);
        }
      }
      expect(reds).toBeGreaterThanOrEqual(32);
    }
  });

  it('添加时阶数跟随风格：单色 2、灰阶按级数、排线 / 符号按各自的色阶、网点开分级才有阶数', () => {
    const d = defaultParams();
    expect(styleLevelCount(d)).toBe(2);
    expect(styleLevelCount({ ...d, 'color.mode': 'gray', 'color.levels': 6 })).toBe(6);
    expect(styleLevelCount({ ...d, 'color.mode': 'palette', 'color.mismatch': true, 'color.palette.levels': 5 })).toBe(5);
    expect(styleLevelCount({ ...d, 'style.type': 'hatch', 'hatch.levels': 7 })).toBe(7);
    expect(styleLevelCount({ ...d, 'style.type': 'glyph', 'glyph.levels': 4 })).toBe(4);
    expect(styleLevelCount({ ...d, 'style.type': 'halftone', 'halftone.stepped': true, 'halftone.levels': 12 })).toBe(12);
    expect(styleLevelCount({ ...d, 'style.type': 'halftone', 'halftone.stepped': false })).toBe(8);
    const inst = defaultEffectInstance(LEVEL_OUTLINE_ID, { ...d, 'color.mode': 'gray', 'color.levels': 6 })!;
    expect(inst.params.levels).toBe(6);
    expect(defaultEffectInstance(LEVEL_OUTLINE_ID)!.params.levels).toBe(8);
    // 超出范围的阶数收敛到上限
    expect(defaultEffectInstance(LEVEL_OUTLINE_ID, { ...d, 'style.type': 'halftone', 'halftone.stepped': true, 'halftone.levels': 32 })!.params.levels).toBe(16);
  });
});

describe('叠加原图', () => {
  const overlay = getEffectDef('sourceOverlay')!;
  const defaults = () => defaultEffectInstance('sourceOverlay')!.params;
  // 成品：左半墨（黑）右半纸（白）；原图：纯色
  const result = () => makeFrame(40, 20, (x) => (x < 20 ? [0, 0, 0] : [255, 255, 255]));
  const photo = () => makeFrame(40, 20, () => [200, 100, 50]);
  const px = (f: RGBAFrame, x: number, y: number) => Array.from(f.data.subarray((y * f.width + x) * 4, (y * f.width + x) * 4 + 3));
  // Uint8ClampedArray 半数向偶数舍入，比对时留 1 的余量
  const near = (actual: number[], expected: number[]) => actual.forEach((v, i) => expect(Math.abs(v - expected[i])).toBeLessThanOrEqual(1));

  it('没有原图时原样返回；不透明度 0 也不动', () => {
    const src = result();
    expect(overlay.apply(src, defaults())).toBe(src);
    expect(applyEffects(src, [defaultEffectInstance('sourceOverlay')!])).toBe(src);
    expect(overlay.apply(src, { ...defaults(), opacity: 0 }, { source: photo() })).toBe(src);
  });

  it('正片叠底：纸透出原图、墨色不动，不透明度减半只走一半', () => {
    const src = result();
    const bg = photo();
    const full = overlay.apply(src, defaults(), { source: bg });
    expect(px(full, 30, 10)).toEqual([200, 100, 50]);
    expect(px(full, 10, 10)).toEqual([0, 0, 0]);
    const half = overlay.apply(src, { ...defaults(), opacity: 50 }, { source: bg });
    near(px(half, 30, 10), [227.5, 177.5, 152.5]);
    expect(px(half, 10, 10)).toEqual([0, 0, 0]);
    // 成品与原图都不被改
    expect(src.data).toEqual(result().data);
    expect(bg.data).toEqual(photo().data);
    for (let i = 3; i < full.data.length; i += 4) expect(full.data[i]).toBe(255);
  });

  it('滤色：墨透出原图、纸不动；正常：两边都按不透明度直接混合', () => {
    const screen = overlay.apply(result(), { ...defaults(), blend: 'screen' }, { source: photo() });
    expect(px(screen, 10, 10)).toEqual([200, 100, 50]);
    expect(px(screen, 30, 10)).toEqual([255, 255, 255]);
    const normal = overlay.apply(result(), { ...defaults(), blend: 'normal' }, { source: photo() });
    expect(px(normal, 10, 10)).toEqual([200, 100, 50]);
    expect(px(normal, 30, 10)).toEqual([200, 100, 50]);
    const faint = overlay.apply(result(), { ...defaults(), blend: 'normal', opacity: 25 }, { source: photo() });
    near(px(faint, 10, 10), [50, 25, 12.5]);
  });

  it('缩放绕画布中心、偏移按画布百分比，没盖到的地方成品原样', () => {
    // 50%：20×10 的块摆在 (10, 5)
    const small = overlay.apply(result(), { ...defaults(), scale: 50 }, { source: photo() });
    expect(px(small, 25, 7)).toEqual([200, 100, 50]);
    expect(px(small, 35, 10)).toEqual([255, 255, 255]);
    expect(px(small, 25, 2)).toEqual([255, 255, 255]);
    // 再往右推 50%（20px）：块到了 (30, 5)，只剩右边 10 列在画布内
    const shifted = overlay.apply(result(), { ...defaults(), scale: 50, offsetX: 50 }, { source: photo() });
    expect(px(shifted, 25, 7)).toEqual([255, 255, 255]);
    expect(px(shifted, 35, 7)).toEqual([200, 100, 50]);
    // 推出画布外：什么都不画
    const gone = overlay.apply(result(), { ...defaults(), scale: 50, offsetY: 100 }, { source: photo() });
    expect(gone.data).toEqual(result().data);
    // 放大 200%：画布只看到原图中间那一块——四条竖带里外侧的绿、黄被裁掉，蓝、红各占半边画布
    const bands = makeFrame(40, 20, (x) => (x < 10 ? [0, 255, 0] : x < 20 ? [0, 0, 255] : x < 30 ? [255, 0, 0] : [255, 255, 0]));
    const paper = makeFrame(40, 20, () => [255, 255, 255]);
    const big = overlay.apply(paper, { ...defaults(), scale: 200 }, { source: bands });
    near(px(big, 2, 10), [0, 0, 255]);
    near(px(big, 18, 10), [0, 0, 255]);
    near(px(big, 22, 10), [255, 0, 0]);
    near(px(big, 37, 10), [255, 0, 0]);
    for (let x = 0; x < 40; x++) {
      const [r, g, b] = px(big, 10, x % 20);
      expect(g === 255 && r === 0 && b === 0).toBe(false);
      expect(r === 255 && g === 255 && b === 0).toBe(false);
    }
  });

  it('亮度 / 对比度 / 饱和度 / 模糊作用在背景上', () => {
    const paper = makeFrame(40, 20, () => [255, 255, 255]);
    const bg = makeFrame(40, 20, (x, y) => ((x + y) % 2 === 0 ? [220, 60, 60] : [40, 40, 120]));
    const plain = overlay.apply(paper, defaults(), { source: bg });
    const bright = overlay.apply(paper, { ...defaults(), brightness: 50 }, { source: bg });
    expect(mean(bright)).toBeGreaterThan(mean(plain) + 20);
    const flat = overlay.apply(paper, { ...defaults(), contrast: -100 }, { source: bg });
    expect(variance(flat)).toBeLessThan(variance(plain));
    const gray = overlay.apply(paper, { ...defaults(), saturation: -100 }, { source: bg });
    for (let i = 0; i < gray.data.length; i += 4) expect(Math.abs(gray.data[i] - gray.data[i + 2])).toBeLessThanOrEqual(1);
    const soft = overlay.apply(paper, { ...defaults(), blur: true, blurRadius: 4 }, { source: bg });
    expect(variance(soft)).toBeLessThan(variance(plain) * 0.2);
    // 半径只在开了模糊时生效
    const off = overlay.apply(paper, { ...defaults(), blur: false, blurRadius: 4 }, { source: bg });
    expect(off.data).toEqual(plain.data);
  });

  it('走流水线：拿到适配画布的原图，换帧重算、参数不变命中缓存', () => {
    const p = new Pipeline();
    const params = { ...defaultParams(), 'canvas.width': 32, 'canvas.height': 20, 'pixel.size': 2, 'effects.stack': serializeStack([defaultEffectInstance('sourceOverlay')!]) };
    const a = makeFrame(64, 40, (x) => [x * 4, 60, 200]);
    const plain = p.run(a, 'a', { ...params, 'effects.stack': '' });
    const fx = p.run(a, 'a', params);
    expect(p.lastStats.recomputed).toEqual(['effects']);
    expect(differs(plain, fx)).toBe(true);
    p.run(a, 'a', params);
    expect(p.lastStats.recomputed).toEqual([]);
    // 视频下一帧：源帧换了，特效跟着重算
    const b2 = makeFrame(64, 40, (x) => [200, 60, x * 4]);
    const next = p.run(b2, 'b', params);
    expect(p.lastStats.recomputed).toContain('effects');
    expect(differs(fx, next)).toBe(true);
  });
});

describe('叠加随机方块', () => {
  const def = getEffectDef('blocks')!;
  const base = (): EffectParamValues => coerceEffectParams(def, {});
  const black = () => makeFrame(64, 48, () => [0, 0, 0]);
  const ctx = { cellW: 4, cellH: 6, offsetX: 0, offsetY: 0 };

  it('点阵字体：每个字 7 行 5 列，大小写同形，没有的字符不画', () => {
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?#%&*+-=.:/@<>[]()^_$~"\',;|') {
      const g = glyphOf(ch);
      expect(g, ch).not.toBeNull();
      expect(g!.length).toBe(FONT_ROWS);
      for (const row of g!) expect(row.length).toBe(FONT_COLS);
      // 每个字至少有一格墨，且不全是墨
      const inked = g!.flat().filter(Boolean).length;
      expect(inked, ch).toBeGreaterThan(0);
      expect(inked, ch).toBeLessThan(FONT_COLS * FONT_ROWS);
    }
    expect(glyphOf('a')).toEqual(glyphOf('A'));
    expect(hasGlyph('中')).toBe(false);
    expect(drawableChars('ab 中 3!')).toEqual(['A', 'B', '3', '!']);
  });

  it('数量：撒几块就是几块，0–16，0 块时画面不变', () => {
    expect(layoutBlocks(64, 48, { ...base(), count: 5 }, ctx).length).toBe(5);
    expect(layoutBlocks(64, 48, { ...base(), count: 99 }, ctx).length).toBe(BLOCK_MAX_COUNT);
    expect(layoutBlocks(64, 48, { ...base(), count: 0 }, ctx)).toEqual([]);
    const src = black();
    const out = def.apply(src, { ...base(), count: 0 }, { grid: ctx });
    expect(out.data).toEqual(src.data);
    expect(out).not.toBe(src);
  });

  it('尺寸以格子为单位：块的宽高是格子的整数倍，位置落在网格线上、整个在画布内', () => {
    for (const ratio of BLOCK_RATIOS) {
      for (const size of [1, 2, 3]) {
        const rects = layoutBlocks(400, 300, { ...base(), count: 16, size, ratio: ratio.value, seed: 7 }, { cellW: 5, cellH: 3, offsetX: 2, offsetY: 1 });
        expect(rects.length).toBe(16);
        for (const r of rects) {
          expect(r.w).toBe(size * ratio.w * 5);
          expect(r.h).toBe(size * ratio.h * 3);
          // 网格线在 x = k·cellW − offsetX 上
          expect((r.x + 2) % 5).toBe(0);
          expect((r.y + 1) % 3).toBe(0);
          expect(r.x).toBeGreaterThanOrEqual(0);
          expect(r.y).toBeGreaterThanOrEqual(0);
          expect(r.x + r.w).toBeLessThanOrEqual(400);
          expect(r.y + r.h).toBeLessThanOrEqual(300);
        }
      }
    }
    // 偏移对齐：偏移取模格子
    const shifted = layoutBlocks(400, 300, { ...base(), count: 8, size: 1, seed: 3 }, { cellW: 8, cellH: 8, offsetX: 11, offsetY: -5 });
    for (const r of shifted) {
      expect((r.x + 3) % 8).toBe(0);
      expect((r.y + 3) % 8).toBe(0);
    }
  });

  it('块比画布还大时贴左上角放、超出裁掉，不会崩', () => {
    const rects = layoutBlocks(20, 20, { ...base(), count: 2, size: 8, ratio: '16:9' }, ctx);
    expect(rects[0].x).toBe(0);
    expect(rects[0].y).toBe(0);
    const out = def.apply(black(), { ...base(), count: 2, size: 8, ratio: '16:9' }, { grid: { cellW: 4, cellH: 4, offsetX: 0, offsetY: 0 } });
    expect(out.width).toBe(64);
    for (let i = 0; i < out.data.length; i += 4) expect(out.data[i]).toBe(255);
  });

  it('大小随机：每块在 1 格到尺寸之间取，且位置不因此洗牌', () => {
    const p = { ...base(), count: 16, size: 4, jitter: true, seed: 11 };
    const rects = layoutBlocks(400, 300, p, ctx);
    const sizes = new Set(rects.map((r) => r.w / ctx.cellW));
    expect(sizes.size).toBeGreaterThan(1);
    for (const m of sizes) {
      expect(m).toBeGreaterThanOrEqual(1);
      expect(m).toBeLessThanOrEqual(4);
    }
    // 同一种子换尺寸，每块的随机数序列不变（位置只是重新夹紧）
    const a = layoutBlocks(400, 300, { ...p, jitter: false, size: 1 }, ctx);
    const b = layoutBlocks(400, 300, { ...p, jitter: false, size: 2 }, ctx);
    let same = 0;
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i].x - b[i].x) <= ctx.cellW * 2 && Math.abs(a[i].y - b[i].y) <= ctx.cellH * 2) same++;
    expect(same).toBeGreaterThan(a.length / 2);
  });

  it('种子：换种子换位置，同种子确定', () => {
    const a = layoutBlocks(400, 300, { ...base(), seed: 1 }, ctx);
    const b = layoutBlocks(400, 300, { ...base(), seed: 2 }, ctx);
    const c = layoutBlocks(400, 300, { ...base(), seed: 1 }, ctx);
    expect(a).toEqual(c);
    expect(a.some((r, i) => r.x !== b[i].x || r.y !== b[i].y)).toBe(true);
  });

  it('纯色块：块内每个像素都是块的颜色，块外不动', () => {
    const p = { ...base(), count: 3, size: 2, palette: 'lime', seed: 5 };
    const rects = layoutBlocks(64, 48, p, ctx);
    const out = def.apply(black(), p, { grid: ctx });
    const inside = (x: number, y: number) => rects.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 64; x++) {
        const o = (y * 64 + x) * 4;
        const expected = inside(x, y) ? [0xe5, 0xf5, 0x6e] : [0, 0, 0];
        expect([out.data[o], out.data[o + 1], out.data[o + 2]]).toEqual(expected);
        expect(out.data[o + 3]).toBe(255);
      }
    }
  });

  it('色块 + 字母：字在块中间、颜色自动对比；块太小放不下就只画色块；字母串按顺序轮流', () => {
    const p = { ...base(), count: 2, size: 4, style: 'letter', letters: 'AB', letterSize: 60, seed: 9 };
    const big = { cellW: 8, cellH: 8, offsetX: 0, offsetY: 0 };
    const rects = layoutBlocks(400, 300, p, big);
    expect(rects.map((r) => r.letter)).toEqual(['A', 'B']);
    const out = def.apply(makeFrame(400, 300, () => [0, 0, 0]), p, { grid: big });
    const r = rects[0];
    // 白块上的黑字：块内既有白也有黑，且黑的都在块的中间区域
    let white = 0;
    let dark = 0;
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const o = (y * 400 + x) * 4;
        if (out.data[o] === 255) white++;
        else if (out.data[o] === 0) {
          dark++;
          expect(x).toBeGreaterThanOrEqual(r.x + r.w * 0.1);
          expect(x).toBeLessThan(r.x + r.w * 0.9);
          expect(y).toBeGreaterThanOrEqual(r.y + r.h * 0.1);
          expect(y).toBeLessThan(r.y + r.h * 0.9);
        }
      }
    }
    expect(white).toBeGreaterThan(0);
    expect(dark).toBeGreaterThan(0);
    // 黑块配白字；自定义字母色照用
    const onBlack = def.apply(makeFrame(400, 300, () => [128, 128, 128]), { ...p, palette: 'black' }, { grid: big });
    const pxOf = (frame: RGBAFrame) => {
      const set = new Set<string>();
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) set.add(String(frame.data.slice((y * 400 + x) * 4, (y * 400 + x) * 4 + 3)));
      return set;
    };
    expect([...pxOf(onBlack)].sort()).toEqual(['0,0,0', '255,255,255']);
    const custom = def.apply(makeFrame(400, 300, () => [0, 0, 0]), { ...p, letterColor: 'custom', letterHex: '#FF0000' }, { grid: big });
    expect(pxOf(custom).has('255,0,0')).toBe(true);
    // 一格 4px 的 1 格块放不下字，只有色块
    const tiny = { ...p, size: 1 };
    const tinyRects = layoutBlocks(64, 48, tiny, ctx);
    const tinyOut = def.apply(black(), tiny, { grid: ctx });
    const tr = tinyRects[0];
    for (let y = tr.y; y < tr.y + tr.h; y++) for (let x = tr.x; x < tr.x + tr.w; x++) expect(tinyOut.data[(y * 64 + x) * 4]).toBe(255);
  });

  it('配色：按方案轮流取色，每块可单独改，改了转为自定义；自定义列表按 count 轮流', () => {
    const bw = resolveBlockColors({ ...base(), count: 5, palette: 'bw' });
    expect(bw).toEqual(['#FFFFFF', '#000000', '#FFFFFF', '#000000', '#FFFFFF']);
    for (const p of BLOCK_PALETTES) {
      if (p.value === 'custom') continue;
      expect(resolveBlockColors({ ...base(), count: 3, palette: p.value })).toEqual([0, 1, 2].map((i) => p.colors[i % p.colors.length]));
    }
    const edited = editBlockColor({ ...base(), count: 3, palette: 'bw' }, 1, '#ff00ff');
    expect(edited.palette).toBe('custom');
    expect(edited.colors).toBe('#FFFFFF #FF00FF #FFFFFF');
    expect(resolveBlockColors(edited)).toEqual(['#FFFFFF', '#FF00FF', '#FFFFFF']);
    // 数量增加后沿着自定义列表轮流；越界的编辑不改参数
    expect(resolveBlockColors({ ...edited, count: 5 })).toEqual(['#FFFFFF', '#FF00FF', '#FFFFFF', '#FFFFFF', '#FF00FF']);
    expect(editBlockColor(edited, 7, '#000000')).toBe(edited);
    // 自定义但列表为空时退回白
    expect(resolveBlockColors({ ...base(), count: 2, palette: 'custom', colors: '' })).toEqual(['#FFFFFF', '#FFFFFF']);
    // 块上画的就是这些颜色
    const p = { ...edited, count: 3, size: 1, seed: 4 };
    const rects = layoutBlocks(64, 48, p, ctx);
    expect(rects.map((r) => r.color)).toEqual(['#FFFFFF', '#FF00FF', '#FFFFFF']);
  });

  it('参数收敛：文本截断、颜色校验、色列表清洗、可见性条件', () => {
    const c = coerceEffectParams(def, { letters: 'x'.repeat(100), letterHex: 'nope', colors: '#fff junk 123456 #ABCDEF', ratio: '5:7', palette: 'rainbow', count: -3 });
    expect((c.letters as string).length).toBe(32);
    expect(c.letterHex).toBe('#000000');
    expect(c.colors).toBe('#FFFFFF #123456 #ABCDEF');
    expect(c.ratio).toBe('1:1');
    expect(c.palette).toBe('white');
    expect(c.count).toBe(0);
    expect(coerceEffectParams(def, { letterHex: '#abcdef' }).letterHex).toBe('#ABCDEF');
    const letters = def.params.find((x) => x.id === 'letters')!;
    const hex = def.params.find((x) => x.id === 'letterHex')!;
    expect(isEffectParamVisible(letters, { style: 'solid' })).toBe(false);
    expect(isEffectParamVisible(letters, { style: 'letter' })).toBe(true);
    expect(isEffectParamVisible(hex, { style: 'letter', letterColor: 'auto' })).toBe(false);
    expect(isEffectParamVisible(hex, { style: 'letter', letterColor: 'custom' })).toBe(true);
    expect(isEffectParamVisible(hex, { style: 'solid', letterColor: 'custom' })).toBe(false);
    expect(isEffectParamVisible(def.params[0], {})).toBe(true);
    // 栈往返带着新类型的值
    const stack = parseStack(serializeStack([{ type: 'blocks', enabled: true, params: { ...base(), letters: 'OK', colors: '#FF0000' } }]));
    expect(stack[0].params.letters).toBe('OK');
    expect(stack[0].params.colors).toBe('#FF0000');
  });

  it('网格单位：抖动是像素尺寸，排线是横纵间距，网点 / 符号是间距且格线取在两点正中', () => {
    const p = { ...defaultParams(), 'pixel.size': 6, 'pixel.offsetX': 2, 'pixel.offsetY': 3, 'hatch.spacingX': 7, 'hatch.spacingY': 9 };
    expect(gridUnitOf(toPipelineOptions(p))).toEqual({ cellW: 6, cellH: 6, offsetX: 2, offsetY: 3 });
    expect(gridUnitOf(toPipelineOptions({ ...p, 'style.type': 'hatch' }))).toEqual({ cellW: 7, cellH: 9, offsetX: 2, offsetY: 3 });
    const ht = gridUnitOf(toPipelineOptions({ ...p, 'style.type': 'halftone', 'screen.pitchX': 12, 'screen.pitchY': 10, 'screen.offsetX': 4, 'screen.offsetY': 0 }));
    expect(ht).toEqual({ cellW: 12, cellH: 10, offsetX: -2, offsetY: -5 });
    const gl = gridUnitOf(toPipelineOptions({ ...p, 'style.type': 'glyph', 'tile.pitchX': 8, 'tile.pitchY': 8, 'tile.offsetX': 0, 'tile.offsetY': 0 }));
    expect(gl).toEqual({ cellW: 8, cellH: 8, offsetX: -4, offsetY: -4 });
  });

  it('流水线里方块按当前风格的格子对齐：抖动 5px 像素、排线 7×9 间距', () => {
    const source = makeFrame(80, 60, () => [0, 0, 0]);
    const stack = serializeStack([{ type: 'blocks', enabled: true, params: { ...base(), count: 1, size: 1, palette: 'custom', colors: '#FF00FF', seed: 2 } }]);
    const bbox = (frame: RGBAFrame) => {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -1;
      let y1 = -1;
      for (let y = 0; y < frame.height; y++) {
        for (let x = 0; x < frame.width; x++) {
          const o = (y * frame.width + x) * 4;
          if (frame.data[o] === 255 && frame.data[o + 1] === 0 && frame.data[o + 2] === 255) {
            x0 = Math.min(x0, x);
            y0 = Math.min(y0, y);
            x1 = Math.max(x1, x);
            y1 = Math.max(y1, y);
          }
        }
      }
      return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    };
    const dither = bbox(renderImage(source, { ...defaultParams(), 'canvas.width': 80, 'canvas.height': 60, 'pixel.size': 5, 'effects.stack': stack }));
    expect([dither.w, dither.h]).toEqual([5, 5]);
    expect(dither.x % 5).toBe(0);
    expect(dither.y % 5).toBe(0);
    const hatch = bbox(
      renderImage(source, { ...defaultParams(), 'style.type': 'hatch', 'canvas.width': 80, 'canvas.height': 60, 'hatch.spacingX': 7, 'hatch.spacingY': 9, 'effects.stack': stack }),
    );
    expect([hatch.w, hatch.h]).toEqual([7, 9]);
    expect(hatch.x % 7).toBe(0);
    expect(hatch.y % 9).toBe(0);
    // 网点：格线在两点正中，块边落在 (k + 0.5)·pitch
    const ht = bbox(
      renderImage(source, { ...defaultParams(), 'style.type': 'halftone', 'canvas.width': 80, 'canvas.height': 60, 'screen.pitchX': 8, 'screen.pitchY': 8, 'effects.stack': stack }),
    );
    expect([ht.w, ht.h]).toEqual([8, 8]);
    expect((ht.x + 4) % 8).toBe(0);
  });

  it('矢量片段：一块一个 rect，字母并成 path，塞进 </svg> 前；其它特效不出矢量', () => {
    const stack = [
      { type: 'grain', enabled: true, params: coerceEffectParams(getEffectDef('grain')!, {}) },
      { type: 'blocks', enabled: true, params: { ...base(), count: 3, size: 4, style: 'letter', letters: 'Z', palette: 'black' } },
      { type: 'blocks', enabled: false, params: { ...base(), count: 3 } },
    ];
    const fragment = effectsSvgFragment(stack, 400, 300, { cellW: 8, cellH: 8, offsetX: 0, offsetY: 0 });
    expect(fragment.startsWith('<g data-effect="blocks">')).toBe(true);
    expect((fragment.match(/<rect /g) ?? []).length).toBe(3);
    expect((fragment.match(/<path /g) ?? []).length).toBe(3);
    expect(fragment).toContain('fill="#000000"');
    expect(fragment).toContain('fill="#FFFFFF"');
    const svg = appendSvgFragment('<svg><rect/></svg>', fragment);
    expect(svg.endsWith(`${fragment}</svg>`)).toBe(true);
    expect(appendSvgFragment('<svg></svg>', '')).toBe('<svg></svg>');
    expect(effectsSvgFragment([stack[0]], 400, 300)).toBe('');
  });
});
