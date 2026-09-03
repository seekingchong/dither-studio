import { useCallback } from 'react';
import { usePlatform } from '@/platform';
import { defaultParams, sanitizeParams } from '@/params';
import { PRESETS_STORAGE_KEY, newPresetId, useStudioStore, type BuiltinPreset, type UserPreset } from '@/state';
import { useToast } from '@/ui/primitives';

/** 内置预设应用、用户预设增删改与持久化 */
export function usePresets() {
  const platform = usePlatform();
  const show = useToast((s) => s.show);
  const presets = useStudioStore((s) => s.presets);

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
    useStudioStore.getState().replaceParams({ ...defaultParams(), ...preset.params });
  }, []);

  const applyUser = useCallback((preset: UserPreset) => {
    useStudioStore.getState().replaceParams(preset.params);
  }, []);

  const save = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const preset: UserPreset = { id: newPresetId(), name: trimmed.slice(0, 60), params: sanitizeParams(useStudioStore.getState().params), createdAt: Date.now() };
      await persist([...useStudioStore.getState().presets, preset]);
      show(`已保存预设「${preset.name}」`);
      return preset;
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

  const remove = useCallback(
    async (id: string) => {
      await persist(useStudioStore.getState().presets.filter((p) => p.id !== id));
    },
    [persist],
  );

  return { presets, applyBuiltin, applyUser, save, rename, remove };
}
