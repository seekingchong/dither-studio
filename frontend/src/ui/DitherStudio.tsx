import { useEffect, useMemo, useState, type CSSProperties, type DragEvent } from 'react';
import { usePlatform } from '@/platform';
import { useStudioStore } from '@/state';
import { PreviewPane } from './canvas/PreviewPane';
import { useOpenMedia } from './media/useOpenMedia';
import { PaneSplitter } from './PaneSplitter';
import { ParamPane } from './panel/ParamPane';
import { HelpPopover } from './primitives/Help';
import { RendererProvider } from './renderer/RendererContext';
import { useExport } from './export/useExport';
import { useMenuActions } from './state/useMenuActions';
import { usePersistence } from './state/usePersistence';
import { useShortcuts } from './state/useShortcuts';

/** 根组件：可拖动的窗口标题条 + 左参数面板 + 右预览；整窗接受文件拖拽 */
export function DitherStudio() {
  return (
    <RendererProvider>
      <Shell />
    </RendererProvider>
  );
}

const hasFiles = (e: globalThis.DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');

/** 浏览器在指针不动时也会每 350ms 左右重发 dragover，超过这个间隔没收到就当拖拽已结束 */
const DRAG_IDLE_MS = 800;
/** 离开窗口后的宽限：在元素之间移动时 dragover 会紧跟着到来并续命，真正离开窗口才会熄灭 */
const DRAG_LEAVE_MS = 150;

/**
 * 窗口里是否正在拖文件。用 window 捕获阶段监听，不依赖 React 事件冒泡：
 * 坑位自己处理 drop 时会 stopPropagation，根节点收不到 drop，状态就永远留着。
 * 由 dragover 点亮，由 drop / dragend / 离开窗口的 dragleave 熄灭，再加一个空闲看门狗兜底
 * （按 Esc 取消系统拖拽时有的平台不发任何结束事件）。
 * 只用来把所有坑位标成"可放置"，落点提示交给坑位自己，免得整窗遮罩盖住谁是落点。
 */
function useFileDragActive(): boolean {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let timer = 0;
    const hide = () => {
      window.clearTimeout(timer);
      timer = 0;
      setDragging(false);
    };
    const hideAfter = (ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(hide, ms);
    };
    const onDragOver = (e: globalThis.DragEvent) => {
      if (!hasFiles(e)) return;
      setDragging(true);
      hideAfter(DRAG_IDLE_MS);
    };
    const onDragLeave = (e: globalThis.DragEvent) => {
      // Chromium 离开窗口时 relatedTarget 为空；WebKit 一律为空，所以只缩短看门狗而不立即熄灭
      if (e.relatedTarget === null) hideAfter(DRAG_LEAVE_MS);
    };
    window.addEventListener('dragover', onDragOver, true);
    window.addEventListener('dragleave', onDragLeave, true);
    window.addEventListener('drop', hide, true);
    window.addEventListener('dragend', hide, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('dragover', onDragOver, true);
      window.removeEventListener('dragleave', onDragLeave, true);
      window.removeEventListener('drop', hide, true);
      window.removeEventListener('dragend', hide, true);
    };
  }, []);
  return dragging;
}

function Shell() {
  const platform = usePlatform();
  const { acceptDrop, openDialog } = useOpenMedia();
  const { exportPng, copyPng } = useExport();
  const dragging = useFileDragActive();
  const paneWidth = useStudioStore((s) => s.settings.paneWidth);
  usePersistence();
  const actions = useMemo(() => ({ open: () => void openDialog(), exportPng: () => void exportPng(), copyPng: () => void copyPng() }), [openDialog, exportPng, copyPng]);
  useShortcuts(actions);
  useMenuActions(actions);

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  // 落在坑位之外（标题条、参数面板）的文件：填入当前坑位；坑位内的 drop 由 SlotView 自己接住
  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    void acceptDrop(e.dataTransfer.files);
  };

  return (
    <div
      className="app"
      data-platform={platform.kind}
      data-os={platform.os ?? 'web'}
      data-file-drag={dragging ? 'true' : 'false'}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* 无边框标题栏：只留一条透明拖动区给系统的三个圆点，没有标题、没有分隔线 */}
      <div className="app__titlebar" aria-hidden="true" />
      <main className="panes" style={paneWidth != null ? ({ '--tda-pane-split': `${paneWidth}px` } as CSSProperties) : undefined}>
        <ParamPane />
        <PaneSplitter />
        <PreviewPane />
      </main>
      <HelpPopover />
    </div>
  );
}
