import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { getParamDef, hasParam } from '@/params';
import { helpForParam, useHelpStore, type HelpContent } from '@/ui/state/helpStore';

/** 停多久才弹；面板里从一个标签移到另一个标签时立即换内容，不再等待 */
const OPEN_DELAY = 400;
/** 离开后留一手，让指针能移进浮层里选文字 */
const CLOSE_DELAY = 150;
const GAP = 8;

let openTimer = 0;
let closeTimer = 0;

export function requestHelp(anchor: HTMLElement, content: HelpContent): void {
  window.clearTimeout(openTimer);
  window.clearTimeout(closeTimer);
  const store = useHelpStore.getState();
  const delay = store.content ? 0 : OPEN_DELAY;
  openTimer = window.setTimeout(() => useHelpStore.getState().show(anchor, content), delay);
}

export function dismissHelp(immediate = false): void {
  window.clearTimeout(openTimer);
  window.clearTimeout(closeTimer);
  if (immediate) {
    useHelpStore.getState().hide();
    return;
  }
  closeTimer = window.setTimeout(() => useHelpStore.getState().hide(), CLOSE_DELAY);
}

function keepHelp(): void {
  window.clearTimeout(closeTimer);
}

const isCoarse = () => typeof window !== 'undefined' && window.matchMedia?.('(hover: none)').matches;

/** 浮层贴着整个控件摆，而不是贴着标签——贴标签会把控件自己盖住一半 */
const FIELD_SELECTOR = '.tda-field, .tda-select, .effect-card__head';
const anchorFor = (el: HTMLElement): HTMLElement => (el.closest(FIELD_SELECTOR) as HTMLElement | null) ?? el;

interface HelpLabelProps {
  content: HelpContent | null;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * 参数标签。热区只有标签文字本身——把整个控件都做成热区的话，调滑块时浮层会一直跟着弹。
 * 指针设备停 400ms 弹出；触屏点一下弹出。
 */
export function HelpLabel({ content, className, style, children }: HelpLabelProps) {
  const ref = useRef<HTMLSpanElement>(null);
  if (!content) {
    return (
      <span className={className} style={style}>
        {children}
      </span>
    );
  }
  return (
    <span
      ref={ref}
      className={[className, 'has-help'].filter(Boolean).join(' ')}
      style={style}
      data-help={content.key}
      onPointerEnter={(e) => {
        if (e.pointerType === 'touch' || !ref.current) return;
        requestHelp(anchorFor(ref.current), content);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'touch') return;
        dismissHelp();
      }}
      onClick={(e) => {
        if (!isCoarse() || !ref.current) return;
        e.preventDefault();
        e.stopPropagation();
        const store = useHelpStore.getState();
        if (store.content?.key === content.key) store.hide();
        else store.show(anchorFor(ref.current), content);
      }}
    >
      {children}
    </span>
  );
}

/**
 * 全局唯一的解读浮层。默认贴在标签右侧，放不下就翻到左边、再放不下就落到下方，
 * 永远不遮住触发它的控件。滚动和改窗口尺寸时直接收起。
 */
export function HelpPopover() {
  const anchor = useHelpStore((s) => s.anchor);
  const content = useHelpStore((s) => s.content);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor || !content || !ref.current) {
      setPos(null);
      return;
    }
    const a = anchor.getBoundingClientRect();
    const box = ref.current.getBoundingClientRect();
    let left = a.right + GAP;
    let top = a.top;
    if (left + box.width > window.innerWidth - GAP) left = a.left - box.width - GAP;
    if (left < GAP) {
      left = Math.min(Math.max(GAP, a.left), Math.max(GAP, window.innerWidth - box.width - GAP));
      top = a.bottom + GAP;
    }
    top = Math.min(Math.max(GAP, top), Math.max(GAP, window.innerHeight - box.height - GAP));
    setPos({ top, left });
  }, [anchor, content]);

  useEffect(() => {
    if (!content) return;
    const close = () => dismissHelp(true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [content]);

  // 键盘路径：焦点在某个控件上时按 ? 或 F1 弹出它的解读，Esc 收起
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (useHelpStore.getState().content) dismissHelp(true);
        return;
      }
      if (e.key !== '?' && e.key !== 'F1') return;
      const field = (document.activeElement as HTMLElement | null)?.closest?.('[data-param]') as HTMLElement | null;
      const id = field?.getAttribute('data-param');
      if (!field || !id || !hasParam(id)) return;
      const next = helpForParam(getParamDef(id));
      if (!next) return;
      e.preventDefault();
      useHelpStore.getState().show(field, next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!content) return null;

  return (
    <div
      ref={ref}
      role="tooltip"
      className={['tda-help', content.variant === 'option' ? 'tda-help--option' : ''].filter(Boolean).join(' ')}
      data-show={pos ? 'true' : 'false'}
      data-help-for={content.key}
      style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
      onPointerEnter={keepHelp}
      onPointerLeave={() => dismissHelp()}
    >
      <div className="tda-help__title">{content.title}</div>
      <p className="tda-help__summary">{content.summary}</p>
      {content.values && (
        <dl className="tda-help__values">
          {content.values.map((v) => (
            <div key={v.label} className="tda-help__value">
              <dt className="tda-help__value-name">{v.label}</dt>
              <dd className="tda-help__value-desc">{v.desc}</dd>
            </div>
          ))}
        </dl>
      )}
      {content.more && <p className="tda-help__tip">展开下拉后停在某一行上，可以看这一项的解读。</p>}
      {content.tip && <p className="tda-help__tip">{content.tip}</p>}
    </div>
  );
}
