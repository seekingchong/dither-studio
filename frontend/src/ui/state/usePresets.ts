import { useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { usePlatform } from '@/platform';
import { sanitizeParams } from '@/params';
import {
  PRESETS_STORAGE_KEY,
  builtinPresetParams,
  defaultPresetIdFor,
  findBuiltinPreset,
  newPresetId,
  paramsDiffer,
  presetReferenceParams,
  resolveBase,
  styleOfParams,
  useStudioStore,
  type BuiltinPreset,
  type UserPreset,
} from '@/state';
import type { RenderClient } from '@/engine';
import { useToast } from '@/ui/primitives';
import { useFrameStore, useRenderClient } from '@/ui/renderer/RendererContext';
import { frameToThumbnail } from './thumbnail';

/** 等待渲染结果落定的上限；超时就用手头的帧 */
const THUMBNAIL_SETTLE_MS = 2000;

/**
 * 当前活动坑位的结果缩略图。参数刚改过时 Worker 可能还没渲完，此时先等这一帧回来，
 * 否则存进历史的缩略图会是上一套参数的结果。
 */
async function captureThumbnail(client: RenderClient | null): Promise<string | undefined> {
  const slot = useStudioStore.getState().view.activeSlot;
  // 让参数变化触发的 render() 先排上队
  await new Promise<void>((r) => window.setTimeout(r, 0));
  if (client && !client.isSettled(slot)) {
    await new Promise<void>((resolve) => {
      const done = () => {
        window.clearTimeout(timer);
        off();
        resolve();
      };
      const timer = window.setTimeout(done, THUMBNAIL_SETTLE_MS);
      const off = client.onFrame((frame) => {
        if (frame.slot === slot) done();
      });
    });
  }
  return frameToThumbnail(useFrameStore.getState().frames[slot]);
}

/**
 * 预设：当前方案基于哪个预设、是否已在它基础上改过；应用内置 / 用户预设；
 * 用户预设的保存（带来源与缩略图）、覆盖、重命名、删除与持久化。
 */
export function usePresets() {
  const platform = usePlatform();
  const client = useRenderClient();
  const show = useToast((s) => s.show);
  const { presets, params, activeId } = useStudioStore(useShallow((s) => ({ presets: s.presets, params: s.params, activeId: s.presetId })));

  /** 活动预设本身（内置或用户），以及它的来源内置预设（决定参数范围） */
  const activeUser = useMemo(() => presets.find((p) => p.id === activeId), [presets, activeId]);
  const base = useMemo(() => resolveBase(activeId, presets), [activeId, presets]);
  const activeName = activeUser?.name ?? findBuiltinPreset(activeId)?.name ?? base.name;
  /** 当前方案没微调过时该有的那套参数；「还原」与各分节的「重置」都以它为准 */
  const reference = useMemo(() => presetReferenceParams(activeId, presets), [activeId, presets]);
  // 只看这套方案露出的参数：在另一种风格页签里改过的东西不算这套方案被动过
  const dirty = useMemo(() => paramsDiffer(reference, params, base.exposes), [reference, params, base.exposes]);

  const persist = useCallback(
    async (list: UserPreset[]) => {
      useStudioStore.getState().setPresets(list);
      try {
        await platform.storage.set(PRESETS_STORAGE_KEY, list);
      } catch (err) {
        show(`预设保存失败：${(err as Error).message}`, 'error');
      }
    },
    [platform, show],
  );

  const applyBuiltin = useCallback((preset: BuiltinPreset) => {
    useStudioStore.getState().replaceParams(builtinPresetParams(preset), preset.id);
  }, []);

  const applyUser = useCallback((preset: UserPreset) => {
    useStudioStore.getState().replaceParams(preset.params, preset.id);
  }, []);

  /** 丢掉微调，回到活动预设本身 */
  const revert = useCallback(() => {
    const state = useStudioStore.getState();
    const user = state.presets.find((p) => p.id === state.presetId);
    if (user) applyUser(user);
    else applyBuiltin(findBuiltinPreset(state.presetId) ?? findBuiltinPreset(defaultPresetIdFor(styleOfParams(state.params)))!);
  }, [applyBuiltin, applyUser]);

  /** 把当前方案存成新的用户预设，并切换到它 */
  const save = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const state = useStudioStore.getState();
      const preset: UserPreset = {
        id: newPresetId(),
        name: trimmed.slice(0, 60),
        params: sanitizeParams(state.params),
        createdAt: Date.now(),
        base: resolveBase(state.presetId, state.presets).id,
      };
      const thumbnail = await captureThumbnail(client);
      if (thumbnail) preset.thumbnail = thumbnail;
      await persist([...useStudioStore.getState().presets, preset]);
      useStudioStore.setState({ presetId: preset.id });
      show(`已保存预设「${preset.name}」`);
      return preset;
    },
    [client, persist, show],
  );

  /** 用当前参数覆盖某个用户预设（刷新缩略图与时间） */
  const update = useCallback(
    async (id: string) => {
      const state = useStudioStore.getState();
      const target = state.presets.find((p) => p.id === id);
      if (!target) return;
      const thumbnail = await captureThumbnail(client);
      const next: UserPreset = { ...target, params: sanitizeParams(state.params), updatedAt: Date.now() };
      if (thumbnail) next.thumbnail = thumbnail;
      await persist(useStudioStore.getState().presets.map((p) => (p.id === id ? next : p)));
      useStudioStore.setState({ presetId: id });
      show(`已更新预设「${target.name}」`);
    },
    [client, persist, show],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      await persist(useStudioStore.getState().presets.map((p) => (p.id === id ? { ...p, name: trimmed.slice(0, 60) } : p)));
    },
    [persist],
  );

  /** 删除；正在使用的预设被删掉时，当前参数保留，来源退回它所基于的内置预设 */
  const remove = useCallback(
    async (id: string) => {
      const state = useStudioStore.getState();
      const fallback = state.presetId === id ? resolveBase(id, state.presets).id : null;
      await persist(state.presets.filter((p) => p.id !== id));
      if (fallback) useStudioStore.setState({ presetId: fallback });
    },
    [persist],
  );

  return { presets, activeId, activeUser, activeName, base, reference, dirty, applyBuiltin, applyUser, revert, save, update, rename, remove };
}
