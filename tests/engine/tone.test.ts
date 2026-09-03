import { describe, expect, it } from 'vitest';
import { defaultParams } from '@/params';
import {
  DEFAULT_TONE,
  Pipeline,
  applyTone,
  autoLevels,
  bilateral,
  boxBlur,
  boxesForGauss,
  buildToneCurve,
  gaussianBlur,
  sobelMagnitude,
  suggestPixelSize,
  type RGBFrame,
} from '@/engine';
import { makeFrame } from './helpers';

function rgbFrame(width: number, height: number, fn: (x: number, y: number) => [number, number, number]): RGBFrame {
  const data = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fn(x, y);
      const i = (y * width + x) * 3;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  }
  return { width, height, data };
}

const mean = (a: Float32Array) => a.reduce((s, v) => s + v, 0) / a.length;
const variance = (a: Float32Array) => {
  const m = mean(a);
  return a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length;
};

describe('影调曲线', () => {
  it('默认曲线是恒等', () => {
    const lut = buildToneCurve({ brightness: 0, contrast: 0, shadows: 0, midtones: 0, highlights: 0 });
    for (let i = 0; i <= 1024; i += 64) expect(lut[i]).toBeCloseTo(i / 1024, 5);
  });
  it('亮度提高整体，对比度拉开两端，中间调提亮 0.5', () => {
    const bright = buildToneCurve({ brightness: 0.5, contrast: 0, shadows: 0, midtones: 0, highlights: 0 });
    expect(bright[512]).toBeGreaterThan(0.7);
    const contrast = buildToneCurve({ brightness: 0, contrast: 0.5, shadows: 0, midtones: 0, highlights: 0 });
    expect(contrast[256]).toBeLessThan(0.25);
    expect(contrast[768]).toBeGreaterThan(0.75);
    expect(contrast[512]).toBeCloseTo(0.5, 5);
    const mid = buildToneCurve({ brightness: 0, contrast: 0, shadows: 0, midtones: 0.5, highlights: 0 });
    expect(mid[512]).toBeGreaterThan(0.5);
    expect(mid[0]).toBe(0);
    expect(mid[1024]).toBeCloseTo(1, 5);
  });
  it('阴影只动暗部，高光只动亮部', () => {
    const sh = buildToneCurve({ brightness: 0, contrast: 0, shadows: 0.6, midtones: 0, highlights: 0 });
    expect(sh[102]).toBeGreaterThan(0.1);
    expect(sh[1000]).toBeCloseTo(1000 / 1024, 2);
    const hi = buildToneCurve({ brightness: 0, contrast: 0, shadows: 0, midtones: 0, highlights: -0.6 });
    expect(hi[1000]).toBeLessThan(0.9);
    expect(hi[50]).toBeCloseTo(50 / 1024, 2);
  });
  it('曲线单调不减', () => {
    for (const o of [
      { brightness: 0.3, contrast: 0.8, shadows: 0.4, midtones: -0.5, highlights: 0.3 },
      { brightness: -0.4, contrast: -0.6, shadows: -0.7, midtones: 0.9, highlights: -0.9 },
    ]) {
      const lut = buildToneCurve(o);
      for (let i = 1; i <= 1024; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1] - 1e-6);
    }
  });
});

describe('滤波', () => {
  it('盒式模糊保持均值并把脉冲铺开', () => {
    const w = 9;
    const src = new Float32Array(w * 1);
    src[4] = 1;
    const out = boxBlur(src, w, 1, 1, 1);
    expect(mean(out)).toBeCloseTo(mean(src), 5);
    expect(out[3]).toBeCloseTo(1 / 3, 5);
    expect(out[4]).toBeCloseTo(1 / 3, 5);
    expect(out[5]).toBeCloseTo(1 / 3, 5);
  });
  it('高斯模糊降低方差且 σ=0 为拷贝', () => {
    const w = 32;
    const h = 32;
    const src = new Float32Array(w * h);
    for (let i = 0; i < src.length; i++) src[i] = (i * 7919) % 13 < 6 ? 0 : 1;
    const out = gaussianBlur(src, w, h, 1, 2);
    expect(variance(out)).toBeLessThan(variance(src) * 0.5);
    expect(Math.abs(mean(out) - mean(src))).toBeLessThan(0.02);
    const same = gaussianBlur(src, w, h, 1, 0);
    expect(same).toEqual(src);
    expect(same).not.toBe(src);
    expect(boxesForGauss(1).length).toBe(3);
  });
  it('Sobel 在竖直边缘处响应最大', () => {
    const w = 8;
    const h = 4;
    const g = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = x < 4 ? 0 : 1;
    const mag = sobelMagnitude(g, w, h);
    expect(mag[1 * w + 3]).toBeGreaterThan(0);
    expect(mag[1 * w + 4]).toBeGreaterThan(0);
    expect(mag[1 * w + 1]).toBe(0);
    expect(mag[1 * w + 6]).toBe(0);
  });
  it('双边滤波平滑噪声但保留强边缘', () => {
    const w = 24;
    const h = 8;
    const src = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) src[y * w + x] = (x < 12 ? 0.2 : 0.8) + (((x * 31 + y * 17) % 7) / 7 - 0.5) * 0.08;
    const out = bilateral(src, w, h, 1, 0.1);
    const left = out.filter((_, i) => i % w < 10);
    const right = out.filter((_, i) => i % w >= 14);
    expect(variance(left)).toBeLessThan(variance(src.filter((_, i) => i % w < 10)));
    expect(mean(right) - mean(left)).toBeGreaterThan(0.5);
  });
});

