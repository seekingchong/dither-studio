import { describe, expect, it } from 'vitest';
import { defaultParams } from '@/params';
import { cellCount, parseStack, renderImage, resample, serializeStack } from '@/engine';
import { makeFrame } from './helpers';
import {
  MAX_EXPORT_SIDE,
  canvasSizeOf,
  clampScale,
  evenSize,
  scaleOptionsFor,
  scaleParamsForSize,
  sizeForHeight,
  sizeForScale,
  sizeForWidth,
} from '@/ui/export/resolution';
import { bitrateFor, frameCountFor } from '@/ui/export/video';

const CANVAS = { width: 1000, height: 600 };

describe('导出分辨率', () => {
  it('倍率就是画布尺寸乘倍率，宽高都取偶数', () => {
    expect(sizeForScale(CANVAS, 1)).toEqual({ width: 1000, height: 600 });
    expect(sizeForScale(CANVAS, 2)).toEqual({ width: 2000, height: 1200 });
    expect(sizeForScale(CANVAS, 0.5)).toEqual({ width: 500, height: 300 });
    // 1001 × 601 的画布：0.5× 后是 500.5 × 300.5，取到偶数
    expect(sizeForScale({ width: 1001, height: 601 }, 0.5)).toEqual({ width: 500, height: 300 });
    expect(evenSize(1001)).toBe(1000);
    expect(evenSize(1)).toBe(2);
  });

  it('始终等比：给宽给高都能推出同一个尺寸', () => {
    expect(sizeForWidth(CANVAS, 2000)).toEqual({ width: 2000, height: 1200 });
    expect(sizeForHeight(CANVAS, 1200)).toEqual({ width: 2000, height: 1200 });
    const odd = sizeForWidth(CANVAS, 1234);
    expect(odd.width / odd.height).toBeCloseTo(1000 / 600, 2);
  });

  it('长边顶到上限就不再往上，1× 永远拿得到原尺寸', () => {
    expect(sizeForWidth(CANVAS, 99_999).width).toBe(MAX_EXPORT_SIDE);
    expect(clampScale(CANVAS, 100)).toBeCloseTo(MAX_EXPORT_SIDE / 1000, 6);
    // 画布本身就超过上限时，1× 仍然是原尺寸，不悄悄缩水
    const huge = { width: 6000, height: 3000 };
    expect(sizeForScale(huge, 1)).toEqual(huge);
    expect(scaleOptionsFor(huge).map((o) => o.value)).toEqual(['0.25', '0.5', '0.75', '1']);
    expect(scaleOptionsFor(CANVAS).map((o) => o.value)).toEqual(['0.25', '0.5', '0.75', '1', '1.5', '2', '3', '4']);
  });
});

