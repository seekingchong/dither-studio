import { useEffect, useMemo, useRef, useState } from 'react';
import { styleOf } from '@/params';
import { BUILTIN_PRESETS, defaultPresetIdFor, findBuiltinPreset, presetStyle, useStudioStore } from '@/state';
import { Button, Icon, IconButton } from '@/ui/primitives';
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

interface PresetCardActionsProps {
  name: string;
  starred: boolean;
  onDuplicate: () => void;
  onToggleStar: () => void;
  onRemove: () => void;
  /** 删除气泡开着时卡片得一直显示这排图标（鼠标已经移到气泡上了） */
  onConfirmingChange: (confirming: boolean) => void;
}

/**
 * 我的预设卡片右上角那排动作：复制、星标、删除，平时藏着，鼠标移到卡片上（或键盘聚焦进来）才露出。
 * 删除是不可逆的，点了先在卡片里弹一个气泡问一句，确认了才真删。
 */
function PresetCardActions({ name, starred, onDuplicate, onToggleStar, onRemove, onConfirmingChange }: PresetCardActionsProps) {
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = () => {
    setConfirming(false);
    onConfirmingChange(false);
  };

  useEffect(() => {
    if (!confirming) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [confirming]);

  // 这排按钮盖在卡片上，点它们不能顺带把卡片本身的「应用这套方案」也点了
  const only = (run: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    run();
  };

  return (
    <div
      className="preset-card__actions"
      ref={ref}
      // 回车 / 空格按在这几个按钮上是按按钮，不能顺带把卡片本身也应用了；
      // 拦下来之后 window 上那个 Esc 就收不到了（React 的事件挂在根节点上），Esc 在这里自己收气泡
      onKeyDown={(e) => {
        if (e.key === 'Escape' && confirming) close();
        e.stopPropagation();
      }}
    >
      <IconButton
        icon="copy"
        label={`复制预设「${name}」`}
        className="tda-iconbtn--xs preset-card__action"
        onClick={only(onDuplicate)}
        data-testid="preset-card-duplicate"
      />
      <IconButton
        icon="star"
        label={starred ? `取消星标「${name}」` : `星标「${name}」`}
        aria-pressed={starred}
        className={['tda-iconbtn--xs', 'preset-card__action', starred ? 'is-starred' : ''].filter(Boolean).join(' ')}
        onClick={only(onToggleStar)}
        data-testid="preset-card-star"
      />
      <IconButton
        icon="trash"
        label={`删除预设「${name}」`}
        aria-expanded={confirming}
        className={['tda-iconbtn--xs', 'preset-card__action', confirming ? 'is-confirming' : ''].filter(Boolean).join(' ')}
        onClick={only(() => {
          setConfirming((was) => !was);
          onConfirmingChange(!confirming);
        })}
        data-testid="preset-card-remove"
      />
      {confirming && (
        <div className="preset-confirm" role="dialog" aria-label={`删除预设「${name}」`} data-testid="preset-delete-confirm" onClick={(e) => e.stopPropagation()}>
          <p className="preset-confirm__text">删除预设「{name}」？删掉就找不回来了。</p>
          <div className="preset-confirm__actions">
            <Button variant="ghost" className="tda-btn--sm" onClick={only(close)} data-testid="preset-delete-cancel">
              取消
            </Button>
            <Button
              variant="primary"
              icon="trash"
              className="tda-btn--sm preset-confirm__ok"
              autoFocus
              onClick={only(() => {
                close();
                onRemove();
              })}
              data-testid="preset-delete-confirm-ok"
            >
              删除
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 预设模块（参数面板最上方）：内置预设 + 我的预设排成一组卡片，选中的那套就是当前参数的来源；
 * 下面的参数在它基础上微调。存成我的预设走左栏操作行的「保存预设」，这里只负责挑。
 * 预设只是一套参数、不绑素材；素材 + 参数的组合是「历史」页的方案，走预览头的「保存」。
 * 只列当前页签这种风格的方案（抖动页看抖动的，排线页看排线的），「重置」也退回这种风格的「默认」。
 * 卡片多于三行就折起来，选中的那张要是被折在下面则整组展开——总得看得见当前用的是哪套。
 * 我的预设的卡片鼠标移上去还会在右上角露出复制 / 星标 / 删除。
 */
export function PresetPicker() {
  const { presets, activeId, activeName, dirty, applyBuiltin, applyUser, duplicate, toggleStar, remove } = usePresets();
  const style = useStudioStore((s) => styleOf(s.params));
  const defaultId = defaultPresetIdFor(style);
  const gridRef = useRef<HTMLDivElement>(null);
  const columns = useGridColumns(gridRef);
  const [expanded, setExpanded] = useState(false);
  /** 正在问「确定删除吗」的那张卡片：它得一直显示右上角那排图标，也不能被折叠收走 */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  // 我的预设排在内置方案前面：内置有十来套，排在后面的话存下来的方案总是落在折叠线以下。
  // 我的预设里星标过的又排在最前——存得多了总有几套是常用的
  const cards = useMemo(
    () => [
      ...presets
        .filter((preset) => presetStyle(preset.params) === style)
        .slice()
        .sort((a, b) => Number(!!b.starred) - Number(!!a.starred))
        .map((preset) => ({
          id: preset.id,
          name: preset.name,
          hint: `我的 · 基于 ${findBuiltinPreset(preset.base ?? '')?.name ?? '默认'}`,
          user: true,
          starred: !!preset.starred,
          apply: () => applyUser(preset),
        })),
      ...BUILTIN_PRESETS.filter((preset) => presetStyle(preset.params) === style).map((preset) => ({
        id: preset.id,
        name: preset.name,
        hint: preset.hint,
        user: false,
        starred: false,
        apply: () => applyBuiltin(preset),
      })),
    ],
    [presets, style, applyBuiltin, applyUser],
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
        {/* 这一节的"值"就是选了哪套方案，重置即退回这种风格的「默认」 */}
        <IconButton
          icon="undo"
          label="重置预设"
          className="tda-iconbtn--sm section__reset"
          disabled={activeId === defaultId && !dirty}
          onClick={() => applyBuiltin(findBuiltinPreset(defaultId)!)}
          data-testid="reset-preset"
        />
      </h3>
      <p className="section__hint">选一套预设作为起点，下面只列出这套预设用到的参数，可在它基础上微调；调好后点上方「保存预设」存成我的预设。预设只是一套参数，不绑素材——素材 + 参数要留档，用预览区的「保存」存进「历史」。</p>

      <div className="param-grid" role="listbox" aria-label="预设" ref={gridRef}>
        {visible.map((card) => (
          <div
            key={card.id}
            role="option"
            tabIndex={0}
            aria-selected={card.id === activeId}
            className={[
              'preset-card',
              card.user ? 'preset-card--user' : '',
              card.id === activeId ? 'is-active' : '',
              card.id === confirmingId ? 'is-confirming' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            data-preset={card.id}
            onClick={card.apply}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                card.apply();
              }
            }}
          >
            <span className="preset-card__name">{card.name}</span>
            <span className="preset-card__hint">{card.hint}</span>
            {card.user && (
              <PresetCardActions
                name={card.name}
                starred={card.starred}
                onDuplicate={() => void duplicate(card.id)}
                onToggleStar={() => void toggleStar(card.id)}
                onRemove={() => void remove(card.id)}
                onConfirmingChange={(confirming) => setConfirmingId(confirming ? card.id : null)}
              />
            )}
          </div>
        ))}
      </div>

      {hidden > 0 && !forced && (
        <button type="button" className="preset-more" aria-expanded={showAll} onClick={() => setExpanded(!showAll)} data-testid="preset-more">
          <Icon name="chevron" size={12} className="preset-more__caret" />
          {showAll ? '收起' : `还有 ${hidden} 个`}
        </button>
      )}

      <p className="preset-status" data-testid="preset-status">
        当前预设：{activeName}
        {dirty ? ' · 已微调' : ''}
      </p>
    </section>
  );
}
