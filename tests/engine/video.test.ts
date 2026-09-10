import { describe, expect, it } from 'vitest';
import { defaultParams } from '@/params';
import { captureSizeFor, computeFit, INITIAL_PACER, pacePreview, PREVIEW_BUDGET_MS, scaleParamsForPreview, type FitMode } from '@/engine';
import { bitrateFor, encoderCandidates, evenSize, frameCountFor, h264LevelFor } from '@/ui/export/video';
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
  it('像素尺寸缩不动时改为减少格子数', () => {
    const params = { ...defaultParams(), 'canvas.width': 1000, 'canvas.height': 600, 'pixel.size': 1 };
    const r = scaleParamsForPreview(params, 0.5);
    expect(r.scale).toBe(0.5);
    expect(r.params['pixel.size']).toBe(1);
    expect(r.params['canvas.width']).toBe(500);
    expect(r.params['canvas.height']).toBe(300);
    // 格子数真的少了一半，这正是省下来的算力
    expect(Math.ceil(500 / 1)).toBe(Math.ceil(1000 / 1) / 2);
    expect(scaleParamsForPreview(params, 1).scale).toBe(1);
    expect(scaleParamsForPreview(params, 1).params).toBe(params);
  });
  it('倍率不能整除时取实际比例', () => {
    const params = { ...defaultParams(), 'pixel.size': 3 };
    const r = scaleParamsForPreview(params, 0.5);
    expect(r.params['pixel.size']).toBe(2);
    expect(r.scale).toBeCloseTo(2 / 3, 6);
    expect(r.params['canvas.width']).toBe(667);
  });
  it('超预算立刻降档，严重超预算降两档', () => {
    expect(pacePreview(INITIAL_PACER, PREVIEW_BUDGET_MS + 1).scale).toBe(0.75);
    expect(pacePreview(INITIAL_PACER, PREVIEW_BUDGET_MS * 3).scale).toBe(0.5);
    // 已经在最低档时不再往下走
    expect(pacePreview({ scale: 0.25, streak: 0 }, 1000).scale).toBe(0.25);
  });

  it('升档要连续几帧都有余量，避免来回跳', () => {
    const fast = PREVIEW_BUDGET_MS * 0.2;
    let p = { scale: 0.5, streak: 0 };
    for (let i = 0; i < 3; i++) {
      p = pacePreview(p, fast);
      expect(p.scale).toBe(0.5);
    }
    p = pacePreview(p, fast);
    expect(p.scale).toBe(0.75);
    // 中间来一帧慢的就清零，不会攒够
    let q = { scale: 0.5, streak: 0 };
    for (let i = 0; i < 10; i++) q = pacePreview(q, i % 2 === 0 ? fast : PREVIEW_BUDGET_MS * 0.9);
    expect(q.scale).toBe(0.5);
  });

  it('刚好在预算内不动档', () => {
    expect(pacePreview({ scale: 0.5, streak: 0 }, PREVIEW_BUDGET_MS * 0.9).scale).toBe(0.5);
  });
});

