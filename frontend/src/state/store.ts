import { create } from 'zustand';
import { coerceParam, defaultParams, getParamDef, sanitizeParams, styleOf, type ParamValue, type Params, type StyleKind } from '@/params';
import { DEFAULT_PRESET_ID, defaultPresetIdFor, presetStyleById, sanitizeUserPresets, type UserPreset } from './presets';
import { DEFAULT_SETTINGS, type LoadedMedia, type PreviewTab, type Settings, type Slot, type SlotCount, type ZoomLevel } from './types';

/** 同一参数连续变化在此间隔内合并成一条撤销记录（滑块拖动） */
export const HISTORY_COALESCE_MS = 800;
export const HISTORY_LIMIT = 100;

/** 撤销栈里的一条记录：参数 + 当时所基于的预设 */
export interface Snapshot {
  params: Params;
  presetId: string;
}

export interface StudioState {
  /** 单一参数对象，不可变更新 */
  params: Params;
  /** 当前方案所基于的预设（内置或用户预设 id）；微调参数不改变它，重新选预设才改变 */
  presetId: string;
  setParam(id: string, value: ParamValue): void;
  setParams(patch: Partial<Params>): void;
  /** 整体替换参数；传 presetId 表示这是在应用某个预设 */
  replaceParams(next: unknown, presetId?: string): void;
  resetParams(): void;
  /**
   * 切风格页签（抖动 / 排线 / 网点）。只改 `style.type`，各风格的参数都留着；
   * 当前方案不属于新风格时，退回这种风格上次用的方案（没有就是它的「默认」）。
   */
  setStyle(kind: StyleKind): void;
  /** 每种风格最近一次用的预设 id，切页签回来时接着用；不进撤销栈 */
  lastPresetByStyle: Partial<Record<StyleKind, string>>;

  history: { past: Snapshot[]; future: Snapshot[]; lastEditId: string | null; lastEditAt: number };
  undo(): void;
  redo(): void;

  slots: Slot[];
  setSlotMedia(index: number, media: LoadedMedia | null): void;

  view: { zoom: ZoomLevel; tab: PreviewTab; activeSlot: number };
  setZoom(zoom: ZoomLevel): void;
  setTab(tab: PreviewTab): void;
  setActiveSlot(index: number): void;

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
function pushHistory(history: HistoryState, current: Snapshot, editId: string | null, now: number): HistoryState {
  const coalesce = editId !== null && history.lastEditId === editId && now - history.lastEditAt < HISTORY_COALESCE_MS && history.past.length > 0;
  if (coalesce) return { ...history, lastEditAt: now, future: [] };
  const past = history.past.length >= HISTORY_LIMIT ? history.past.slice(1) : history.past.slice();
  past.push(current);
  return { past, future: [], lastEditId: editId, lastEditAt: now };
}

const snapshot = (state: Pick<StudioState, 'params' | 'presetId'>): Snapshot => ({ params: state.params, presetId: state.presetId });

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const useStudioStore = create<StudioState>((set) => ({
  params: defaultParams(),
  presetId: DEFAULT_PRESET_ID,
  setParam: (id, value) =>
    set((state) => {
      const def = getParamDef(id);
      const next = coerceParam(def, value);
      if (state.params[id] === next) return state;
      return { params: { ...state.params, [id]: next }, history: pushHistory(state.history, snapshot(state), id, now()) };
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
      return { params, history: pushHistory(state.history, snapshot(state), null, now()) };
    }),
  replaceParams: (next, presetId) =>
    set((state) => {
      const params = sanitizeParams(next);
      return { params, presetId: presetId ?? state.presetId, history: pushHistory(state.history, snapshot(state), null, now()) };
    }),
  resetParams: () =>
    set((state) => ({
      params: defaultParams(),
      presetId: DEFAULT_PRESET_ID,
      history: pushHistory(state.history, snapshot(state), null, now()),
    })),
  setStyle: (kind) =>
    set((state) => {
      const current = styleOf(state.params);
      if (current === kind) return state;
      const lastPresetByStyle = { ...state.lastPresetByStyle, [current]: state.presetId };
      const remembered = lastPresetByStyle[kind];
      const presetId = remembered && presetStyleById(remembered, state.presets) === kind ? remembered : defaultPresetIdFor(kind);
      return {
        params: { ...state.params, 'style.type': kind },
        presetId,
        lastPresetByStyle,
        history: pushHistory(state.history, snapshot(state), null, now()),
      };
    }),
  lastPresetByStyle: {},

  history: { past: [], future: [], lastEditId: null, lastEditAt: 0 },
  undo: () =>
    set((state) => {
      const past = state.history.past.slice();
      const previous = past.pop();
      if (!previous) return state;
      return { ...previous, history: { past, future: [snapshot(state), ...state.history.future], lastEditId: null, lastEditAt: 0 } };
    }),
  redo: () =>
    set((state) => {
      const [next, ...future] = state.history.future;
      if (!next) return state;
      return { ...next, history: { past: [...state.history.past, snapshot(state)], future, lastEditId: null, lastEditAt: 0 } };
    }),

  slots: makeSlots(DEFAULT_SETTINGS.slotCount),
  setSlotMedia: (index, media) =>
    set((state) => {
      if (index < 0 || index >= state.slots.length) return state;
      const slots = state.slots.slice();
      slots[index] = { ...slots[index], media };
      return { slots };
    }),

  view: { zoom: 'fit', tab: 'result', activeSlot: 0 },
  setZoom: (zoom) => set((state) => ({ view: { ...state.view, zoom } })),
  setTab: (tab) => set((state) => ({ view: { ...state.view, tab } })),
  setActiveSlot: (activeSlot) => set((state) => (state.view.activeSlot === activeSlot ? state : { view: { ...state.view, activeSlot } })),

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
