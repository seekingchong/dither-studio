import type { LoadedMedia } from '@/state';

/**
 * 主窗口 ↔ 界面预览窗口的消息协议。
 * 两扇窗在 Electron 里是 file:// 的不透明源，互相读不到对方的 DOM，成品只能靠 postMessage 传；
 * 字节走 ArrayBuffer，是可转移对象，过去零拷贝。
 *
 * 预览窗口里放的不是预览画面，而是真正导出的成品：图片先导成 PNG、视频 / GIF 先导成 MP4
 * （没有 H.264 编码器时 WebM），再整个文件送过去，那边用 <img> / <video> 显示——
 * 看到的就是最终导出的文件在界面里的样子。
 */
export const PREVIEW_CHANNEL = 'dither-studio:interface-preview';

/** 预览窗口就绪、要成品：主窗口有现成的直接给，正在导的把进度再报一次 */
export interface PreviewRequest {
  channel: typeof PREVIEW_CHANNEL;
  type: 'request';
  slot: number;
}

/** 随成品带过去的素材信息，用来写窗口标题 */
export interface PreviewMedia {
  name: string;
  kind: LoadedMedia['kind'];
  width: number;
  height: number;
}

/** 成品的容器名，给标题与状态文字用 */
export type PreviewFormat = 'PNG' | 'MP4' | 'WebM';

/** 导出的成品文件 */
export interface PreviewFile {
  kind: 'image' | 'video';
  mime: string;
  format: PreviewFormat;
  width: number;
  height: number;
  bytes: ArrayBuffer;
}

/** 主窗口正在导：视频逐帧编码时按帧报进度；图片瞬间完成，只在开始时报一次 */
export interface PreviewProgress {
  channel: typeof PREVIEW_CHANNEL;
  type: 'progress';
  slot: number;
  media: PreviewMedia;
  format: PreviewFormat;
  done: number;
  total: number;
}

/**
 * 主窗口交付成品。坑位空着时 media 与 file 都是 null；导出失败时 file 为 null、error 写原因，
 * 预览窗口留着上一份成品不动，只把原因显示出来。
 */
export interface PreviewExport {
  channel: typeof PREVIEW_CHANNEL;
  type: 'export';
  slot: number;
  media: PreviewMedia | null;
  file: PreviewFile | null;
  error: string | null;
}

export type PreviewMessage = PreviewRequest | PreviewProgress | PreviewExport;

/** 认领自己的消息：别的库、扩展也会往窗口里丢 message */
export function previewMessage(data: unknown): PreviewMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const msg = data as Partial<PreviewMessage>;
  if (msg.channel !== PREVIEW_CHANNEL) return null;
  return msg.type === 'request' || msg.type === 'progress' || msg.type === 'export' ? (msg as PreviewMessage) : null;
}
