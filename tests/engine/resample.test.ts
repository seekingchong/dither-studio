import { describe, expect, it } from 'vitest';
import { axisWeights, resample } from '@/engine';
import { makeFrame } from './helpers';

describe('axisWeights', () => {
  it('box 整数倍缩小时权重均匀且覆盖精确区间', () => {
    const w = axisWeights(8, 2, 4, 0, 'box');
    expect(Array.from(w.count)).toEqual([4, 4]);
    expect(Array.from(w.start)).toEqual([0, 4]);
    for (let i = 0; i < 8; i++) expect(w.weights[i]).toBeCloseTo(0.25, 6);
  });

  it('nearest 取格子中心所在的源像素', () => {
    const w = axisWeights(8, 2, 4, 0, 'nearest');
    expect(Array.from(w.start)).toEqual([2, 6]);
    expect(Array.from(w.count)).toEqual([1, 1]);
  });

  it('偏移把网格向左移动并夹到边缘', () => {
    const w = axisWeights(8, 3, 4, 2, 'box');
    // 第一个格子覆盖 [-2, 2) → 只有源像素 0、1 有效
    expect(w.start[0]).toBe(0);
    expect(w.count[0]).toBe(2);
    expect(w.weights[0] + w.weights[1]).toBeCloseTo(1, 6);
  });

  it('每个目标索引的权重归一化', () => {
    for (const method of ['bilinear', 'lanczos', 'box'] as const) {
      const w = axisWeights(13, 5, 13 / 5, 0, method);
      for (let i = 0; i < 5; i++) {
        let sum = 0;
        for (let k = 0; k < w.count[i]; k++) sum += w.weights[w.offset[i] + k];
        expect(sum).toBeCloseTo(1, 5);
      }
    }
  });
});

describe('resample', () => {
  it('同尺寸返回副本', () => {
    const src = makeFrame(3, 2, (x, y) => [x * 40, y * 90, 7]);
    const out = resample(src, 3, 2, 'box');
    expect(out.data).toEqual(src.data);
    expect(out.data).not.toBe(src.data);
  });

  it('box 缩小 2 倍是 2×2 平均', () => {
    const src = makeFrame(4, 2, (x) => [x * 60, 0, 0]);
    const out = resample(src, 2, 1, 'box');
    // 左格 (0+60)/2=30，右格 (120+180)/2=150
    expect(out.data[0]).toBe(30);
    expect(out.data[4]).toBe(150);
    expect(out.data[3]).toBe(255);
  });

  it('透明像素不把颜色渗到相邻像素（预乘）', () => {
    const src = makeFrame(2, 1, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 0, 255, 0]));
    const out = resample(src, 1, 1, 'box');
    expect(out.data[0]).toBe(255);
    expect(out.data[2]).toBe(0);
    expect(out.data[3]).toBe(128);
  });

  it('bilinear 放大在两端之间平滑插值', () => {
    const src = makeFrame(2, 1, (x) => [x * 200, 0, 0]);
    const out = resample(src, 4, 1, 'bilinear');
    const r = [out.data[0], out.data[4], out.data[8], out.data[12]];
    expect(r[0]).toBeLessThanOrEqual(r[1]);
    expect(r[1]).toBeLessThanOrEqual(r[2]);
    expect(r[2]).toBeLessThanOrEqual(r[3]);
    expect(r[0]).toBe(0);
    expect(r[3]).toBe(200);
  });
});
