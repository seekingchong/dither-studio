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
  /** 视频裁剪窗口的起点（秒） */
  trimStart: number;
  /** 视频裁剪窗口的长度（秒）；null 表示还没动过，走默认窗长 TRIM_SECONDS */
  trimLength: number | null;
}

interface PlaybackStore {
  slots: Record<number, PlaybackEntry>;
  update(slot: number, patch: Partial<PlaybackEntry>): void;
  remove(slot: number): void;
}

const DEFAULT_ENTRY: PlaybackEntry = { playing: true, time: 0, duration: 0, previewScale: 1, frameIndex: 0, trimStart: 0, trimLength: null };

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

/** 刚载入的视频默认裁多长（秒）；比这短的视频默认就是整段 */
export const TRIM_SECONDS = 4;

/** 窗口最短能拖到多少秒；整段比它还短时窗口就是整段 */
export const TRIM_MIN_SECONDS = 0.1;

export interface TrimRange {
  start: number;
  end: number;
  length: number;
  /** 保持当前窗长时，起点最远能滑到哪（= 整段 − 窗长） */
  maxStart: number;
  /** 窗长的下限：TRIM_MIN_SECONDS，整段更短时就是整段 */
  minLength: number;
  /** 窗长的上限：整段时长 */
  maxLength: number;
}

/**
 * 裁剪窗口：窗长先钳进 [minLength, 整段]，起点再钳进 [0, 整段 − 窗长]。
 * `trimLength` 为 null（还没拖过两端）时走默认窗长，视频短于它就是整段。
 */
export function trimRange(duration: number, trimStart: number, trimLength: number | null = null): TrimRange {
  const total = Math.max(0, Number.isFinite(duration) ? duration : 0);
  const minLength = Math.min(TRIM_MIN_SECONDS, total);
  const wanted = trimLength != null && Number.isFinite(trimLength) ? trimLength : TRIM_SECONDS;
  const length = Math.min(total, Math.max(minLength, wanted));
  const maxStart = Math.max(0, total - length);
  const start = Math.min(maxStart, Math.max(0, Number.isFinite(trimStart) ? trimStart : 0));
  return { start, end: start + length, length, maxStart, minLength, maxLength: total };
}

/** 某个坑位当前的裁剪窗口 */
export function trimOf(slot: number): TrimRange {
  const entry = playbackOf(slot);
  return trimRange(entry.duration, entry.trimStart, entry.trimLength);
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
