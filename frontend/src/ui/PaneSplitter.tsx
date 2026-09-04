import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { clampPaneWidth, useStudioStore } from '@/state';

/** 方向键每次挪 12px，按住 Shift 挪 48px */
const STEP = 12;
const STEP_FAST = 48;

/**
 * 左右分栏之间的拖拽条。宽度落在 settings.paneWidth（跟着设置一起持久化），
 * 为 null 时左右均分；双击 / Home 复位回均分。
 */
export function PaneSplitter() {
  const setSettings = useStudioStore((s) => s.setSettings);
  const paneWidth = useStudioStore((s) => s.settings.paneWidth);
  const ref = useRef<HTMLDivElement>(null);

  /** 左栏当前真实宽度：还没拖过（paneWidth 为 null）时也能拿到均分后的像素值 */
  const currentWidth = () => (ref.current?.previousElementSibling as HTMLElement | null)?.getBoundingClientRect().width ?? 0;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const pane = ref.current?.previousElementSibling as HTMLElement | null;
    if (!pane) return;
    e.preventDefault();
    const left = pane.getBoundingClientRect().left;
    document.body.classList.add('is-resizing');
    const move = (ev: PointerEvent) => setSettings({ paneWidth: clampPaneWidth(ev.clientX - left) });
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      document.body.classList.remove('is-resizing');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? STEP_FAST : STEP;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      setSettings({ paneWidth: clampPaneWidth(currentWidth() + (e.key === 'ArrowLeft' ? -step : step)) });
    } else if (e.key === 'Home') {
      e.preventDefault();
      setSettings({ paneWidth: null });
    }
  };

  return (
    <div
      ref={ref}
      className="pane-splitter"
      data-testid="pane-splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整左右分栏宽度"
      aria-valuenow={paneWidth ?? undefined}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => setSettings({ paneWidth: null })}
      onKeyDown={onKeyDown}
    />
  );
}
