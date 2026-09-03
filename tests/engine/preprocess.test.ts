import { describe, expect, it } from 'vitest';
import { cellCount, computeFit, fitFrame, pixelate, toGray, applyThresholdBias, srgbToLinear } from '@/engine';
import { makeFrame } from './helpers';

describe('computeFit', () => {
  it('contain 按短边留白', () => {
    expect(computeFit(2000, 1000, 1000, 600, 'contain')).toEqual({ x: 0, y: 50, width: 1000, height: 500 });
  });
  it('cover 按长边裁剪', () => {
    expect(computeFit(2000, 1000, 1000, 600, 'cover')).toEqual({ x: -100, y: 0, width: 1200, height: 600 });
  });
  it('fill 拉伸铺满', () => {
    expect(computeFit(2000, 1000, 1000, 600, 'fill')).toEqual({ x: 0, y: 0, width: 1000, height: 600 });
  });
  it('native 原尺寸居中', () => {
    expect(computeFit(400, 200, 1000, 600, 'native')).toEqual({ x: 300, y: 200, width: 400, height: 200 });
  });
});

describe('fitFrame', () => {
  it('留白区域填白且不透明', () => {
    const src = makeFrame(20, 10, () => [0, 0, 0]);
    const out = fitFrame(src, 20, 20, 'contain');
    expect(out.width).toBe(20);
    expect(out.height).toBe(20);
    // 顶部留白
    expect(Array.from(out.data.slice(0, 4))).toEqual([255, 255, 255, 255]);
    // 中间是图
    const mid = (10 * 20 + 10) * 4;
    expect(Array.from(out.data.slice(mid, mid + 4))).toEqual([0, 0, 0, 255]);
  });
});

describe('pixelate', () => {
  it('cellCount 向上取整并计入偏移', () => {
    expect(cellCount(1000, 4, 0)).toBe(250);
    expect(cellCount(1000, 3, 0)).toBe(334);
    expect(cellCount(1000, 4, 2)).toBe(251);
  });

  it('size=1 无偏移为恒等（转成 0..1）', () => {
    const src = makeFrame(3, 1, (x) => [x * 100, 50, 0]);
    const out = pixelate(src, 1, 'box');
    expect(out.width).toBe(3);
    expect(out.data[3]).toBeCloseTo(100 / 255, 5);
  });

  it('box 4 倍为 4×4 平均', () => {
    const src = makeFrame(8, 4, (x) => [x < 4 ? 0 : 255, 0, 0]);
    const out = pixelate(src, 4, 'box');
    expect(out.width).toBe(2);
    expect(out.height).toBe(1);
    expect(out.data[0]).toBeCloseTo(0, 5);
    expect(out.data[3]).toBeCloseTo(1, 5);
  });

  it('nearest 取格子中心', () => {
    const src = makeFrame(4, 4, (x, y) => [x === 2 && y === 2 ? 255 : 0, 0, 0]);
    const out = pixelate(src, 4, 'nearest');
    expect(out.data[0]).toBeCloseTo(1, 5);
  });
});

describe('toGray', () => {
  it('黑白端点', () => {
    const rgb = { width: 2, height: 1, data: new Float32Array([0, 0, 0, 1, 1, 1]) };
    const g = toGray(rgb, 'bt709', true);
    expect(g.data[0]).toBe(0);
    expect(g.data[1]).toBeCloseTo(1, 5);
  });
  it('线性空间：sRGB 0.5 → 约 0.214', () => {
    const rgb = { width: 1, height: 1, data: new Float32Array([0.5, 0.5, 0.5]) };
    expect(toGray(rgb, 'bt709', true).data[0]).toBeCloseTo(srgbToLinear(0.5), 3);
    expect(toGray(rgb, 'bt709', false).data[0]).toBeCloseTo(0.5, 5);
  });
  it('单通道与最大值', () => {
    const rgb = { width: 1, height: 1, data: new Float32Array([1, 0, 0.3]) };
    expect(toGray(rgb, 'red', false).data[0]).toBeCloseTo(1, 5);
    expect(toGray(rgb, 'green', false).data[0]).toBeCloseTo(0, 5);
    expect(toGray(rgb, 'max', false).data[0]).toBeCloseTo(1, 5);
  });
});

describe('applyThresholdBias', () => {
  it('128 为中性、255 全压暗、0 全提亮', () => {
    const g = { width: 1, height: 1, data: new Float32Array([0.4]) };
    expect(applyThresholdBias(g, 128).data[0]).toBeCloseTo(0.4, 6);
    expect(applyThresholdBias(g, 255).data[0]).toBeCloseTo(0.4 + 0.5 - 255 / 256, 5);
    expect(applyThresholdBias(g, 0).data[0]).toBeCloseTo(0.9, 5);
  });
});
