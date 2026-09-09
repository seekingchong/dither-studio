import { useEffect, useMemo, useRef, useState } from 'react';
import { copyPresetName } from '@/state';
import { Button, IconButton } from '@/ui/primitives';
import { usePresets } from '@/ui/state/usePresets';

/**
 * 左栏操作行右端的预设动作：「还原」（丢掉微调，只有图标）、「保存」与「另存」。
 * 预设只是一套参数、不绑素材；素材 + 参数要留档走预览头的「保存」（进「历史」）。
 *
 * 「保存」：当前用的是我的预设就把微调直接写回它（没动过时置灰）；用的是内置预设没法写回，
 * 就跟「另存」一样弹浮层起个名字存成新的。「另存」：一律弹浮层存成新的我的预设，当前那套不动。
 * 浮层里名字已经预填好（「当前预设 副本」，重名往后排号），直接回车就存下。
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
  const openMenu = () => {
    setName(copyPresetName(activeName, takenNames));
    setOpen(true);
  };
  const toggleMenu = () => {
    if (open) setOpen(false);
    else openMenu();
  };

  useEffect(() => {
    if (open) inputRef.current?.select();
  }, [open]);

  /** 「保存」：我的预设直接写回，内置预设走起名浮层 */
  const onSave = () => {
    if (activeUser) {
      if (dirty) void update(activeUser.id);
      return;
    }
    toggleMenu();
  };

  const submit = async () => {
    if (!name.trim()) return;
    await save(name);
    setOpen(false);
  };

  const saveTitle = activeUser ? (dirty ? `把微调写回「${activeUser.name}」` : `「${activeUser.name}」没有改动`) : '把当前参数存成我的预设';

  return (
    <div className="preset-actions" ref={ref}>
      {/* 没微调过就没有可丢的东西，按钮留在原地置灰，免得这一行的按钮位置来回跳 */}
      <IconButton icon="undo" label="还原" disabled={!dirty} onClick={revert} data-testid="preset-revert" />
      <Button
        variant="secondary"
        icon="save"
        disabled={!!activeUser && !dirty}
        onClick={onSave}
        title={saveTitle}
        aria-label="保存预设"
        aria-expanded={!activeUser ? open : undefined}
        data-testid="preset-save-button"
      >
        保存
      </Button>
      <Button
        variant="secondary"
        icon="copy"
        onClick={toggleMenu}
        title="另存成新的我的预设，当前那套不动"
        aria-label="另存为预设"
        aria-expanded={open}
        data-testid="preset-save-as-button"
      >
        另存
      </Button>
      {open && (
        <form
          className="preset-save-menu"
          role="dialog"
          aria-label="另存为预设"
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
              placeholder="给这套参数起个名字"
              onChange={(e) => setName(e.target.value)}
              aria-label="新预设名称"
              autoFocus
            />
          </label>
          <div className="preset-save-menu__actions">
            <Button variant="primary" icon="save" type="submit" disabled={!name.trim()}>
              保存
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
