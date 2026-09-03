import { useState, type DragEvent } from 'react';
import { usePlatform } from '@/platform';
import { PreviewPane } from './canvas/PreviewPane';
import { useOpenMedia } from './media/useOpenMedia';
import { ParamPane } from './panel/ParamPane';
import { RendererProvider } from './renderer/RendererContext';
import { TopBar } from './TopBar';

/** 根组件：顶栏 + 左参数面板 + 右预览；整窗接受文件拖拽 */
export function DitherStudio() {
  return (
    <RendererProvider>
      <Shell />
    </RendererProvider>
  );
}

function Shell() {
  const platform = usePlatform();
  const { acceptDrop } = useOpenMedia();
  const [dragging, setDragging] = useState(false);

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  };
  const onDragLeave = (e: DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setDragging(false);
    void acceptDrop(e.dataTransfer.files);
  };

  return (
    <div
      className={['app', dragging ? 'is-dragging' : ''].filter(Boolean).join(' ')}
      data-platform={platform.kind}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <TopBar />
      <main className="panes">
        <ParamPane />
        <PreviewPane />
      </main>
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay__box">松开以打开文件</div>
        </div>
      )}
    </div>
  );
}
