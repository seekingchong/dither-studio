import { create } from 'zustand';

export interface PlaybackEntry {
  playing: boolean;
  /** 当前时间（秒） */
  time: number;
  duration: number;
  /** 当前预览倍率 */
  previewScale: number;
  /** GIF 当前帧 */
  frameIndex: number;
  /** 视频裁剪窗口的起点（秒）；窗长固定 TRIM_SECONDS，短于它的视频就是整段 */
  trimStart: number;
}

interface PlaybackStore {
  slots: Record<number, PlaybackEntry>;
  update(slot: number, patch: Partial<PlaybackEntry>): void;
  remove(slot: number): void;
}

const DEFAULT_ENTRY: PlaybackEntry = { playing: true, time: 0, duration: 0, previewScale: 1, frameIndex: 0, trimStart: 0 };

/** 动态媒体的播放状态：不进撤销栈、不进预设 */
export const usePlaybackStore = create<PlaybackStore>((set) => ({
  slots: {},
  update: (slot, patch) =>
    set((s) => ({ slots: { ...s.slots, [slot]: { ...(s.slots[slot] ?? DEFAULT_ENTRY), ...patch } } })),
  remove: (slot) =>
    set((s) => {
      if (!(slot in s.slots)) return s;
      const slots = { ...s.slots };
      delete slots[slot];
      return { slots };
    }),
}));

export function playbackOf(slot: number): PlaybackEntry {
  return usePlaybackStore.getState().slots[slot] ?? DEFAULT_ENTRY;
}

/** 视频裁剪窗口的长度（秒），固定值 */
export const TRIM_SECONDS = 4;

export interface TrimRange {
  start: number;
  end: number;
  length: number;
  /** 起点最远能滑到哪；视频不够 TRIM_SECONDS 长时为 0（整段就是全部，滑不动） */
  maxStart: number;
}

/** 起点钳在 [0, duration - 窗长] 里；视频短于窗长时窗口就是整段 */
export function trimRange(duration: number, trimStart: number): TrimRange {
  const total = Math.max(0, duration);
  const length = Math.min(TRIM_SECONDS, total);
  const maxStart = Math.max(0, total - length);
  const start = Math.min(maxStart, Math.max(0, Number.isFinite(trimStart) ? trimStart : 0));
  return { start, end: start + length, length, maxStart };
}

/** 某个坑位当前的裁剪窗口 */
export function trimOf(slot: number): TrimRange {
  const entry = playbackOf(slot);
  return trimRange(entry.duration, entry.trimStart);
}

/** GIF：按累计时长找当前时间落在哪一帧（循环） */
export function gifFrameAt(delays: number[], time: number): number {
  const total = delays.reduce((s, d) => s + d, 0);
  if (total <= 0) return 0;
  let t = ((time % total) + total) % total;
  for (let i = 0; i < delays.length; i++) {
    if (t < delays[i]) return i;
    t -= delays[i];
  }
  return delays.length - 1;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, '0')}`;
}
