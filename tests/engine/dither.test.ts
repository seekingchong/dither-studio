import { describe, expect, it } from 'vitest';
import { defaultParams } from '@/params';
import { bayerInts, errorDiffuse, findAlgorithm, getMatrix, KERNELS, orderedDither, resolveAlgorithm } from '@/engine';
import { ascii, density, gradientInput, uniformInput } from './helpers';

const W = 32;
const H = 8;

describe('固定阈值', () => {
  const algo = findAlgorithm('threshold', 'fixed')!;
  it('渐变输出快照', () => {
    const out = algo.run(gradientInput(W, H), defaultParams());
    expect(ascii(out, W, H)).toMatchSnapshot();
  });
  it('0.5 以上为亮', () => {
    expect(density(algo.run(uniformInput(4, 4, 0.49), defaultParams()))).toBe(0);
    expect(density(algo.run(uniformInput(4, 4, 0.5), defaultParams()))).toBe(1);
  });
});

describe('Bayer 4×4', () => {
  it('矩阵是 0..15 的排列', () => {
    const m = Array.from(bayerInts(4)).sort((a, b) => a - b);
    expect(m).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(Array.from(bayerInts(2))).toEqual([0, 2, 3, 1]);
  });
  it('均匀 0.5 输入恰好一半为亮', () => {
    const out = orderedDither(uniformInput(8, 8, 0.5), getMatrix('bayer4'));
    expect(density(out)).toBe(0.5);
  });
  it('渐变输出快照', () => {
    const params = { ...defaultParams(), 'dither.family': 'ordered', 'dither.ordered.matrix': 'bayer4' };
    const out = resolveAlgorithm(params).run(gradientInput(W, H), params);
    expect(ascii(out, W, H)).toMatchSnapshot();
  });
  it('图案缩放 2 让 2×2 像素共用一个阈值', () => {
    const out = orderedDither(uniformInput(8, 8, 0.5), getMatrix('bayer4'), { scale: 2 });
    for (let y = 0; y < 8; y += 2) {
      for (let x = 0; x < 8; x += 2) {
        const v = out[y * 8 + x];
        expect(out[y * 8 + x + 1]).toBe(v);
        expect(out[(y + 1) * 8 + x]).toBe(v);
        expect(out[(y + 1) * 8 + x + 1]).toBe(v);
      }
    }
  });
});

describe('Floyd–Steinberg', () => {
  const fs = KERNELS.find((k) => k.id === 'floyd-steinberg')!;
  it('核权重之和为 1', () => {
    expect(fs.taps.reduce((s, [, , w]) => s + w, 0)).toBe(fs.divisor);
  });
  it('均匀 0.25 输入的亮点密度接近 25%', () => {
    const out = errorDiffuse(uniformInput(64, 64, 0.25), fs, { strength: 1, serpentine: true });
    expect(density(out)).toBeGreaterThan(0.22);
    expect(density(out)).toBeLessThan(0.28);
  });
  it('强度 0 退化为固定阈值', () => {
    const out = errorDiffuse(uniformInput(8, 8, 0.4), fs, { strength: 0, serpentine: false });
    expect(density(out)).toBe(0);
  });
  it('渐变输出快照（蛇形）', () => {
    const params = { ...defaultParams(), 'dither.family': 'error-diffusion' };
    const out = resolveAlgorithm(params).run(gradientInput(W, H), params);
    expect(ascii(out, W, H)).toMatchSnapshot();
  });
  it('渐变输出快照（单向）', () => {
    const out = errorDiffuse(gradientInput(W, H), fs, { strength: 1, serpentine: false });
    expect(ascii(out, W, H)).toMatchSnapshot();
  });
});

describe('registry', () => {
  it('默认参数解析到 Bayer 2×2', () => {
    expect(resolveAlgorithm(defaultParams()).id).toBe('bayer2');
    expect(resolveAlgorithm({ ...defaultParams(), 'dither.family': 'error-diffusion' }).id).toBe('floyd-steinberg');
  });
  it('未知组合回退到固定阈值', () => {
    const params = { ...defaultParams(), 'dither.family': 'ordered', 'dither.ordered.matrix': 'nope' };
    expect(resolveAlgorithm(params).id).toBe('fixed');
  });
});
