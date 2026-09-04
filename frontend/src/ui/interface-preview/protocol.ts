import type { LoadedMedia } from '@/state';

/**
 * 主窗口 ↔ 界面预览窗口的消息协议。
 * 两扇窗在 Electron 里是 file:// 的不透明源，互相读不到对方的 DOM，
 * 所以帧只能靠 postMessage 传；ImageBitmap 是可转移对象，过去是零拷贝。
 *
 * 方向是「预览窗口来要、主窗口才给」：预览窗口自己按 rAF 的节奏要帧，
 * 主窗口被别的窗口盖住时 rAF 会被节流，反过来推就会卡住。
 */
export const PREVIEW_CHANNEL = 'dither-studio:interface-preview';

/** 预览窗口要一帧；width / height 是封面容器当前的设备像素，主窗口按它缩好再传 */
export interface PreviewRequest {
  channel: typeof PREVIEW_CHANNEL;
  type: 'request';
  slot: number;
  width: number;
  height: number;
}

/** 随帧带过去的素材信息，用来写窗口标题 */
export interface PreviewMedia {
  name: string;
  kind: LoadedMedia['kind'];
  width: number;
  height: number;
}

/** 主窗口回一帧；坑位空着（或这一刻抓不到）时 bitmap 为 null，预览窗口显示占位 */
export interface PreviewFrame {
  channel: typeof PREVIEW_CHANNEL;
  type: 'frame';
  slot: number;
  bitmap: ImageBitmap | null;
  media: PreviewMedia | null;
}

export type PreviewMessage = PreviewRequest | PreviewFrame;

/** 认领自己的消息：别的库、扩展也会往窗口里丢 message */
export function previewMessage(data: unknown): PreviewMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const msg = data as Partial<PreviewMessage>;
  if (msg.channel !== PREVIEW_CHANNEL) return null;
  return msg.type === 'request' || msg.type === 'frame' ? (msg as PreviewMessage) : null;
}
