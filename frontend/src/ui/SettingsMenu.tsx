import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStudioStore, type SlotCount } from '@/state';
import { IconButton, Select, ToggleField } from '@/ui/primitives';

/** 顶栏齿轮：全局设置弹层（坑位数、GPU 加速） */
export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { settings, setSettings } = useStudioStore(useShallow((s) => ({ settings: s.settings, setSettings: s.setSettings })));

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="settings" ref={ref}>
      <IconButton icon="settings" label="设置" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid="settings-button" />
      {open && (
        <div className="settings__menu" role="dialog" aria-label="设置" data-testid="settings-menu">
          <Select
            label="坑位"
            value={String(settings.slotCount)}
            options={[
              { value: '1', label: '1 个媒体' },
              { value: '4', label: '4 个媒体' },
            ]}
            onChange={(v) => setSettings({ slotCount: Number(v) as SlotCount })}
            data-param="settings.slotCount"
          />
          <ToggleField label="GPU 加速" value={settings.gpu} onChange={(v) => setSettings({ gpu: v })} data-param="settings.gpu" />
        </div>
      )}
    </div>
  );
}
