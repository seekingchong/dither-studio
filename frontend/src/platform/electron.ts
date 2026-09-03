import type { DitherBridge } from './bridge';
import type { Platform } from './types';

/** Electron 实现：全部转发到 preload 桥接对象 */
export function createElectronPlatform(bridge: DitherBridge): Platform {
  return {
    kind: 'electron',
    files: {
      openMedia: () => bridge.files.openMedia(),
      save: (bytes, name, mime) => bridge.files.save(bytes, name, mime),
      read: (path) => bridge.files.read(path),
      reveal: (path) => bridge.files.reveal(path),
    },
    storage: {
      async get<T>(key: string) {
        const value = await bridge.storage.get(key);
        return (value ?? null) as T | null;
      },
      set: (key, value) => bridge.storage.set(key, value),
      remove: (key) => bridge.storage.remove(key),
    },
    clipboard: {
      async writeImage(png: Blob) {
        const bytes = new Uint8Array(await png.arrayBuffer());
        await bridge.clipboard.writeImage(bytes);
      },
      writeFile: (path) => bridge.clipboard.writeFile(path),
    },
    convertHeic: bridge.platform === 'darwin' ? (bytes) => bridge.media.convertHeic(bytes) : undefined,
  };
}
