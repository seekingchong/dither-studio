import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { HSB_RANGE, clampHsb, hexToHsb, hsbToHex, type Hsb } from './color';

interface ColorPopoverProps {
  /** 锚定的色块元素，弹层贴在它下方（空间不够时翻到上方） */
  anchor: HTMLElement;
  /** #RRGGBB */
  value: string;
  /** 这块颜色叫什么（暗色 / 第 3 级 / 第 2 色） */
  title: string;
  onChange: (hex: string) => void;
  onClose: () => void;
  /** 可删除时给出（Palette 自定义色） */
  onRemove?: () => void;
  /** 额外说明，如"修改后会转为自定义" */
  hint?: ReactNode;
}

const HEX_FULL = /^#?([0-9a-fA-F]{6})$/;
const HEX_SHORT = /^#?([0-9a-fA-F]{3})$/;

function normalize(text: string): string | null {
  const t = text.trim();
  const full = HEX_FULL.exec(t);
  if (full) return `#${full[1].toUpperCase()}`;
  const short = HEX_SHORT.exec(t);
  if (short) return `#${short[1].replace(/./g, (c) => c + c).toUpperCase()}`;
  return null;
}

const WIDTH = 260;
const HEIGHT_ESTIMATE = 168;

type Mode = 'hsb' | 'hex';
const CHANNELS: Array<keyof Hsb> = ['h', 's', 'b'];

/** 默认 HSB；同一次会话里改过就记住，重开弹层还用上次那种 */
let lastMode: Mode = 'hsb';

/** 点色块弹出的取色层：系统取色器 + HSB / 十六进制两种输入方式 */
export function ColorPopover({ anchor, value, title, onChange, onClose, onRemove, hint }: ColorPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>(lastMode);
  const [text, setText] = useState(value);
  const [hsb, setHsb] = useState<Hsb>(() => hexToHsb(value));
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => setText(value), [value]);

  // 颜色被别处改掉时把 HSB 拉回来对齐；自己输出的那个色值不用重算——
  // 同一个 hex 能对应多组 HSB（黑与灰的色相是任意的），重算会把正在编辑的数字抹掉
  const hsbRef = useRef(hsb);
  hsbRef.current = hsb;
  useEffect(() => {
    if (hsbToHex(hsbRef.current) !== value) setHsb(hexToHsb(value));
  }, [value]);

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const below = r.bottom + 6;
    const top = window.innerHeight - below < HEIGHT_ESTIMATE && r.top > HEIGHT_ESTIMATE ? r.top - HEIGHT_ESTIMATE - 6 : below;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8));
    setPos({ top, left });
    firstFieldRef.current?.focus();
    firstFieldRef.current?.select();
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

  const switchMode = (next: Mode) => {
    lastMode = next;
    setMode(next);
  };

  const setChannel = (channel: keyof Hsb, raw: number) => {
    const next = { ...hsb, [channel]: clampHsb(channel, raw) };
    setHsb(next);
    const hex = hsbToHex(next);
    if (hex !== value) onChange(hex);
  };

  const commit = (): boolean => {
    const hex = normalize(text);
    if (hex) {
      if (hex !== value) onChange(hex);
      setText(hex);
      return true;
    }
    setText(value);
    return false;
  };

  return (
    <div
      ref={ref}
      className="tda-popover color-popover"
      role="dialog"
      aria-label={`${title}颜色`}
      data-testid="color-popover"
      data-mode={mode}
      style={pos ? { top: pos.top, left: pos.left, width: WIDTH } : { visibility: 'hidden' }}
    >
      <div className="color-popover__row">
        <label className="color-popover__swatch" style={{ background: value }} title="打开系统取色器">
          <input type="color" className="tda-color__picker" value={value.toLowerCase()} onChange={(e) => onChange(e.target.value.toUpperCase())} aria-label={`${title}取色器`} />
        </label>
        <span className="color-popover__title">{title}</span>
        <div className="color-mode" role="group" aria-label="色值模式">
          {(['hsb', 'hex'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={['color-mode__btn', mode === m ? 'is-active' : ''].filter(Boolean).join(' ')}
              aria-pressed={mode === m}
              data-mode={m}
              onClick={() => switchMode(m)}
            >
              {m.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {mode === 'hsb' ? (
        <div className="color-hsb">
          {CHANNELS.map((channel, i) => (
            <label key={channel} className="color-hsb__field">
              <span className="color-hsb__label">{channel.toUpperCase()}</span>
              <input
                ref={i === 0 ? firstFieldRef : undefined}
                type="number"
                className="color-hsb__input"
                min={0}
                max={HSB_RANGE[channel].max}
                step={1}
                value={hsb[channel]}
                aria-label={`${title}${HSB_RANGE[channel].label}`}
                onChange={(e) => setChannel(channel, Number(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onClose();
                  }
                }}
              />
              <span className="color-hsb__unit" aria-hidden="true">
                {HSB_RANGE[channel].unit}
              </span>
            </label>
          ))}
        </div>
      ) : (
        <input
          ref={firstFieldRef}
          type="text"
          className="color-popover__hex"
          value={text}
          spellCheck={false}
          aria-label={`${title}色值`}
          onChange={(e) => {
            setText(e.target.value);
            // 输完 6 位就实时生效
            const hex = HEX_FULL.test(e.target.value.trim()) ? normalize(e.target.value) : null;
            if (hex && hex !== value) onChange(hex);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (commit()) onClose();
            }
          }}
        />
      )}

      {(hint || onRemove) && (
        <div className="color-popover__foot">
          {hint && <span className="color-popover__hint">{hint}</span>}
          {onRemove && (
            <Button variant="ghost" icon="trash" className="tda-btn--sm" onClick={onRemove}>
              删除
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
