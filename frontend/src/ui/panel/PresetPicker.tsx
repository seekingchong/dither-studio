import { useState } from 'react';
import { BUILTIN_PRESETS, findBuiltinPreset } from '@/state';
import { Button, Icon } from '@/ui/primitives';
import { usePresets } from '@/ui/state/usePresets';

/**
 * 预设模块（参数面板最上方）：内置方案 + 我的预设排成一组卡片，选中的那套就是当前方案的来源；
 * 下面的参数在它基础上微调，调好后在这里起名保存，新预设立刻出现在卡片里和「历史」里。
 */
export function PresetPicker() {
  const { presets, activeId, activeUser, activeName, dirty, applyBuiltin, applyUser, revert, save, update } = usePresets();
  const [newName, setNewName] = useState('');

  const submit = async () => {
    const saved = await save(newName);
    if (saved) setNewName('');
  };

  return (
    <section className="section preset-picker" data-testid="preset-picker">
      <h3 className="section__title">
        预设
        <Icon name="star" size={16} />
      </h3>
      <p className="section__hint">选一套方案作为起点，下面只列出这套方案用到的参数，可在它基础上微调；调好后起名保存，会出现在这里和「历史」里。</p>

      <div className="param-grid" role="listbox" aria-label="预设">
        {BUILTIN_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            role="option"
            aria-selected={preset.id === activeId}
            className={['preset-card', preset.id === activeId ? 'is-active' : ''].filter(Boolean).join(' ')}
            data-preset={preset.id}
            onClick={() => applyBuiltin(preset)}
          >
            <span className="preset-card__name">{preset.name}</span>
            <span className="preset-card__hint">{preset.hint}</span>
          </button>
        ))}
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            role="option"
            aria-selected={preset.id === activeId}
            className={['preset-card', 'preset-card--user', preset.id === activeId ? 'is-active' : ''].filter(Boolean).join(' ')}
            data-preset={preset.id}
            onClick={() => applyUser(preset)}
          >
            <span className="preset-card__name">{preset.name}</span>
            <span className="preset-card__hint">我的 · 基于 {findBuiltinPreset(preset.base ?? '')?.name ?? '默认'}</span>
          </button>
        ))}
      </div>

      <form
        className="preset-save"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="tda-field tda-text preset-save__field">
          <span className="tda-field__label">名称</span>
          <input className="tda-text__input" value={newName} placeholder="给当前方案起个名字" onChange={(e) => setNewName(e.target.value)} aria-label="新预设名称" />
        </label>
        <Button variant="primary" icon="save" type="submit" disabled={!newName.trim()}>
          保存为我的预设
        </Button>
        {activeUser && dirty && (
          <Button variant="secondary" icon="check" onClick={() => void update(activeUser.id)}>
            更新「{activeUser.name}」
          </Button>
        )}
        {dirty && (
          <Button variant="ghost" icon="undo" onClick={revert}>
            还原
          </Button>
        )}
      </form>
      <p className="preset-status" data-testid="preset-status">
        当前方案：{activeName}
        {dirty ? ' · 已微调' : ''}
      </p>
    </section>
  );
}
