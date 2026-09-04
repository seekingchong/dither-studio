import { useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { computeFit, type FitMode, type RenderedFrame } from '@/engine';
import type { LoadedMedia, PreviewTab } from '@/state';
import { usePlaybackStore } from '@/ui/media/playback';
import { IDENTITY_EDIT, drawEditedInto, editGeometry, editedSize, useSourceEditStore } from '@/ui/media/sourceEdit';

interface SlotCanvasProps {
  slot: number;
  media: LoadedMedia;
  rendered: RenderedFrame | undefined;
  tab: PreviewTab;
  width: number;
  height: number;
  fit: FitMode;
  scale: number;
}

/**
 * 预览画布的圆角比例：宽 100px 时 7.2px、宽 500px 时 36px，即宽度的 7.2%。
 * 只是 DOM 元素的 border-radius，不动像素，所以导出的 PNG / 视频不带圆角。
 */
export const PREVIEW_RADIUS_RATIO = 0.072;

/** 预览画布：结果视图贴 Worker 返回的帧（降分辨率帧按最近邻放大），原图视图按适配矩形绘制当前源帧 */
export function SlotCanvas({ slot, media, rendered, tab, width, height, fit, scale }: SlotCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const scratch = useRef<HTMLCanvasElement | null>(null);
  const frameIndex = usePlaybackStore((s) => s.slots[slot]?.frameIndex ?? 0);
  const edit = useSourceEditStore((s) => s.slots[slot] ?? IDENTITY_EDIT);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (tab === 'source') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      // 「原图」页看的是编辑之后的素材：按变换后的尺寸算适配矩形，再把旋转 / 镜像 / 裁剪画进去
      const size = editedSize(media.width, media.height, edit);
      const rect = computeFit(size.width, size.height, width, height, fit);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const source: CanvasImageSource =
        media.kind === 'video' && media.video ? media.video : media.kind === 'gif' && media.frames ? media.frames[frameIndex % media.frames.length] : media.bitmap;
      drawEditedInto(ctx, source, edit, rect);
      return;
    }
    if (!rendered) {
      ctx.clearRect(0, 0, width, height);
      return;
    }
    const { frame } = rendered;
    const image = new ImageData(frame.data as Uint8ClampedArray<ArrayBuffer>, frame.width, frame.height);
    if (frame.width === width && frame.height === height) {
      ctx.putImageData(image, 0, 0);
      return;
    }
    // 降分辨率预览：先贴到暂存画布再最近邻放大
    if (!scratch.current) scratch.current = document.createElement('canvas');
    const tmp = scratch.current;
    if (tmp.width !== frame.width || tmp.height !== frame.height) {
      tmp.width = frame.width;
      tmp.height = frame.height;
    }
    tmp.getContext('2d')!.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(tmp, 0, 0, frame.width, frame.height, 0, 0, width, height);
  }, [tab, rendered, media, width, height, fit, frameIndex, edit]);

  // 圆角按屏幕上的实际宽度算，缩放档位变了也保持同一个比例
  const shownWidth = Math.round(width * scale);
  const style: CSSProperties = {
    width: shownWidth,
    height: Math.round(height * scale),
    borderRadius: `${(shownWidth * PREVIEW_RADIUS_RATIO).toFixed(2)}px`,
  };

  /**
   * 放大之后在「原图」页直接拖画面挪裁剪窗口。
   * 屏幕上挪 1px 相当于挪 裁剪宽 / 目标矩形宽 个源像素，再换算成余量里的比例。
   */
  const pannable = tab === 'source' && edit.zoom > 1;
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!pannable || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const g = editGeometry(media.width, media.height, edit);
    const size = editedSize(media.width, media.height, edit);
    const rect = computeFit(size.width, size.height, width, height, fit);
    const slackX = g.rotatedWidth - g.cropWidth;
    const slackY = g.rotatedHeight - g.cropHeight;
    // 目标矩形是画布坐标，屏幕上还要再乘一次预览缩放
    const perPixelX = slackX > 0 ? (2 * g.cropWidth) / (rect.width * scale * slackX) : 0;
    const perPixelY = slackY > 0 ? (2 * g.cropHeight) / (rect.height * scale * slackY) : 0;
    const from = { x: e.clientX, y: e.clientY, offsetX: edit.offsetX, offsetY: edit.offsetY };
    const move = (ev: PointerEvent) => {
      useSourceEditStore.getState().update(slot, {
        offsetX: Math.min(1, Math.max(-1, from.offsetX - (ev.clientX - from.x) * perPixelX)),
        offsetY: Math.min(1, Math.max(-1, from.offsetY - (ev.clientY - from.y) * perPixelY)),
      });
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  return (
    <canvas
      ref={ref}
      className="slot__canvas"
      width={width}
      height={height}
      style={style}
      data-tab={tab}
      data-scale={rendered?.scale ?? 1}
      data-pannable={pannable ? 'true' : 'false'}
      onPointerDown={onPointerDown}
    />
  );
}
