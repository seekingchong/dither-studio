import { create } from 'zustand';
import { coerceParam, defaultParams, getParamDef, sanitizeParams, type ParamValue, type Params } from '@/params';
import { DEFAULT_SETTINGS, type LoadedMedia, type PreviewTab, type Settings, type Slot, type SlotCount, type ZoomLevel } from './types';

export interface StudioState {
  /** 单一参数对象，不可变更新 */
  params: Params;
  setParam(id: string, value: ParamValue): void;
  setParams(patch: Partial<Params>): void;
  replaceParams(next: unknown): void;
  resetParams(): void;

  slots: Slot[];
  setSlotMedia(index: number, media: LoadedMedia | null): void;

  view: { zoom: ZoomLevel; tab: PreviewTab; activeSlot: number };
  setZoom(zoom: ZoomLevel): void;
  setTab(tab: PreviewTab): void;
  setActiveSlot(index: number): void;

  settings: Settings;
  setSettings(patch: Partial<Settings>): void;
}

function makeSlots(count: SlotCount, previous: Slot[] = []): Slot[] {
  return Array.from({ length: count }, (_, i) => previous[i] ?? { id: i, media: null });
}

export const useStudioStore = create<StudioState>((set) => ({
  params: defaultParams(),
  setParam: (id, value) =>
    set((state) => {
      const def = getParamDef(id);
      const next = coerceParam(def, value);
      if (state.params[id] === next) return state;
      return { params: { ...state.params, [id]: next } };
    }),
  setParams: (patch) =>
    set((state) => {
      const params = { ...state.params };
      for (const [id, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        params[id] = coerceParam(getParamDef(id), value);
      }
      return { params };
    }),
  replaceParams: (next) => set({ params: sanitizeParams(next) }),
  resetParams: () => set({ params: defaultParams() }),

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
  setActiveSlot: (activeSlot) => set((state) => ({ view: { ...state.view, activeSlot } })),

  settings: DEFAULT_SETTINGS,
  setSettings: (patch) =>
    set((state) => {
      const settings = { ...state.settings, ...patch };
      const slots = settings.slotCount !== state.settings.slotCount ? makeSlots(settings.slotCount, state.slots) : state.slots;
      return { settings, slots };
    }),
}));
