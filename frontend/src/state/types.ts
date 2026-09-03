/** 已解码、可直接送入流水线的媒体 */
export interface LoadedMedia {
  id: string;
  name: string;
  kind: 'image' | 'video';
  width: number;
  height: number;
  /** 静态图的位图；视频在 M7 接入 */
  bitmap: ImageBitmap;
  /** 本地路径，仅 Electron 打开的文件有 */
  path?: string;
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

export interface Settings {
  slotCount: SlotCount;
  gpu: boolean;
  theme: 'light' | 'dark';
}

export const DEFAULT_SETTINGS: Settings = { slotCount: 1, gpu: true, theme: 'light' };
