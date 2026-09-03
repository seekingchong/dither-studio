import { useEffect, useRef } from 'react';
import { usePlatform } from '@/platform';
import { PRESETS_STORAGE_KEY, SETTINGS_STORAGE_KEY, sanitizeSettings, useStudioStore, type ThemeSetting } from '@/state';

function applyTheme(theme: ThemeSetting) {
  const root = document.documentElement;
  if (theme === 'system') {
    const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'dark' : 'light';
  } else {
    root.dataset.theme = theme;
  }
}

/** 启动时从平台存储恢复设置与用户预设；设置变化时写回；主题落到 <html data-theme> */
export function usePersistence() {
  const platform = usePlatform();
  const settings = useStudioStore((s) => s.settings);
  const hydrated = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [savedSettings, savedPresets] = await Promise.all([
        platform.storage.get<unknown>(SETTINGS_STORAGE_KEY).catch(() => null),
        platform.storage.get<unknown>(PRESETS_STORAGE_KEY).catch(() => null),
      ]);
      if (cancelled) return;
      const store = useStudioStore.getState();
      if (savedSettings) store.setSettings(sanitizeSettings(savedSettings));
      if (savedPresets) store.setPresets(savedPresets);
      hydrated.current = true;
      document.documentElement.dataset.hydrated = 'true';
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
