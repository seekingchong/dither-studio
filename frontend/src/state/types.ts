/** 已解码、可直接送入流水线的媒体 */
export interface LoadedMedia {
  id: string;
  name: string;
  kind: 'image' | 'video' | 'gif';
  width: number;
  height: number;
  /** 静态图的位图；视频与 GIF 为首帧（海报帧） */
  bitmap: ImageBitmap;
  /** 本地路径，仅 Electron 打开的文件有 */
  path?: string;
  /** 视频：已加载元数据的 <video> 元素（对象 URL 由其持有） */
  video?: HTMLVideoElement;
  /** 视频 / GIF 时长（秒） */
  duration?: number;
  /** GIF：各帧位图与时长（秒） */
  frames?: ImageBitmap[];
  delays?: number[];
}

export interface Slot {
  id: number;
  media: LoadedMedia | null;
}

/** 画布缩放档位：数值为比例，'fit' 为适应窗口 */
export type ZoomLevel = 'fit' | 0.1 | 0.25 | 0.5 | 1;

export const ZOOM_LEVELS: ZoomLevel[] = ['fit', 0.1, 0.25, 0.5, 1];

export type PreviewTab = 'result' | 'source';

export type SlotCount = 1 | 4;

export type ThemeSetting = 'light' | 'dark' | 'system';

export interface Settings {
  slotCount: SlotCount;
  gpu: boolean;
  theme: ThemeSetting;
}

export const DEFAULT_SETTINGS: Settings = { slotCount: 1, gpu: true, theme: 'light' };

/** 从存储读出的设置做校验，缺项补默认 */
export function sanitizeSettings(input: unknown): Settings {
  const rec = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  return {
    slotCount: rec.slotCount === 4 ? 4 : 1,
    gpu: typeof rec.gpu === 'boolean' ? rec.gpu : DEFAULT_SETTINGS.gpu,
    theme: rec.theme === 'dark' || rec.theme === 'system' ? rec.theme : 'light',
  };
}

/** 动态媒体的播放状态（不进撤销栈、不进预设） */
export interface PlaybackState {
  playing: boolean;
  /** 当前时间（秒） */
  time: number;
}

export function isAnimated(media: LoadedMedia | null | undefined): boolean {
  return !!media && (media.kind === 'video' || media.kind === 'gif');
}

export function releaseMedia(media: LoadedMedia | null | undefined) {
  if (!media) return;
  media.bitmap.close();
  media.frames?.forEach((f) => f.close());
  if (media.video) {
    media.video.pause();
    const src = media.video.src;
    media.video.removeAttribute('src');
    media.video.load();
    if (src.startsWith('blob:')) URL.revokeObjectURL(src);
  }
}
