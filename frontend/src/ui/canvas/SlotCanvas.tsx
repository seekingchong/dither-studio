import { useEffect, useRef, type CSSProperties } from 'react';
import { computeFit, type FitMode, type RenderedFrame } from '@/engine';
import type { LoadedMedia, PreviewTab } from '@/state';

interface SlotCanvasProps {
  media: LoadedMedia;
  rendered: RenderedFrame | undefined;
  tab: PreviewTab;
  width: number;
  height: number;
  fit: FitMode;
  scale: number;
}

/** 预览画布：结果视图贴 Worker 返回的帧，原图视图按适配矩形绘制位图 */
export function SlotCanvas({ media, rendered, tab, width, height, fit, scale }: SlotCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);

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
      ctx.drawImage(media.bitmap, rect.x, rect.y, rect.width, rect.height);
      return;
    }
    if (rendered) {
      const { frame } = rendered;
      const image = new ImageData(frame.data as Uint8ClampedArray<ArrayBuffer>, frame.width, frame.height);
      ctx.putImageData(image, 0, 0);
    } else {
      ctx.clearRect(0, 0, width, height);
    }
  }, [tab, rendered, media, width, height, fit]);

  const style: CSSProperties = { width: Math.round(width * scale), height: Math.round(height * scale) };
  return <canvas ref={ref} className="slot__canvas" width={width} height={height} style={style} data-tab={tab} />;
}
