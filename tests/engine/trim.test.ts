import { describe, expect, it } from 'vitest';
import { TRIM_SECONDS, trimRange } from '@/ui/media/playback';
import { frameCountFor } from '@/ui/export/video';

describe('视频裁剪窗口', () => {
  it('窗长固定 4 秒，起点钳在 [0, 时长 - 4]', () => {
    expect(TRIM_SECONDS).toBe(4);
    expect(trimRange(10, 0)).toEqual({ start: 0, end: 4, length: 4, maxStart: 6 });
    expect(trimRange(10, 4.5)).toEqual({ start: 4.5, end: 8.5, length: 4, maxStart: 6 });
    // 越界的起点贴到两端
    expect(trimRange(10, 9).start).toBe(6);
    expect(trimRange(10, -2).start).toBe(0);
  });

  it('视频短于 4 秒时窗口就是整段，滑不动', () => {
    expect(trimRange(1.5, 0)).toEqual({ start: 0, end: 1.5, length: 1.5, maxStart: 0 });
    expect(trimRange(1.5, 1).start).toBe(0);
  });

  it('时长缺失或非法时退化成空窗口，不会算出 NaN', () => {
    expect(trimRange(0, 0)).toEqual({ start: 0, end: 0, length: 0, maxStart: 0 });
    expect(trimRange(-5, 2)).toEqual({ start: 0, end: 0, length: 0, maxStart: 0 });
    expect(trimRange(10, Number.NaN).start).toBe(0);
  });

  it('导出按窗长取帧数：4 秒 60 fps = 240 帧，与整段时长无关', () => {
    expect(frameCountFor(trimRange(30, 12).length)).toBe(240);
    expect(frameCountFor(trimRange(1.5, 0).length)).toBe(90);
  });
});
