/**
 * 平台接口：前端与壳层之间唯一的通信面。
 * 一期由 Electron（preload contextBridge）与浏览器（File System Access / localStorage / Clipboard API）各实现一套；
 * 二期在 SkillForge 上把 storage 接用户数据 KV、files 接用户文件存储、ai 接 Agent 对话。
 */

export type PlatformKind = 'electron' | 'web' | 'skillforge';

/** 一个已读入内存的媒体文件 */
export interface MediaFile {
  /** 文件名（含扩展名） */
  name: string;
  /** MIME，未知时为空字符串 */
  mime: string;
  /** 文件字节 */
  bytes: Uint8Array;
  /** 本地路径，仅 Electron 有 */
  path?: string;
}

export interface SavedFile {
  /** 保存后的路径或标识；web 端为文件名 */
  path: string;
}

export interface PlatformFiles {
  /** 弹出文件选择器，返回用户选择的媒体文件（可多选） */
  openMedia(): Promise<MediaFile[]>;
  /** 保存字节到用户指定位置；用户取消返回 null */
  save(bytes: Uint8Array, name: string, mime: string): Promise<SavedFile | null>;
  /** 按路径读取文件（Electron / 平台可用） */
  read(path: string): Promise<Uint8Array>;
  /** 在 Finder 中显示（仅 Electron） */
  reveal?(path: string): Promise<void>;
}

export interface PlatformStorage {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface PlatformClipboard {
  /** 把 PNG 写入系统剪贴板 */
  writeImage(png: Blob): Promise<void>;
  /** 把文件引用写入剪贴板（macOS 上可在 Finder 粘贴）；不支持的平台省略 */
  writeFile?(path: string): Promise<void>;
}

/** 二期：Agent 对话（SSE 流）。一期不实现，仅预留签名。 */
export interface PlatformAI {
  chat(message: string, sessionId: string): AsyncIterable<string>;
}

export interface Platform {
  readonly kind: PlatformKind;
  readonly files: PlatformFiles;
  readonly storage: PlatformStorage;
  readonly clipboard: PlatformClipboard;
  /** HEIC → PNG 转码；macOS 上由主进程调用 sips，web 端暂无 */
  convertHeic?(bytes: Uint8Array): Promise<Uint8Array>;
  readonly ai?: PlatformAI;
}

export const MEDIA_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'heif', 'mp4', 'webm', 'mov'] as const;

export function mimeFromName(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'heic':
    case 'heif':
      return 'image/heic';
    case 'mp4':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'mov':
      return 'video/quicktime';
    default:
      return '';
  }
}
