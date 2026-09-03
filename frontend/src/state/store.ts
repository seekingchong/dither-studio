import { create } from 'zustand';
import { coerceParam, defaultParams, getParamDef, sanitizeParams, type ParamValue, type Params } from '@/params';
import { sanitizeUserPresets, type UserPreset } from './presets';
import { DEFAULT_SETTINGS, type LoadedMedia, type PreviewTab, type Settings, type Slot, type SlotCount, type ZoomLevel } from './types';

/** 同一参数连续变化在此间隔内合并成一条撤销记录（滑块拖动） */
export const HISTORY_COALESCE_MS = 800;
export const HISTORY_LIMIT = 100;

export interface StudioState {
  /** 单一参数对象，不可变更新 */
  params: Params;
  setParam(id: string, value: ParamValue): void;
  setParams(patch: Partial<Params>): void;
  replaceParams(next: unknown): void;
  resetParams(): void;

  history: { past: Params[]; future: Params[]; lastEditId: string | null; lastEditAt: number };
  undo(): void;
  redo(): void;

  slots: Slot[];
  setSlotMedia(index: number, media: LoadedMedia | null): void;

  view: { zoom: ZoomLevel; tab: PreviewTab; activeSlot: number; autoPixelSize: boolean };
  setZoom(zoom: ZoomLevel): void;
  setTab(tab: PreviewTab): void;
  setActiveSlot(index: number): void;
  /** 载入媒体时按输入分辨率建议像素尺寸；用户手动改过就不再覆盖 */
  applySuggestedPixelSize(size: number): void;

  settings: Settings;
  setSettings(patch: Partial<Settings>): void;

  presets: UserPreset[];
  setPresets(list: unknown): void;
}

function makeSlots(count: SlotCount, previous: Slot[] = []): Slot[] {
  return Array.from({ length: count }, (_, i) => previous[i] ?? { id: i, media: null });
}

type HistoryState = StudioState['history'];

/** 把当前参数压入撤销栈；同一参数短时间内连续变化只记一次 */
function pushHistory(history: HistoryState, current: Params, editId: string | null, now: number): HistoryState {
  const coalesce = editId !== null && history.lastEditId === editId && now - history.lastEditAt < HISTORY_COALESCE_MS && history.past.length > 0;
  if (coalesce) return { ...history, lastEditAt: now, future: [] };
  const past = history.past.length >= HISTORY_LIMIT ? history.past.slice(1) : history.past.slice();
  past.push(current);
  return { past, future: [], lastEditId: editId, lastEditAt: now };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const useStudioStore = create<StudioState>((set) => ({
  params: defaultParams(),
  setParam: (id, value) =>
    set((state) => {
      const def = getParamDef(id);
      const next = coerceParam(def, value);
      if (state.params[id] === next) return state;
      const view = id === 'pixel.size' && state.view.autoPixelSize ? { ...state.view, autoPixelSize: false } : state.view;
      return { params: { ...state.params, [id]: next }, view, history: pushHistory(state.history, state.params, id, now()) };
    }),
  setParams: (patch) =>
    set((state) => {
      const params = { ...state.params };
      let changed = false;
      for (const [id, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        const next = coerceParam(getParamDef(id), value);
        if (params[id] !== next) {
          params[id] = next;
          changed = true;
        }
      }
      if (!changed) return state;
      return { params, history: pushHistory(state.history, state.params, null, now()) };
    }),
  replaceParams: (next) =>
    set((state) => {
      const params = sanitizeParams(next);
      const view = 'pixel.size' in ((next ?? {}) as object) ? { ...state.view, autoPixelSize: false } : state.view;
      return { params, view, history: pushHistory(state.history, state.params, null, now()) };
    }),
  resetParams: () =>
    set((state) => ({ params: defaultParams(), view: { ...state.view, autoPixelSize: true }, history: pushHistory(state.history, state.params, null, now()) })),

  history: { past: [], future: [], lastEditId: null, lastEditAt: 0 },
  undo: () =>
    set((state) => {
      const past = state.history.past.slice();
      const previous = past.pop();
      if (!previous) return state;
      return { params: previous, history: { past, future: [state.params, ...state.history.future], lastEditId: null, lastEditAt: 0 } };
    }),
  redo: () =>
    set((state) => {
      const [next, ...future] = state.history.future;
      if (!next) return state;
      return { params: next, history: { past: [...state.history.past, state.params], future, lastEditId: null, lastEditAt: 0 } };
    }),

  slots: makeSlots(DEFAULT_SETTINGS.slotCount),
  setSlotMedia: (index, media) =>
    set((state) => {
      if (index < 0 || index >= state.slots.length) return state;
      const slots = state.slots.slice();
      slots[index] = { ...slots[index], media };
      return { slots };
    }),

  view: { zoom: 'fit', tab: 'result', activeSlot: 0, autoPixelSize: true },
  setZoom: (zoom) => set((state) => ({ view: { ...state.view, zoom } })),
  setTab: (tab) => set((state) => ({ view: { ...state.view, tab } })),
  setActiveSlot: (activeSlot) => set((state) => (state.view.activeSlot === activeSlot ? state : { view: { ...state.view, activeSlot } })),
  applySuggestedPixelSize: (size) =>
    set((state) => {
      if (!state.view.autoPixelSize) return state;
      const next = coerceParam(getParamDef('pixel.size'), size);
      if (state.params['pixel.size'] === next) return state;
      // 自动建议不进撤销栈
      return { params: { ...state.params, 'pixel.size': next } };
    }),

  settings: DEFAULT_SETTINGS,
  setSettings: (patch) =>
    set((state) => {
      const settings = { ...state.settings, ...patch };
      const slots = settings.slotCount !== state.settings.slotCount ? makeSlots(settings.slotCount, state.slots) : state.slots;
      const view = state.view.activeSlot >= slots.length ? { ...state.view, activeSlot: 0 } : state.view;
      return { settings, slots, view };
    }),

  presets: [],
  setPresets: (list) => set({ presets: sanitizeUserPresets(list) }),
}));
