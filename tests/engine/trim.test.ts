import { describe, expect, it } from 'vitest';
import { TRIM_MIN_SECONDS, TRIM_SECONDS, trimRange } from '@/ui/media/playback';
import { frameCountFor } from '@/ui/export/video';

describe('视频裁剪窗口', () => {
  it('没拖过两端时走默认窗长 4 秒，起点钳在 [0, 时长 - 窗长]', () => {
    expect(TRIM_SECONDS).toBe(4);
    expect(trimRange(10, 0)).toEqual({ start: 0, end: 4, length: 4, maxStart: 6, minLength: 0.1, maxLength: 10 });
    expect(trimRange(10, 4.5)).toEqual({ start: 4.5, end: 8.5, length: 4, maxStart: 6, minLength: 0.1, maxLength: 10 });
    // 越界的起点贴到两端
    expect(trimRange(10, 9).start).toBe(6);
    expect(trimRange(10, -2).start).toBe(0);
  });

  it('窗长由用户定：给多少用多少，最长整段', () => {
    expect(trimRange(10, 2, 6)).toEqual({ start: 2, end: 8, length: 6, maxStart: 4, minLength: 0.1, maxLength: 10 });
    expect(trimRange(10, 0, 10)).toMatchObject({ start: 0, end: 10, length: 10, maxStart: 0 });
    // 超过整段的窗长收成整段，起点跟着退回 0
    expect(trimRange(10, 3, 99)).toMatchObject({ start: 0, end: 10, length: 10, maxStart: 0 });
    // 窗长撑到剩下的时长以外时，起点先让位（8 起、窗长 6 → 只能从 4 起）
    expect(trimRange(10, 8, 6)).toMatchObject({ start: 4, end: 10, length: 6 });
  });

  it('窗长不短于 TRIM_MIN_SECONDS', () => {
    expect(TRIM_MIN_SECONDS).toBe(0.1);
    expect(trimRange(10, 5, 0).length).toBe(0.1);
    expect(trimRange(10, 5, -3).length).toBe(0.1);
    expect(trimRange(10, 5, 0.05).length).toBe(0.1);
  });

  it('视频短于默认窗长时窗口就是整段，也拖不出比整段更长的窗', () => {
    expect(trimRange(1.5, 0)).toEqual({ start: 0, end: 1.5, length: 1.5, maxStart: 0, minLength: 0.1, maxLength: 1.5 });
    expect(trimRange(1.5, 1).start).toBe(0);
    expect(trimRange(1.5, 0, 4)).toMatchObject({ length: 1.5, maxStart: 0 });
    // 短片子照样能裁出更短的一段
    expect(trimRange(1.5, 0.5, 0.5)).toMatchObject({ start: 0.5, end: 1, length: 0.5, maxStart: 1 });
  });

  it('时长缺失或非法时退化成空窗口，不会算出 NaN', () => {
    expect(trimRange(0, 0)).toEqual({ start: 0, end: 0, length: 0, maxStart: 0, minLength: 0, maxLength: 0 });
    expect(trimRange(-5, 2)).toEqual({ start: 0, end: 0, length: 0, maxStart: 0, minLength: 0, maxLength: 0 });
    expect(trimRange(Number.NaN, 1, 2)).toMatchObject({ start: 0, end: 0, length: 0 });
    expect(trimRange(10, Number.NaN).start).toBe(0);
    expect(trimRange(10, 1, Number.NaN).length).toBe(4);
  });

  it('导出按窗长取帧数：60 fps × 窗长，与整段时长无关', () => {
    expect(frameCountFor(trimRange(30, 12).length)).toBe(240);
    expect(frameCountFor(trimRange(30, 12, 1.5).length)).toBe(90);
    expect(frameCountFor(trimRange(30, 0, 30).length)).toBe(1800);
    expect(frameCountFor(trimRange(1.5, 0).length)).toBe(90);
  });
});
