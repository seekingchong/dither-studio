import { useEffect, useMemo, useRef, useState } from 'react';
import { BUILTIN_PRESETS, findBuiltinPreset } from '@/state';
import { Icon } from '@/ui/primitives';
import { usePresets } from '@/ui/state/usePresets';

/** 折起来时最多露几行卡片 */
const MAX_ROWS = 3;

/**
 * 卡片栅格当前排了几列。列数由容器查询决定（栏宽 3 / 2 / 1 列），CSS 里算不出「三行」是多少张，
 * 只能把用上的轨道数读回来。`grid-template-columns` 的计算值是一串用过的像素宽度，数一数即可。
 */
function useGridColumns(ref: React.RefObject<HTMLElement | null>): number {
  const [columns, setColumns] = useState(3);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const tracks = getComputedStyle(el).gridTemplateColumns.split(' ').filter((t) => t.endsWith('px')).length;
      if (tracks > 0) setColumns(tracks);
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return columns;
}

/**
 * 预设模块（参数面板最上方）：内置方案 + 我的预设排成一组卡片，选中的那套就是当前方案的来源；
 * 下面的参数在它基础上微调。存成我的预设走左栏操作行的「保存预设」，这里只负责挑。
 * 卡片多于三行就折起来，选中的那张要是被折在下面则整组展开——总得看得见当前用的是哪套。
 */
export function PresetPicker() {
  const { presets, activeId, activeName, dirty, applyBuiltin, applyUser } = usePresets();
  const gridRef = useRef<HTMLDivElement>(null);
  const columns = useGridColumns(gridRef);
  const [expanded, setExpanded] = useState(false);

  // 我的预设排在内置方案前面：内置有 11 套，排在后面的话存下来的方案总是落在折叠线以下
  const cards = useMemo(
    () => [
      ...presets.map((preset) => ({
        id: preset.id,
        name: preset.name,
        hint: `我的 · 基于 ${findBuiltinPreset(preset.base ?? '')?.name ?? '默认'}`,
        user: true,
        apply: () => applyUser(preset),
      })),
      ...BUILTIN_PRESETS.map((preset) => ({ id: preset.id, name: preset.name, hint: preset.hint, user: false, apply: () => applyBuiltin(preset) })),
    ],
    [presets, applyBuiltin, applyUser],
  );

  const limit = columns * MAX_ROWS;
  const hidden = cards.length - limit;
  // 选中的那张排在折叠线以下时强制展开，并且这时不给「收起」——收起就看不见当前方案了
  const forced = cards.findIndex((card) => card.id === activeId) >= limit;
  const showAll = hidden <= 0 || forced || expanded;
  const visible = showAll ? cards : cards.slice(0, limit);

  return (
    <section className="section preset-picker" data-testid="preset-picker">
      <h3 className="section__title">
        预设
        <Icon name="star" size={16} />
      </h3>
      <p className="section__hint">选一套方案作为起点，下面只列出这套方案用到的参数，可在它基础上微调；调好后点上方「保存预设」，会出现在这里和「历史」里。</p>

      <div className="param-grid" role="listbox" aria-label="预设" ref={gridRef}>
        {visible.map((card) => (
          <button
            key={card.id}
            type="button"
            role="option"
            aria-selected={card.id === activeId}
            className={['preset-card', card.user ? 'preset-card--user' : '', card.id === activeId ? 'is-active' : ''].filter(Boolean).join(' ')}
            data-preset={card.id}
            onClick={card.apply}
          >
            <span className="preset-card__name">{card.name}</span>
            <span className="preset-card__hint">{card.hint}</span>
          </button>
        ))}
      </div>

      {hidden > 0 && !forced && (
        <button type="button" className="preset-more" aria-expanded={showAll} onClick={() => setExpanded(!showAll)} data-testid="preset-more">
          <Icon name="chevron" size={12} className="preset-more__caret" />
          {showAll ? '收起' : `还有 ${hidden} 个`}
        </button>
      )}

      <p className="preset-status" data-testid="preset-status">
        当前方案：{activeName}
        {dirty ? ' · 已微调' : ''}
      </p>
    </section>
  );
}
