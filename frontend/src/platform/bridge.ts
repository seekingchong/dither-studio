/**
 * Electron preload 通过 contextBridge 暴露到 window.ditherStudio 的桥接对象。
 * 这里只放跨进程可结构化克隆的类型（Uint8Array、字符串、普通对象）。
 * electron/preload.ts 以 type-only 方式引用本文件，保证两端签名一致；
 * 因此本文件不依赖 DOM 类型，window 上的声明放在 bridge-global.d.ts。
 */
import type { MediaFile, SavedFile } from './types';

export interface DitherBridge {
  readonly platform: 'darwin' | 'win32' | 'linux';
  files: {
    openMedia(): Promise<MediaFile[]>;
    save(bytes: Uint8Array, name: string, mime: string): Promise<SavedFile | null>;
    read(path: string): Promise<Uint8Array>;
    reveal(path: string): Promise<void>;
    saveTemp(bytes: Uint8Array, name: string): Promise<SavedFile>;
  };
  storage: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
  };
  clipboard: {
    writeImage(png: Uint8Array): Promise<void>;
    writeFile(path: string): Promise<void>;
  };
  media: {
    convertHeic(bytes: Uint8Array): Promise<Uint8Array>;
  };
}

export function getBridge(): DitherBridge | undefined {
  return typeof globalThis === 'undefined'
    ? undefined
    : (globalThis as { ditherStudio?: DitherBridge }).ditherStudio;
}
