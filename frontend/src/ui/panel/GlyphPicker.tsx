import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GLYPH_GROUPS, GLYPHS, GLYPH_CODE, glyphCoverage, type GlyphId } from '@/engine';
import { GlyphIcon } from './GlyphIcon';

interface GlyphPickerProps {
  /** 锚定的按钮，弹层贴在它下方（空间不够时翻到上方） */
  anchor: HTMLElement;
  value: GlyphId;
  /** 这一阶叫什么（第 3 阶） */
  title: string;
  onChange: (id: GlyphId) => void;
  onClose: () => void;
}

const WIDTH = 328;
const HEIGHT_ESTIMATE = 360;

/**
 * 点某一阶的形状弹出的符号选择器：整个符号库按 点 / 线 / 几何 / 字符 分四组，每组里按墨量从少到多排，
 * 一眼能看出哪个更亮哪个更暗。点一个就选中并收起。
 */
export function GlyphPicker({ anchor, value, title, onChange, onClose }: GlyphPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const groups = useMemo(
    () =>
      GLYPH_GROUPS.map((group) => ({
        ...group,
        items: GLYPHS.filter((g) => g.group === group.id)
          .slice()
          .sort((a, b) => glyphCoverage(GLYPH_CODE[a.id]) - glyphCoverage(GLYPH_CODE[b.id])),
      })),
    [],
  );

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const below = r.bottom + 6;
    const top = window.innerHeight - below < HEIGHT_ESTIMATE && r.top > HEIGHT_ESTIMATE ? Math.max(8, r.top - HEIGHT_ESTIMATE - 6) : below;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8));
    setPos({ top, left });
    ref.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
  }, [anchor]);

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onScroll = (e: Event) => {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onClose);
    // 打开瞬间可能有滚进视口的 scroll 事件，等一帧再监听
    let raf: number | 0 = requestAnimationFrame(() => {
      raf = 0;
      window.addEventListener('scroll', onScroll, true);
    });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [anchor, onClose]);

  return (
    <div
      ref={ref}
      className="tda-popover glyph-picker"
      role="dialog"
      aria-label={`${title}形状`}
      data-testid="glyph-picker"
      style={pos ? { top: pos.top, left: pos.left, width: WIDTH } : { visibility: 'hidden' }}
    >
      {groups.map((group) => (
        <div key={group.id} className="glyph-picker__group">
          <p className="glyph-picker__group-label">{group.label}</p>
          <div className="glyph-picker__grid" role="group" aria-label={group.label}>
            {group.items.map((g) => (
              <button
                key={g.id}
                type="button"
                className={['glyph-picker__item', g.id === value ? 'is-active' : ''].filter(Boolean).join(' ')}
                aria-pressed={g.id === value}
                aria-label={g.label}
                title={`${g.label} · ${g.desc}`}
                data-glyph={g.id}
                onClick={() => {
                  onChange(g.id);
                  onClose();
                }}
              >
                <GlyphIcon id={g.id} size={22} />
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="glyph-picker__foot">每组按墨量从少到多排：亮的阶选左边的，暗的阶选右边的。</p>
    </div>
  );
}
