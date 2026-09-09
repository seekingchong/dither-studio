import { useMemo, useState } from 'react';
import { mediaKey, presetNameById, summarizeParams, type SavedScheme, type SchemeMedia } from '@/state';
import { Button, Icon, IconButton, Tabs } from '@/ui/primitives';
import { useSchemes } from '@/ui/state/useSchemes';

function formatDate(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const KIND_LABEL: Record<SchemeMedia['kind'], string> = { image: '图片', video: '视频', gif: 'GIF' };

/** 素材一行：文件名 + 类型；预设与方案分开之前存的旧记录没记素材 */
function mediaLabel(media: SchemeMedia | null): string {
  if (!media) return '未绑定素材（旧记录）';
  return `${media.name}（${KIND_LABEL[media.kind]}）`;
}

interface HistoryItemProps {
  scheme: SavedScheme;
  /** 基于的预设名；预设已删时为 undefined */
  presetName: string | undefined;
  /** 正在用的就是这条 */
  active: boolean;
  /** 正在用、且素材 / 参数 / 编辑 / 裁剪有一样动过 */
  dirty: boolean;
  /** 绑的素材就是当前坑位里这份 */
  current: boolean;
  onApply: () => void;
  onUpdate: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
}

/** 一条保存过的方案：缩略图 + 名称 / 时间 / 素材 / 来源 / 摘要 + 应用、更新、重命名、删除 */
function HistoryItem({ scheme, presetName, active, dirty, current, onApply, onUpdate, onRename, onRemove }: HistoryItemProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(scheme.name);
  const commit = () => {
    setEditing(false);
    if (name.trim() && name.trim() !== scheme.name) onRename(name);
    else setName(scheme.name);
  };
  return (
    <article
      className={['history-item', active ? 'is-active' : '', current ? 'is-current' : ''].filter(Boolean).join(' ')}
      data-scheme={scheme.id}
      data-media={scheme.media ? mediaKey(scheme.media) : ''}
    >
      <button type="button" className="history-item__thumb" onClick={onApply} title="应用这条方案">
        {scheme.thumbnail ? <img src={scheme.thumbnail} alt="" /> : <Icon name="image" size={24} />}
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
                  setName(scheme.name);
                  setEditing(false);
                }
              }}
              aria-label="方案名称"
            />
          ) : (
            <h4 className="history-item__name">
              {scheme.name}
              {active && <span className="history-item__tag">{dirty ? '使用中 · 已微调' : '使用中'}</span>}
              {current && <span className="history-item__chip">当前素材</span>}
            </h4>
          )}
          <span className="preset-row__date">{formatDate(scheme.updatedAt ?? scheme.createdAt)}</span>
        </div>
        <p className="history-item__media">{mediaLabel(scheme.media)}</p>
        <p className="history-item__meta">
          基于 {presetName ?? '已删除的预设'} · {summarizeParams(scheme.params)}
        </p>
        <div className="history-item__actions">
          <Button variant="secondary" icon="folder" className="tda-btn--sm" onClick={onApply}>
            应用
          </Button>
          <Button variant="secondary" icon="check" className="tda-btn--sm" disabled={!active || !dirty} onClick={onUpdate} title="用当前素材与参数覆盖这条方案">
            更新
          </Button>
          <IconButton icon="edit" label="重命名" className="tda-iconbtn--sm" onClick={() => setEditing(true)} />
          <IconButton icon="trash" label="删除" className="tda-iconbtn--sm" onClick={onRemove} />
        </div>
      </div>
    </article>
  );
}

type HistoryFilter = 'all' | 'current';

interface HistoryPaneProps {
  /** 应用某条方案后回到参数页 */
  onApplied?: () => void;
}

/**
 * 历史页：保存过的方案，最近的在前。方案绑着素材——同一套预设在不同素材上存的是不同方案，
 * 放着素材时可以只看当前这份素材的方案。
 */
export function HistoryPane({ onApplied }: HistoryPaneProps) {
  const { schemes, presets, active, dirty, media, currentMediaKey, apply, update, rename, remove } = useSchemes();
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const sorted = useMemo(() => schemes.slice().sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)), [schemes]);
  const matching = useMemo(() => (currentMediaKey ? sorted.filter((s) => mediaKey(s.media) === currentMediaKey) : []), [sorted, currentMediaKey]);
  // 没放素材时「当前素材」无从谈起，只看全部
  const showing: HistoryFilter = media ? filter : 'all';
  const list = showing === 'current' ? matching : sorted;

  return (
    <div className="sections" data-testid="history-pane">
      <section className="section">
        <h3 className="section__title">历史</h3>
        <p className="section__hint">
          保存过的方案，每条都记着当时的素材、基于的预设与参数，最近的在前。预览区右上角的「保存」把当前素材与参数存进来；点缩略图或「应用」载入，「更新」把当前的写回该条。
        </p>
        {sorted.length > 0 && (
          <Tabs<HistoryFilter>
            className="history-filter"
            items={[
              { id: 'all', label: `全部 ${sorted.length}` },
              { id: 'current', label: `当前素材 ${matching.length}`, disabled: !media },
            ]}
            value={showing}
            onChange={setFilter}
          />
        )}
        {sorted.length === 0 ? (
          <p className="effects__empty">还没有保存过方案。放入素材、调好参数后，点预览区右上角的「保存」，当前素材与参数会一起存到这里。</p>
        ) : list.length === 0 ? (
          <p className="effects__empty">这份素材还没有保存过方案。</p>
        ) : (
          <div className="history-list">
            {list.map((scheme) => (
              <HistoryItem
                key={scheme.id}
                scheme={scheme}
                presetName={presetNameById(scheme.presetId, presets)}
                active={scheme.id === active?.id}
                dirty={dirty}
                current={!!currentMediaKey && mediaKey(scheme.media) === currentMediaKey}
                onApply={() => {
                  void apply(scheme);
                  onApplied?.();
                }}
                onUpdate={() => void update(scheme.id)}
                onRename={(n) => void rename(scheme.id, n)}
                onRemove={() => void remove(scheme.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
