import { useEffect, useRef, type CSSProperties } from 'react';
import { computeFit, type FitMode, type RenderedFrame } from '@/engine';
import type { LoadedMedia, PreviewTab } from '@/state';
import { usePlaybackStore } from '@/ui/media/playback';

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

/** 预览画布：结果视图贴 Worker 返回的帧（降分辨率帧按最近邻放大），原图视图按适配矩形绘制当前源帧 */
export function SlotCanvas({ slot, media, rendered, tab, width, height, fit, scale }: SlotCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const scratch = useRef<HTMLCanvasElement | null>(null);
  const frameIndex = usePlaybackStore((s) => s.slots[slot]?.frameIndex ?? 0);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (tab === 'source') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      const rect = computeFit(media.width, media.height, width, height, fit);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const source: CanvasImageSource =
        media.kind === 'video' && media.video ? media.video : media.kind === 'gif' && media.frames ? media.frames[frameIndex % media.frames.length] : media.bitmap;
      ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height);
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
  }, [tab, rendered, media, width, height, fit, frameIndex]);

  const style: CSSProperties = { width: Math.round(width * scale), height: Math.round(height * scale) };
  return <canvas ref={ref} className="slot__canvas" width={width} height={height} style={style} data-tab={tab} data-scale={rendered?.scale ?? 1} />;
}
