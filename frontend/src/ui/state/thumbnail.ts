import type { RenderedFrame } from '@/engine';

export const THUMB_MAX_WIDTH = 240;
export const THUMB_MAX_HEIGHT = 150;

/** 把一帧渲染结果缩成小图（PNG data URL），用作历史列表 / 预设卡片的预览；没有帧返回 undefined */
export function frameToThumbnail(rendered: RenderedFrame | undefined): string | undefined {
  if (!rendered || typeof document === 'undefined') return undefined;
  const { frame } = rendered;
  if (!frame.width || !frame.height) return undefined;
  const src = document.createElement('canvas');
  src.width = frame.width;
  src.height = frame.height;
  const sctx = src.getContext('2d');
  if (!sctx) return undefined;
  sctx.putImageData(new ImageData(frame.data as Uint8ClampedArray<ArrayBuffer>, frame.width, frame.height), 0, 0);
  const scale = Math.min(THUMB_MAX_WIDTH / frame.width, THUMB_MAX_HEIGHT / frame.height, 1);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(frame.width * scale));
  out.height = Math.max(1, Math.round(frame.height * scale));
  const ctx = out.getContext('2d');
  if (!ctx) return undefined;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, out.width, out.height);
  try {
    return out.toDataURL('image/png');
  } catch {
    return undefined;
  }
}
