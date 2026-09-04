import { useMemo, useState } from 'react';
import { findBuiltinPreset, summarizeParams, type UserPreset } from '@/state';
import { Button, Icon, IconButton } from '@/ui/primitives';
import { usePresets } from '@/ui/state/usePresets';

function formatDate(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface HistoryItemProps {
  preset: UserPreset;
  active: boolean;
  dirty: boolean;
  onApply: () => void;
  onUpdate: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
}

/** 一条保存过的方案：缩略图 + 名称 / 时间 / 摘要 + 应用、更新、重命名、删除 */
function HistoryItem({ preset, active, dirty, onApply, onUpdate, onRename, onRemove }: HistoryItemProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(preset.name);
  const commit = () => {
    setEditing(false);
    if (name.trim() && name.trim() !== preset.name) onRename(name);
    else setName(preset.name);
  };
  const baseName = findBuiltinPreset(preset.base ?? '')?.name ?? '默认';
  return (
    <article className={['history-item', active ? 'is-active' : ''].filter(Boolean).join(' ')} data-preset={preset.id}>
      <button type="button" className="history-item__thumb" onClick={onApply} title="应用这套方案">
        {preset.thumbnail ? <img src={preset.thumbnail} alt="" /> : <Icon name="image" size={24} />}
      </button>
      <div className="history-item__body">
        <div className="history-item__head">
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
            <h4 className="history-item__name">
              {preset.name}
              {active && <span className="history-item__tag">{dirty ? '使用中 · 已微调' : '使用中'}</span>}
            </h4>
          )}
          <span className="preset-row__date">{formatDate(preset.updatedAt ?? preset.createdAt)}</span>
        </div>
        <p className="history-item__meta">
          基于 {baseName} · {summarizeParams(preset.params)}
        </p>
        <div className="history-item__actions">
          <Button variant="secondary" icon="folder" className="tda-btn--sm" onClick={onApply}>
            应用
          </Button>
          <Button variant="secondary" icon="check" className="tda-btn--sm" disabled={!active || !dirty} onClick={onUpdate} title="用当前参数覆盖这套方案">
            更新
          </Button>
          <IconButton icon="edit" label="重命名" className="tda-iconbtn--sm" onClick={() => setEditing(true)} />
          <IconButton icon="trash" label="删除" className="tda-iconbtn--sm" onClick={onRemove} />
        </div>
      </div>
    </article>
  );
}

interface HistoryPaneProps {
  /** 应用某条方案后回到参数页 */
  onApplied?: () => void;
}

/** 历史页：以往保存过的所有方案，最近的在前 */
export function HistoryPane({ onApplied }: HistoryPaneProps) {
  const { presets, activeId, dirty, applyUser, update, rename, remove } = usePresets();
  const sorted = useMemo(() => presets.slice().sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)), [presets]);

  return (
    <div className="sections" data-testid="history-pane">
      <section className="section">
        <h3 className="section__title">历史</h3>
        <p className="section__hint">保存过的所有方案，最近的在前。点缩略图或「应用」载入到参数页继续编辑；「更新」把当前参数写回该方案。</p>
        {sorted.length === 0 ? (
          <p className="effects__empty">还没有保存过方案。在「参数」页给当前方案起个名字保存后，会出现在这里。</p>
        ) : (
          <div className="history-list">
            {sorted.map((preset) => (
              <HistoryItem
                key={preset.id}
                preset={preset}
                active={preset.id === activeId}
                dirty={dirty}
                onApply={() => {
                  applyUser(preset);
                  onApplied?.();
                }}
                onUpdate={() => void update(preset.id)}
                onRename={(n) => void rename(preset.id, n)}
                onRemove={() => void remove(preset.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
