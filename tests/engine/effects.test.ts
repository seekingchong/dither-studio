import { describe, expect, it } from 'vitest';
import { defaultParams } from '@/params';
import { EFFECT_DEFS, Pipeline, applyEffects, coerceEffectParams, defaultEffectInstance, getEffectDef, parseStack, serializeStack, type RGBAFrame } from '@/engine';
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
