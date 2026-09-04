import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, IconButton } from '@/ui/primitives';
import { usePresets } from '@/ui/state/usePresets';

/** 预填的名字：当前方案名 + 「副本」，重名就往后排号 */
function defaultPresetName(base: string, taken: Set<string>): string {
  const stem = `${base} 副本`;
  if (!taken.has(stem)) return stem;
  for (let i = 2; i < 1000; i++) if (!taken.has(`${stem} ${i}`)) return `${stem} ${i}`;
  return `${stem} ${Date.now()}`;
}

/**
 * 左栏操作行右端的两个预设动作：「还原」（丢掉微调，只有图标）与「保存预设」。
 * 保存不再在预设模块里摆一整行输入框——点「保存预设」弹一个浮层，名字已经预填好，
 * 直接回车就存下；当前方案本身就是我的预设时，浮层里还能覆盖更新它。
 */
export function PresetActions() {
  const { presets, activeUser, activeName, dirty, revert, save, update } = usePresets();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const takenNames = useMemo(() => new Set(presets.map((p) => p.name)), [presets]);

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

  // 每次打开都重新预填并选中，改过再关掉不会留下上次的残稿
  const toggle = () => {
    setOpen((was) => {
      if (!was) setName(defaultPresetName(activeName, takenNames));
      return !was;
    });
  };

  useEffect(() => {
    if (open) inputRef.current?.select();
  }, [open]);

  const submit = async () => {
    if (!name.trim()) return;
    await save(name);
    setOpen(false);
  };

  return (
    <div className="preset-actions" ref={ref}>
      {/* 没微调过就没有可丢的东西，按钮留在原地置灰，免得这一行的按钮位置来回跳 */}
      <IconButton icon="undo" label="还原" disabled={!dirty} onClick={revert} data-testid="preset-revert" />
      <Button variant="secondary" icon="save" onClick={toggle} aria-expanded={open} data-testid="preset-save-button">
        保存预设
      </Button>
      {open && (
        <form
          className="preset-save-menu"
          role="dialog"
          aria-label="保存预设"
          data-testid="preset-save-menu"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="tda-field tda-text">
            <span className="tda-field__label">名称</span>
            <input
              ref={inputRef}
              className="tda-text__input"
              value={name}
              placeholder="给当前方案起个名字"
              onChange={(e) => setName(e.target.value)}
              aria-label="新预设名称"
              autoFocus
            />
          </label>
          <div className="preset-save-menu__actions">
            {activeUser && (
              <Button
                variant="ghost"
                icon="check"
                disabled={!dirty}
                onClick={() => {
                  void update(activeUser.id);
                  setOpen(false);
                }}
              >
                更新「{activeUser.name}」
              </Button>
            )}
            <Button variant="primary" icon="save" type="submit" disabled={!name.trim()}>
              保存
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
