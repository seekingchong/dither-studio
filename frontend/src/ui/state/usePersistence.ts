import { useEffect, useRef } from 'react';
import { usePlatform } from '@/platform';
import { PRESETS_STORAGE_KEY, SCHEMES_STORAGE_KEY, SETTINGS_STORAGE_KEY, orphanStoredKeys, sanitizeSettings, schemesFromLegacyPresets, useStudioStore, type ThemeSetting } from '@/state';

function applyTheme(theme: ThemeSetting) {
  const root = document.documentElement;
  if (theme === 'system') {
    const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'dark' : 'light';
  } else {
    root.dataset.theme = theme;
  }
}

/**
 * 启动时从平台存储恢复设置、用户预设与历史方案；设置变化时写回；主题落到 <html data-theme>。
 * 预设与方案分开之前只有一份 `presets`（「历史」页列的就是它）：第一次在新版本里启动、
 * 存储里还没有 `schemes` 时，把已有的预设照样搬进「历史」并写回，预设本身原样留着——两边都一条不少。
 * 方案列表读回来之后顺手清一遍应用里的素材存储：没被任何方案引用的文件（删方案时素材还在坑位里用着、
 * 存到一半退出的）都删掉；只有确实读到了方案列表才清，读不到时宁可多留也不误删。
 */
export function usePersistence() {
  const platform = usePlatform();
  const settings = useStudioStore((s) => s.settings);
  const hydrated = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [savedSettings, savedPresets, savedSchemes] = await Promise.all([
        platform.storage.get<unknown>(SETTINGS_STORAGE_KEY).catch(() => null),
        platform.storage.get<unknown>(PRESETS_STORAGE_KEY).catch(() => null),
        platform.storage.get<unknown>(SCHEMES_STORAGE_KEY).catch(() => null),
      ]);
      if (cancelled) return;
      const store = useStudioStore.getState();
      if (savedSettings) store.setSettings(sanitizeSettings(savedSettings));
      if (savedPresets) store.setPresets(savedPresets);
      if (savedSchemes) {
        store.setSchemes(savedSchemes);
      } else {
        const legacy = schemesFromLegacyPresets(useStudioStore.getState().presets);
        if (legacy.length > 0) {
          store.setSchemes(legacy);
          await platform.storage.set(SCHEMES_STORAGE_KEY, legacy).catch(() => undefined);
        }
      }
      hydrated.current = true;
      document.documentElement.dataset.hydrated = 'true';
      const mediaStore = platform.mediaStore;
      if (savedSchemes && mediaStore) {
        try {
          const keys = await mediaStore.list();
          for (const key of orphanStoredKeys(useStudioStore.getState().schemes, keys)) await mediaStore.remove(key);
        } catch {
          // 清不掉不影响使用，下次启动再清
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [platform]);

  useEffect(() => {
    applyTheme(settings.theme);
    if (settings.theme !== 'system' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [settings.theme]);

  useEffect(() => {
    if (!hydrated.current) return;
    void platform.storage.set(SETTINGS_STORAGE_KEY, settings).catch(() => undefined);
  }, [platform, settings]);
}