describe('按导出尺寸重排参数', () => {
  const params = (over: Record<string, unknown> = {}) => ({ ...defaultParams(), 'canvas.width': 1000, 'canvas.height': 600, ...over });

  it('画布钉到目标尺寸，格子跟着放大，格子数不变', () => {
    const p = scaleParamsForSize(params({ 'pixel.size': 4, 'grid.gapX': 2, 'grid.gapY': 2 }), { width: 2000, height: 1200 });
    expect(p['canvas.width']).toBe(2000);
    expect(p['canvas.height']).toBe(1200);
    expect(p['pixel.size']).toBe(8);
    expect(p['grid.gapX']).toBe(4);
    // 每边的格子数与 1× 时一致——放大的是每个格子占的像素，不是图案的密度
    expect(cellCount(2000, 8, 0)).toBe(cellCount(1000, 4, 0));
    expect(cellCount(1200, 8, 0)).toBe(cellCount(600, 4, 0));
  });

  it('排线 / 网点 / 符号的间距同样跟着走', () => {
    const p = scaleParamsForSize(params({ 'hatch.spacingX': 14, 'hatch.spacingY': 14, 'screen.pitchX': 12, 'tile.pitchY': 12, 'tone.blur': 8 }), {
      width: 500,
      height: 300,
    });
    expect(p['hatch.spacingX']).toBe(7);
    expect(p['screen.pitchX']).toBe(6);
    expect(p['tile.pitchY']).toBe(6);
    expect(p['tone.blur']).toBe(4);
    // 缩到底也不能小于参数表的下限
    const tiny = scaleParamsForSize(params({ 'hatch.spacingX': 3, 'pixel.size': 1, 'grid.lineWidth': 1 }), { width: 100, height: 60 });
    expect(tiny['hatch.spacingX']).toBe(3);
    expect(tiny['pixel.size']).toBe(1);
    expect(tiny['grid.lineWidth']).toBe(1);
  });

  it('特效里标了 px 的子参数也一起缩', () => {
    const stack = serializeStack([{ type: 'scanlines', enabled: true, params: { period: 3, darkness: 40, phosphor: 0, curvature: 0 } }]);
    const p = scaleParamsForSize(params({ 'effects.stack': stack }), { width: 2000, height: 1200 });
    const scaled = parseStack(p['effects.stack']);
    expect(scaled[0].params.period).toBe(6);
    // 百分比那种不是画布上的尺寸，原样不动
    expect(scaled[0].params.darkness).toBe(40);
  });

  it('1× 只把画布取偶，其余参数一个不动', () => {
    const src = params({ 'pixel.size': 5, 'tone.blur': 3 });
    const p = scaleParamsForSize(src, { width: 1000, height: 600 });
    expect(p['pixel.size']).toBe(5);
    expect(p['tone.blur']).toBe(3);
    expect(canvasSizeOf(p)).toEqual({ width: 1000, height: 600 });
  });
});

describe('导出帧率', () => {
  it('帧数按选定帧率算', () => {
    expect(frameCountFor(2)).toBe(120);
    expect(frameCountFor(2, 60)).toBe(120);
    expect(frameCountFor(2, 30)).toBe(60);
    expect(frameCountFor(0.01, 30)).toBe(1);
  });

  it('码率随像素数与帧率缩放', () => {
    expect(bitrateFor('high', 1000, 600, 60)).toBe(12_000_000);
    expect(bitrateFor('high', 1000, 600, 30)).toBe(6_000_000);
    expect(bitrateFor('high', 2000, 1200, 30)).toBe(24_000_000);
    // 下限仍然兜着
    expect(bitrateFor('medium', 100, 60, 30)).toBe(500_000);
  });
});

/** 两帧逐通道的平均绝对差（0–255） */
function meanDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

describe('放大导出与 1× 是同一张画', () => {
  const source = () => makeFrame(200, 120, (x, y) => [((x * 255) / 199) | 0, ((y * 255) / 119) | 0, 128, 255]);

  // 缩回原尺寸后与 1× 几乎逐像素相同（差的那一点来自源帧重采样），证明放大是"同一张画、像素更多"
  for (const style of ['dither', 'hatch', 'halftone', 'glyph']) {
    it(`${style}：2× 缩回来还是 1×`, () => {
      const src = source();
      const base = { ...defaultParams(), 'style.type': style, 'canvas.width': 200, 'canvas.height': 120, 'canvas.fit': 'fill' };
      const one = renderImage(src, base);
      const two = renderImage(src, scaleParamsForSize(base, { width: 400, height: 240 }));
      expect([two.width, two.height]).toEqual([400, 240]);
      expect(meanDiff(one.data, resample(two, 200, 120, 'box').data)).toBeLessThan(5);
    });
  }

  it('倍率不是整数也一样：1.5× 的格子数与 1× 相同', () => {
    const src = source();
    const base = { ...defaultParams(), 'canvas.width': 200, 'canvas.height': 120, 'canvas.fit': 'fill', 'pixel.size': 4 };
    const scaled = scaleParamsForSize(base, { width: 300, height: 180 });
    expect(scaled['pixel.size']).toBe(6);
    expect(cellCount(300, 6, 0)).toBe(cellCount(200, 4, 0));
    const out = renderImage(src, scaled);
    expect([out.width, out.height]).toEqual([300, 180]);
    expect(meanDiff(renderImage(src, base).data, resample(out, 200, 120, 'box').data)).toBeLessThan(12);
  });
});
