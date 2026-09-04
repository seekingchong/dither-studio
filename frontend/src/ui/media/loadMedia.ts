import { mimeFromName, type MediaFile, type Platform } from '@/platform';
import type { LoadedMedia } from '@/state';

function isHeic(file: MediaFile): boolean {
  return file.mime === 'image/heic' || file.mime === 'image/heif' || /\.hei[cf]$/i.test(file.name);
}

export async function fileToMediaFile(file: File): Promise<MediaFile> {
  return { name: file.name, mime: file.type || mimeFromName(file.name), bytes: new Uint8Array(await file.arrayBuffer()) };
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

/** 视频：用 <video> 解码，等元数据与首帧可用后抓海报帧 */
async function loadVideo(bytes: Uint8Array, mime: string, name: string, path?: string): Promise<LoadedMedia> {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.loop = true;
  video.preload = 'auto';
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    const onError = () => reject(new Error('视频无法解码'));
    video.addEventListener('loadeddata', () => resolve(), { once: true });
    video.addEventListener('error', onError, { once: true });
    video.load();
  });
  if (!video.videoWidth || !video.videoHeight) {
    URL.revokeObjectURL(url);
    throw new Error('视频没有画面轨道');
  }
  // MediaRecorder 录出的 WebM 没写时长（Infinity）：先定位到极大时间让浏览器扫出真实时长
  let duration = video.duration;
  if (!Number.isFinite(duration)) {
    duration = await new Promise<number>((resolve) => {
      const timer = window.setTimeout(() => resolve(video.duration), 3000);
      const check = () => {
        if (Number.isFinite(video.duration)) {
          window.clearTimeout(timer);
          video.removeEventListener('timeupdate', check);
          video.removeEventListener('durationchange', check);
          resolve(video.duration);
        }
      };
      video.addEventListener('timeupdate', check);
      video.addEventListener('durationchange', check);
      video.currentTime = 1e101;
    });
  }
  // 定位到 0 确保首帧已解码。loadeddata 之后本来就停在 0（且首帧已解码）的话跳过——
  // 此时再赋 currentTime = 0 不会触发 seeked，只会白等到超时
  if (video.currentTime !== 0) {
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(() => resolve(), 2000);
      video.addEventListener(
        'seeked',
        () => {
          window.clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      video.currentTime = 0;
    });
  }
  const bitmap = await createImageBitmap(video);
  return {
    id: newId(),
    name,
    kind: 'video',
    width: video.videoWidth,
    height: video.videoHeight,
    bitmap,
    path,
    video,
    duration: Number.isFinite(duration) ? duration : 0,
  };
}

interface DecodedGif {
  frames: ImageBitmap[];
  delays: number[];
}

/** GIF 动图：WebCodecs ImageDecoder 逐帧解码；不可用时退化为静态首帧 */
async function decodeGif(bytes: Uint8Array): Promise<DecodedGif | null> {
  const ImageDecoderCtor = (globalThis as { ImageDecoder?: typeof ImageDecoder }).ImageDecoder;
  if (!ImageDecoderCtor) return null;
  try {
    if (!(await ImageDecoderCtor.isTypeSupported('image/gif'))) return null;
    const decoder = new ImageDecoderCtor({ data: bytes as BufferSource, type: 'image/gif' });
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    if (!track || !track.animated) {
      decoder.close();
      return null;
    }
    await decoder.completed;
    const count = track.frameCount;
    const frames: ImageBitmap[] = [];
    const delays: number[] = [];
    for (let i = 0; i < count && i < 600; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      frames.push(await createImageBitmap(image));
      // duration 为微秒；缺省或过短按 100ms（浏览器惯例）
      const us = image.duration ?? 100_000;
      delays.push(Math.max(0.02, us / 1_000_000));
      image.close();
    }
    decoder.close();
    return frames.length > 1 ? { frames, delays } : null;
  } catch {
    return null;
  }
}

/** 把文件字节解码成可送入流水线的媒体：静态图、视频、GIF 动图；HEIC 走平台转码 */
export async function loadMediaFile(file: MediaFile, platform: Platform): Promise<LoadedMedia> {
  let bytes = file.bytes;
  let mime = file.mime || mimeFromName(file.name);
  if (isHeic(file)) {
    if (!platform.convertHeic) throw new Error('当前平台不支持 HEIC 转码');
    bytes = await platform.convertHeic(bytes);
    mime = 'image/png';
  }
  if (mime.startsWith('video/')) return loadVideo(bytes, mime, file.name, file.path);

  if (mime === 'image/gif') {
    const gif = await decodeGif(bytes);
    if (gif) {
      const first = gif.frames[0];
      const duration = gif.delays.reduce((s, d) => s + d, 0);
      return {
        id: newId(),
        name: file.name,
        kind: 'gif',
        width: first.width,
        height: first.height,
        bitmap: await createImageBitmap(first),
        path: file.path,
        frames: gif.frames,
        delays: gif.delays,
        duration,
      };
    }
  }

  const blob = new Blob([bytes as BlobPart], { type: mime || 'application/octet-stream' });
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error('无法识别的图片格式');
  }
  return { id: newId(), name: file.name, kind: 'image', width: bitmap.width, height: bitmap.height, bitmap, path: file.path };
}