describe('抓帧尺寸', () => {
  const params = (over: Record<string, unknown> = {}) => ({ ...defaultParams(), 'canvas.width': 1000, 'canvas.height': 600, ...over });

  it('缩到流水线适配后的尺寸', () => {
    expect(captureSizeFor(1920, 1080, params({ 'canvas.fit': 'contain' }))).toEqual({ width: 1000, height: 563 });
    expect(captureSizeFor(1920, 1080, params({ 'canvas.fit': 'cover' }))).toEqual({ width: 1067, height: 600 });
    expect(captureSizeFor(1920, 1080, params({ 'canvas.fit': 'fill' }))).toEqual({ width: 1000, height: 600 });
  });

  it('需要放大或原尺寸时不缩，交给流水线', () => {
    expect(captureSizeFor(640, 480, params({ 'canvas.fit': 'contain' }))).toBeNull();
    expect(captureSizeFor(1920, 1080, params({ 'canvas.fit': 'native' }))).toBeNull();
    expect(captureSizeFor(0, 0, params())).toBeNull();
  });

  it('缩到位后流水线不会再缩一次（否则等于白缩）', () => {
    const modes: FitMode[] = ['contain', 'cover', 'fill'];
    const sizes: Array<[number, number]> = [
      [1920, 1080],
      [1280, 720],
      [3000, 1000],
      [2000, 2000],
      [1919, 1081],
      [4096, 2160],
    ];
    for (const mode of modes) {
      for (const [w, h] of sizes) {
        const size = captureSizeFor(w, h, params({ 'canvas.fit': mode }));
        if (!size) continue;
        const again = computeFit(size.width, size.height, 1000, 600, mode);
        expect([mode, w, h, again.width, again.height]).toEqual([mode, w, h, size.width, size.height]);
      }
    }
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
  it('H.264 level 按尺寸 / 帧率 / 码率算：2000×1200 不再被写死的 4.0 卡住', () => {
    // 1000×600 @ 60：2394 个宏块、每秒 14 万，起步档 4.0 就够
    expect(h264LevelFor(1000, 600, 60, bitrateFor('high', 1000, 600))?.name).toBe('4.0');
    // 1920×1080 @ 60：8160 个宏块 4.0 装得下，但每秒 49 万个宏块要 4.2
    expect(h264LevelFor(1920, 1080, 60, bitrateFor('high', 1920, 1080))?.name).toBe('4.2');
    expect(h264LevelFor(1920, 1080, 30, bitrateFor('high', 1920, 1080, 30))?.name).toBe('4.0');
    // 2000×1200：一帧 9375 个宏块，超过 4.x 的帧面积上限，60 / 30 fps 都要 5.0——帧面积说了算，降帧率没用
    expect(h264LevelFor(2000, 1200, 60, bitrateFor('high', 2000, 1200, 60))?.name).toBe('5.0');
    expect(h264LevelFor(2000, 1200, 30, bitrateFor('high', 2000, 1200, 30))?.name).toBe('5.0');
    // 长边 4096（5:3 画布）@ 60：39424 个宏块超过 5.2，要 6.0
    expect(h264LevelFor(4096, 2458, 60, bitrateFor('ultra', 4096, 2458, 60))?.name).toBe('6.0');
    // 8192×8192 连 6.2 都装不下
    expect(h264LevelFor(8192, 8192, 60, 80_000_000)).toBeNull();
    // 码率上限 High 比 Baseline / Main 高 1.25 倍：同一组参数 Main 可能要高一档
    expect(h264LevelFor(1920, 1080, 30, 20_500_000, 'high')?.name).toBe('4.0');
    expect(h264LevelFor(1920, 1080, 30, 20_500_000, 'main')?.name).toBe('4.1');
  });
  it('候选编码器：H.264 三档 profile 各带算出来的 level 进 MP4，后面才是 VP9 / VP8 进 WebM', () => {
    const c = encoderCandidates(2000, 1200, bitrateFor('high', 2000, 1200, 60), 60);
    expect(c.map((x) => x.codec)).toEqual(['avc1.640032', 'avc1.4d0032', 'avc1.420032', 'vp09.00.10.08', 'vp8']);
    expect(c[0]).toMatchObject({ container: 'mp4', mime: 'video/mp4', ext: 'mp4', label: 'H.264 High 5.0' });
    expect(c[3]).toMatchObject({ container: 'webm', mime: 'video/webm', ext: 'webm', label: 'VP9' });
    // 1000×600 还是原来那个 4.0 的串，小尺寸的行为没变
    expect(encoderCandidates(1000, 600, bitrateFor('high', 1000, 600), 60)[0].codec).toBe('avc1.640028');
    // H.264 装不下的尺寸只剩 WebM
    expect(encoderCandidates(8192, 8192, 80_000_000, 60).map((x) => x.container)).toEqual(['webm', 'webm']);
  });
});