describe('applyTone', () => {
  const base = rgbFrame(16, 16, (x, y) => [(x / 15) * 0.8 + 0.1, (y / 15) * 0.8 + 0.1, 0.5]);

  it('默认选项返回原对象', () => {
    expect(applyTone(base, {})).toBe(base);
  });
  it('反相与饱和度 -100 → 灰', () => {
    const inv = applyTone(base, { invert: true });
    expect(inv.data[0]).toBeCloseTo(1 - base.data[0], 5);
    const gray = applyTone(base, { saturation: -1 });
    for (let j = 0; j < gray.data.length; j += 3) {
      expect(gray.data[j]).toBeCloseTo(gray.data[j + 1], 4);
      expect(gray.data[j + 1]).toBeCloseTo(gray.data[j + 2], 4);
    }
  });
  it('自动色阶把 0.3..0.6 拉到接近 0..1', () => {
    const data = new Float32Array(1000 * 3);
    for (let i = 0; i < 1000; i++) {
      const v = 0.3 + (i / 999) * 0.3;
      data[i * 3] = data[i * 3 + 1] = data[i * 3 + 2] = v;
    }
    autoLevels(data, 3);
    expect(Math.min(...Array.from(data))).toBeLessThan(0.05);
    expect(Math.max(...Array.from(data))).toBeGreaterThan(0.95);
  });
  it('噪点按种子确定且改变方差', () => {
    const flat = rgbFrame(32, 32, () => [0.5, 0.5, 0.5]);
    const a = applyTone(flat, { noise: 0.5, noiseSeed: 3 });
    const b = applyTone(flat, { noise: 0.5, noiseSeed: 3 });
    const c = applyTone(flat, { noise: 0.5, noiseSeed: 4 });
    expect(a.data).toEqual(b.data);
    expect(Array.from(a.data)).not.toEqual(Array.from(c.data));
    expect(variance(a.data)).toBeGreaterThan(0.001);
    for (const t of ['uniform', 'blue', 'salt-pepper'] as const) {
      expect(variance(applyTone(flat, { noise: 0.8, noiseType: t }).data)).toBeGreaterThan(0.0005);
    }
  });
  it('描边只压暗边缘', () => {
    const edge = rgbFrame(16, 8, (x) => (x < 8 ? [0.2, 0.2, 0.2] : [0.9, 0.9, 0.9]));
    const out = applyTone(edge, { outline: 1, outlineThreshold: 0.2 });
    expect(out.data[(4 * 16 + 8) * 3]).toBeLessThan(0.9);
    expect(out.data[(4 * 16 + 14) * 3]).toBeCloseTo(0.9, 5);
    expect(out.data[(4 * 16 + 1) * 3]).toBeCloseTo(0.2, 5);
  });
  it('模糊降低方差，锐化提高边缘对比', () => {
    const edge = rgbFrame(16, 8, (x) => (x < 8 ? [0.3, 0.3, 0.3] : [0.7, 0.7, 0.7]));
    const blurred = applyTone(edge, { blur: 2 });
    expect(variance(blurred.data)).toBeLessThan(variance(edge.data));
    const sharp = applyTone(edge, { sharpen: 1 });
    const i7 = (3 * 16 + 7) * 3;
    const i8 = (3 * 16 + 8) * 3;
    expect(sharp.data[i8] - sharp.data[i7]).toBeGreaterThan(0.4);
  });
  it('去噪降低平坦区方差', () => {
    const noisy = rgbFrame(24, 24, (x, y) => {
      const v = 0.5 + (((x * 31 + y * 17) % 7) / 7 - 0.5) * 0.1;
      return [v, v, v];
    });
    const out = applyTone(noisy, { denoise: 1 });
    expect(variance(out.data)).toBeLessThan(variance(noisy.data) * 0.5);
  });
  it('DEFAULT_TONE 与 schema 默认值一致（恒等）', () => {
    expect(DEFAULT_TONE.brightness).toBe(0);
    expect(DEFAULT_TONE.outlineThreshold).toBeCloseTo(0.2, 5);
  });
});

describe('像素尺寸自适应', () => {
  it('小图 2、中图 3、大图 4', () => {
    expect(suggestPixelSize(640, 480)).toBe(2);
    expect(suggestPixelSize(1200, 800)).toBe(3);
    expect(suggestPixelSize(1000, 2400)).toBe(4);
  });
});

describe('流水线影调缓存', () => {
  it('改亮度只重算影调及下游，改阈值不重算影调', () => {
    const p = new Pipeline();
    const src = makeFrame(64, 40, (x) => [x * 4, x * 4, x * 4]);
    const params = { ...defaultParams(), 'canvas.width': 32, 'canvas.height': 20, 'pixel.size': 2 };
    p.run(src, 'a', params);
    p.run(src, 'a', { ...params, 'tone.brightness': 20 });
    expect(p.lastStats.recomputed[0]).toBe('tone');
    expect(p.lastStats.recomputed).not.toContain('pixelate');
    p.run(src, 'a', { ...params, 'tone.brightness': 20, 'tone.threshold': 100 });
    expect(p.lastStats.recomputed).not.toContain('tone');
    expect(p.lastStats.recomputed[0]).toMatch(/^dither:/);
  });
});
