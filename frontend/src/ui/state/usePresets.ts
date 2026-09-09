import { useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { usePlatform } from '@/platform';
import { sanitizeParams, styleOf } from '@/params';
import {
  PRESETS_STORAGE_KEY,
  builtinPresetParams,
  copyPresetName,
  defaultPresetIdFor,
  findBuiltinPreset,
  newPresetId,
  paramsDiffer,
  presetReferenceParams,
  resolveBase,
  useStudioStore,
  type BuiltinPreset,
  type UserPreset,
} from '@/state';
import { useToast } from '@/ui/primitives';

/**
 * 预设 = 一套参数，不绑素材（素材 + 参数的组合是「历史」里的方案，见 useSchemes）。
 * 这里管：当前参数基于哪个预设、是否已在它基础上改过；应用内置 / 用户预设；
 * 用户预设的保存（带来源）、覆盖、重命名、复制、星标、删除与持久化。
 */
export function usePresets() {
  const platform = usePlatform();
  const show = useToast((s) => s.show);
  const { presets, params, activeId } = useStudioStore(useShallow((s) => ({ presets: s.presets, params: s.params, activeId: s.presetId })));

  /** 活动预设本身（内置或用户），以及它的来源内置预设（决定参数范围） */
  const activeUser = useMemo(() => presets.find((p) => p.id === activeId), [presets, activeId]);
  const base = useMemo(() => resolveBase(activeId, presets), [activeId, presets]);
  const activeName = activeUser?.name ?? findBuiltinPreset(activeId)?.name ?? base.name;
  /** 当前参数没微调过时该有的那套；「还原」与各分节的「重置」都以它为准 */
  const reference = useMemo(() => presetReferenceParams(activeId, presets), [activeId, presets]);
  // 只看当前风格看得见的参数：在别的风格页签里改过的东西不算这套预设被动过
  const dirty = useMemo(() => paramsDiffer(reference, params, styleOf(params)), [reference, params]);

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
    else applyBuiltin(findBuiltinPreset(state.presetId) ?? findBuiltinPreset(defaultPresetIdFor(styleOf(state.params)))!);
  }, [applyBuiltin, applyUser]);

  /** 把当前参数存成新的用户预设，并切换到它。预设不绑素材，所以不带缩略图 */
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
      await persist([...useStudioStore.getState().presets, preset]);
      useStudioStore.setState({ presetId: preset.id });
      show(`已保存预设「${preset.name}」`);
      return preset;
    },
    [persist, show],
  );

  /** 用当前参数覆盖某个用户预设（刷新时间） */
  const update = useCallback(
    async (id: string) => {
      const state = useStudioStore.getState();
      const target = state.presets.find((p) => p.id === id);
      if (!target) return;
      const next: UserPreset = { ...target, params: sanitizeParams(state.params), updatedAt: Date.now() };
      // 旧版存过的缩略图是某张素材上的结果，预设本身不绑素材，覆盖时顺手清掉
      delete next.thumbnail;
      await persist(useStudioStore.getState().presets.map((p) => (p.id === id ? next : p)));
      useStudioStore.setState({ presetId: id });
      show(`已更新预设「${target.name}」`);
    },
    [persist, show],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      await persist(useStudioStore.getState().presets.map((p) => (p.id === id ? { ...p, name: trimmed.slice(0, 60) } : p)));
    },
    [persist],
  );

  /** 复制一份：同样的参数与来源，名字是「原名 副本」；当前用哪套预设不变 */
  const duplicate = useCallback(
    async (id: string) => {
      const list = useStudioStore.getState().presets;
      const source = list.find((p) => p.id === id);
      if (!source) return null;
      const copy: UserPreset = {
        ...source,
        id: newPresetId(),
        name: copyPresetName(source.name, list.map((p) => p.name)),
        createdAt: Date.now(),
        starred: false,
      };
      delete copy.updatedAt;
      // 排在原件后面，免得副本跑到列表另一头去找
      const at = list.findIndex((p) => p.id === id);
      await persist([...list.slice(0, at + 1), copy, ...list.slice(at + 1)]);
      show(`已复制为「${copy.name}」`);
      return copy;
    },
    [persist, show],
  );

  /** 星标开关：星标过的排在「我的预设」最前面 */
  const toggleStar = useCallback(
    async (id: string) => {
      await persist(useStudioStore.getState().presets.map((p) => (p.id === id ? { ...p, starred: !p.starred } : p)));
    },
    [persist],
  );

  /** 删除；正在使用的预设被删掉时，当前参数保留，来源退回它所基于的内置预设。基于它存的方案不受影响 */
  const remove = useCallback(
    async (id: string) => {
      const state = useStudioStore.getState();
      const fallback = state.presetId === id ? resolveBase(id, state.presets).id : null;
      await persist(state.presets.filter((p) => p.id !== id));
      if (fallback) useStudioStore.setState({ presetId: fallback });
    },
    [persist],
  );

  return { presets, activeId, activeUser, activeName, base, reference, dirty, applyBuiltin, applyUser, revert, save, update, rename, duplicate, toggleStar, remove };
}
