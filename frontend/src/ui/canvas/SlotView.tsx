import { useEffect, useLayoutEffect, useRef, useState, type DragEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { FitMode } from '@/engine';
import { useStudioStore } from '@/state';
import { useOpenMedia } from '@/ui/media/useOpenMedia';
import { usePlaybackController } from '@/ui/media/usePlaybackController';
import { useFrameStore, useRenderClient } from '@/ui/renderer/RendererContext';
import { DropZone } from './DropZone';
import { SlotCanvas } from './SlotCanvas';

const VIEWPORT_PADDING = 24;

interface SlotViewProps {
  index: number;
}

/** 把视口滚到正中：画布比视口大时初始就露出中心，而不是左上角 */
function centerScroll(el: HTMLElement) {
  el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2);
  el.scrollTop = Math.max(0, (el.scrollHeight - el.clientHeight) / 2);
}

/** 单个坑位：白底圆角容器，内含可滚动视口；画布始终上下左右居中；空时显示拖拽区 */
export function SlotView({ index }: SlotViewProps) {
  const { media, zoom, tab, active, width, height, fit, setActiveSlot } = useStudioStore(
    useShallow((s) => ({
      media: s.slots[index]?.media ?? null,
      zoom: s.view.zoom,
      tab: s.view.tab,
      active: s.view.activeSlot === index,
      width: Number(s.params['canvas.width']),
      height: Number(s.params['canvas.height']),
      fit: String(s.params['canvas.fit']) as FitMode,
      setActiveSlot: s.setActiveSlot,
    })),
  );
  const rendered = useFrameStore((s) => s.frames[index]);
  const renderSeq = useFrameStore((s) => s.seq[index] ?? 0);
  const client = useRenderClient();
  usePlaybackController(index, media, client);
  const { openDialog, acceptDrop } = useOpenMedia();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => {
      const cw = el.clientWidth - VIEWPORT_PADDING * 2;
      const ch = el.clientHeight - VIEWPORT_PADDING * 2;
      setFitScale(Math.max(0.05, Math.min(cw / width, ch / height, 1)));
      centerScroll(el);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);

  const scale = zoom === 'fit' ? fitScale : zoom;

  // 缩放档位或画布尺寸变化后（布局提交前）重新居中，避免先看到左上角再跳到中间
  useLayoutEffect(() => {
    if (viewportRef.current) centerScroll(viewportRef.current);
  }, [scale, width, height, media]);

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  };
  const onDragLeave = (e: DragEvent) => {
    // 在坑位内部的子元素之间移动也会触发 dragleave，只有真正离开坑位才取消高亮
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    setActiveSlot(index);
    void acceptDrop(e.dataTransfer.files, index);
  };

  return (
    <div
      className={['slot', active ? 'is-active' : '', dragging ? 'is-dragging' : ''].filter(Boolean).join(' ')}
      data-slot={index}
      data-rendered={rendered ? 'true' : 'false'}
      {...(rendered
        ? {
            // 渲染细节不再显示成灰色小字，但仍留在 DOM 上，方便验收脚本判断"这一帧渲染完了吗 / 走没走 GPU"
            'data-render-seq': String(renderSeq),
            'data-gpu': rendered.gpu ? 'true' : 'false',
            'data-preview-scale': String(rendered.scale),
          }
        : {})}
      onClick={() => setActiveSlot(index)}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="slot__viewport" ref={viewportRef}>
        <div className="slot__stage">
          {media ? (
            <SlotCanvas slot={index} media={media} rendered={rendered} tab={tab} width={width} height={height} fit={fit} scale={scale} />
          ) : (
            <DropZone onOpen={() => void openDialog(index)} />
          )}
        </div>
      </div>
    </div>
  );
}
