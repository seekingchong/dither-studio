import { describe, expect, it } from 'vitest';
import { defaultParams } from '@/params';
import { nextPreviewScale, scaleParamsForPreview } from '@/engine';
import { bitrateFor, evenSize, frameCountFor } from '@/ui/export/video';
import { formatTime, gifFrameAt } from '@/ui/media/playback';

describe('预览降分辨率', () => {
  it('画布与像素尺寸同比缩小，格子数不变', () => {
    const params = { ...defaultParams(), 'canvas.width': 1000, 'canvas.height': 600, 'pixel.size': 4, 'grid.gapX': 2, 'tone.blur': 8 };
    const { params: p, scale } = scaleParamsForPreview(params, 0.5);
    expect(scale).toBe(0.5);
    expect(p['canvas.width']).toBe(500);
    expect(p['canvas.height']).toBe(300);
    expect(p['pixel.size']).toBe(2);
    expect(p['grid.gapX']).toBe(1);
    expect(p['tone.blur']).toBe(4);
    expect(Math.ceil(1000 / 4)).toBe(Math.ceil(500 / 2));
  });
  it('像素尺寸 1 时无法再缩，倍率回到 1', () => {
    const params = { ...defaultParams(), 'pixel.size': 1 };
    const r = scaleParamsForPreview(params, 0.5);
    expect(r.scale).toBe(1);
    expect(r.params).toBe(params);
    expect(scaleParamsForPreview(params, 1).scale).toBe(1);
  });
  it('倍率不能整除时取实际比例', () => {
    const params = { ...defaultParams(), 'pixel.size': 3 };
    const r = scaleParamsForPreview(params, 0.5);
    expect(r.params['pixel.size']).toBe(2);
    expect(r.scale).toBeCloseTo(2 / 3, 6);
    expect(r.params['canvas.width']).toBe(667);
  });
  it('按耗时升降倍率', () => {
    expect(nextPreviewScale(1, 500)).toBe(0.25);
    expect(nextPreviewScale(1, 200)).toBe(0.5);
    expect(nextPreviewScale(0.5, 200)).toBe(0.5);
    expect(nextPreviewScale(0.25, 20)).toBe(0.5);
    expect(nextPreviewScale(0.5, 20)).toBe(1);
    expect(nextPreviewScale(0.5, 80)).toBe(0.5);
  });
});

describe('播放与导出辅助', () => {
  it('GIF 按累计时长找帧并循环', () => {
    const delays = [0.1, 0.2, 0.3];
    expect(gifFrameAt(delays, 0)).toBe(0);
    expect(gifFrameAt(delays, 0.15)).toBe(1);
    expect(gifFrameAt(delays, 0.35)).toBe(2);
    expect(gifFrameAt(delays, 0.65)).toBe(0);
    expect(gifFrameAt([], 1)).toBe(0);
  });
  it('时间格式', () => {
    expect(formatTime(0)).toBe('0:00.0');
    expect(formatTime(65.25)).toBe('1:05.3');
  });
  it('60 fps 帧数、偶数尺寸、码率随像素数缩放', () => {
    expect(frameCountFor(1)).toBe(60);
    expect(frameCountFor(0.016)).toBe(1);
    expect(frameCountFor(2.5)).toBe(150);
    expect(evenSize(1001)).toBe(1000);
    expect(evenSize(1)).toBe(2);
    expect(bitrateFor('medium', 1000, 600)).toBe(6_000_000);
    expect(bitrateFor('high', 1000, 600)).toBe(12_000_000);
    expect(bitrateFor('ultra', 1000, 600)).toBe(24_000_000);
    expect(bitrateFor('high', 2000, 1200)).toBe(48_000_000);
    expect(bitrateFor('medium', 100, 60)).toBe(500_000);
  });
});
