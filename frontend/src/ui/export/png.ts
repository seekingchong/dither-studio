import type { RGBAFrame } from '@/engine';

/** 把渲染帧编码成 PNG */
export async function frameToPngBlob(frame: RGBAFrame): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D 上下文不可用');
  ctx.putImageData(new ImageData(frame.data as Uint8ClampedArray<ArrayBuffer>, frame.width, frame.height), 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG 编码失败'))), 'image/png');
  });
}

export function exportFileName(sourceName: string | undefined, ext: string): string {
  const base = (sourceName ?? 'dither').replace(/\.[^.]+$/, '') || 'dither';
  return `${base}-dither.${ext}`;
}
