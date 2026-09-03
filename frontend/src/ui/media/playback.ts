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
}

interface PlaybackStore {
  slots: Record<number, PlaybackEntry>;
  update(slot: number, patch: Partial<PlaybackEntry>): void;
  remove(slot: number): void;
}

const DEFAULT_ENTRY: PlaybackEntry = { playing: true, time: 0, duration: 0, previewScale: 1, frameIndex: 0 };

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
