import { useEffect, useRef, useState, type DragEvent } from 'react';
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

/** 单个坑位：白底圆角容器，内含可滚动视口；空时显示拖拽区 */
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
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);

  const scale = zoom === 'fit' ? fitScale : zoom;

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setDragging(true);
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
      onClick={() => setActiveSlot(index)}
      onDragOver={onDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="slot__viewport" ref={viewportRef}>
        {media ? (
          <SlotCanvas slot={index} media={media} rendered={rendered} tab={tab} width={width} height={height} fit={fit} scale={scale} />
        ) : (
          <DropZone onOpen={() => void openDialog(index)} />
        )}
      </div>
    </div>
  );
}
