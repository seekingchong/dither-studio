import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from './Icon';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
}

interface SelectProps<T extends string> {
  label?: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
  /** 标签固定宽度，默认 58px（Figma home 画板） */
  labelWidth?: number;
  'data-param'?: string;
}

/**
 * 下拉：标签和值在同一行、同一个框里（"预设模板  通用 ⌄"），标签淡、值深。
 * 弹层用 fixed 定位，避免被滚动容器裁剪。
 */
export function Select<T extends string>({ label, value, options, onChange, disabled, className, labelWidth, ...rest }: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value);

  const close = useCallback(() => setOpen(false), []);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const estimated = Math.min(options.length, 8) * 36 + 8;
    const top = spaceBelow < estimated && r.top > estimated ? r.top - estimated - 4 : r.bottom + 4;
    setRect({ top, left: r.left, width: r.width });
    setHighlight(Math.max(0, options.findIndex((o) => o.value === value)));
  }, [open, options, value]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || listRef.current?.contains(t)) return;
      close();
    };
    const onScroll = (e: Event) => {
      if (listRef.current?.contains(e.target as Node)) return;
      close();
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('resize', close);
    // 点击触发器前浏览器可能刚把它滚进视口，那个 scroll 事件要到下一帧才派发；
    // 这时就监听会把刚打开的弹层关掉，所以等一帧再开始监听滚动
    let raf: number | 0 = requestAnimationFrame(() => {
      raf = 0;
      window.addEventListener('scroll', onScroll, true);
    });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[highlight] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, highlight]);

  const pick = (v: T) => {
    onChange(v);
    close();
    triggerRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        setHighlight((h) => (h + dir + options.length) % options.length);
        break;
      }
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (open) pick(options[highlight].value);
        else setOpen(true);
        break;
      case 'Escape':
        if (open) {
          e.preventDefault();
          close();
        }
        break;
    }
  };

  return (
    <div className={['tda-select-wrap', className].filter(Boolean).join(' ')}>
      <button
        ref={triggerRef}
        type="button"
        className={['tda-select', open ? 'is-open' : ''].filter(Boolean).join(' ')}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        {...rest}
      >
        {label && (
          <span className="tda-select__label" style={labelWidth ? { width: labelWidth } : undefined}>
            {label}
          </span>
        )}
        <span className="tda-select__value">{current?.label ?? value}</span>
        <Icon name="chevron" size={12} className="tda-select__chevron" />
      </button>
      {open && rect && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          className="tda-popover"
          style={{ top: rect.top, left: rect.left, minWidth: rect.width }}
        >
          {options.map((o, i) => (
            <div
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={['tda-popover__item', i === highlight ? 'is-highlight' : '', o.value === value ? 'is-selected' : ''].filter(Boolean).join(' ')}
              onPointerEnter={() => setHighlight(i)}
              onClick={() => pick(o.value)}
            >
              <span className="tda-popover__text">{o.label}</span>
              {o.value === value && <Icon name="check" size={12} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
