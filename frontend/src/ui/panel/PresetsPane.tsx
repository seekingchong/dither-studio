import { useState } from 'react';
import { BUILTIN_PRESETS, type UserPreset } from '@/state';
import { Button, Icon, IconButton } from '@/ui/primitives';
import { usePresets } from '@/ui/state/usePresets';

function formatDate(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function UserPresetRow({ preset, onApply, onRename, onRemove }: { preset: UserPreset; onApply: () => void; onRename: (name: string) => void; onRemove: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(preset.name);
  const commit = () => {
    setEditing(false);
    if (name.trim() && name.trim() !== preset.name) onRename(name);
    else setName(preset.name);
  };
  return (
    <div className="preset-row" data-preset={preset.id}>
      {editing ? (
        <input
          className="preset-row__input"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setName(preset.name);
              setEditing(false);
            }
          }}
          aria-label="预设名称"
        />
      ) : (
        <button type="button" className="preset-row__name" onClick={onApply}>
          {preset.name}
        </button>
      )}
      <span className="preset-row__date">{formatDate(preset.createdAt)}</span>
      <IconButton icon="edit" label="重命名" className="tda-iconbtn--sm" onClick={() => setEditing(true)} />
      <IconButton icon="trash" label="删除" className="tda-iconbtn--sm" onClick={onRemove} />
    </div>
  );
}

/** 预设页：内置一键风格 + 用户预设的保存 / 重命名 / 删除 */
export function PresetsPane() {
  const { presets, applyBuiltin, applyUser, save, rename, remove } = usePresets();
  const [newName, setNewName] = useState('');

  const submit = async () => {
    const saved = await save(newName);
    if (saved) setNewName('');
  };

  return (
    <div className="sections" data-testid="presets-pane">
      <section className="section">
        <h3 className="section__title">
          内置预设
          <Icon name="star" size={16} />
        </h3>
        <p className="section__hint">一键风格。应用后再到参数页微调，Cmd+Z 可撤销。</p>
        <div className="param-grid">
          {BUILTIN_PRESETS.map((preset) => (
            <button key={preset.id} type="button" className="preset-card" data-preset={preset.id} onClick={() => applyBuiltin(preset)}>
              <span className="preset-card__name">{preset.name}</span>
              <span className="preset-card__hint">{preset.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <h3 className="section__title">我的预设</h3>
        <p className="section__hint">把当前全部参数存成预设，随应用本地保存。</p>
        <form
          className="preset-save"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="tda-field tda-text preset-save__field">
            <span className="tda-field__label">名称</span>
            <input className="tda-text__input" value={newName} placeholder="给当前参数起个名字" onChange={(e) => setNewName(e.target.value)} aria-label="新预设名称" />
          </label>
          <Button variant="primary" icon="save" type="submit" disabled={!newName.trim()}>
            保存预设
          </Button>
        </form>
        {presets.length === 0 ? (
          <p className="effects__empty">还没有用户预设。</p>
        ) : (
          <div className="preset-table">
            {presets.map((preset) => (
              <UserPresetRow key={preset.id} preset={preset} onApply={() => applyUser(preset)} onRename={(n) => void rename(preset.id, n)} onRemove={() => void remove(preset.id)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
