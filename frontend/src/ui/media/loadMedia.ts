import { mimeFromName, type MediaFile, type Platform } from '@/platform';
import type { LoadedMedia } from '@/state';

function isHeic(file: MediaFile): boolean {
  return file.mime === 'image/heic' || file.mime === 'image/heif' || /\.hei[cf]$/i.test(file.name);
}

export async function fileToMediaFile(file: File): Promise<MediaFile> {
  return { name: file.name, mime: file.type || mimeFromName(file.name), bytes: new Uint8Array(await file.arrayBuffer()) };
}

/** 把文件字节解码成可送入流水线的媒体（M1：静态图；HEIC 走平台转码；视频在 M7 接入） */
export async function loadMediaFile(file: MediaFile, platform: Platform): Promise<LoadedMedia> {
  let bytes = file.bytes;
  let mime = file.mime || mimeFromName(file.name);
  if (isHeic(file)) {
    if (!platform.convertHeic) throw new Error('当前平台不支持 HEIC 转码');
    bytes = await platform.convertHeic(bytes);
    mime = 'image/png';
  }
  if (mime.startsWith('video/')) throw new Error('视频输入将在后续版本支持');
  const blob = new Blob([bytes as BlobPart], { type: mime || 'application/octet-stream' });
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error('无法识别的图片格式');
  }
  return {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    name: file.name,
    kind: 'image',
    width: bitmap.width,
    height: bitmap.height,
    bitmap,
    path: file.path,
  };
}
