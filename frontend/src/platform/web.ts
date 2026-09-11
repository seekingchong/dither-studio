import { MEDIA_EXTENSIONS, mediaStoreKey, mimeFromName, type MediaFile, type MediaStoreSource, type Platform, type PlatformMediaStore, type SavedFile } from './types';

const STORAGE_PREFIX = 'dither-studio:';

// ---------- 素材存储：IndexedDB ----------

const MEDIA_DB = 'dither-studio-media';
const MEDIA_OBJECT_STORE = 'files';

function openMediaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(MEDIA_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(MEDIA_OBJECT_STORE)) req.result.createObjectStore(MEDIA_OBJECT_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('打不开素材存储'));
  });
}

/** 开一个事务跑一条请求，等事务收尾后再把结果交出去 */
async function withMediaStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openMediaDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(MEDIA_OBJECT_STORE, mode);
      let result: T;
      const req = run(tx.objectStore(MEDIA_OBJECT_STORE));
      req.onsuccess = () => {
        result = req.result;
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error('素材存储读写失败'));
      tx.onabort = () => reject(tx.error ?? new Error('素材存储读写中断'));
    });
  } finally {
    db.close();
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 浏览器里方案绑定的素材文件存在 IndexedDB：一个键一个 Blob，键 = 内容 SHA-256 + 扩展名 */
function createWebMediaStore(): PlatformMediaStore {
  return {
    async store(source: MediaStoreSource) {
      if (!source.bytes) throw new Error('web 端只能按字节存素材');
      const key = mediaStoreKey(await sha256Hex(source.bytes), source.name);
      const blob = new Blob([source.bytes as BlobPart], { type: mimeFromName(source.name) || 'application/octet-stream' });
      await withMediaStore('readwrite', (store) => store.put(blob, key));
      return key;
    },
    async read(key) {
      const blob = await withMediaStore<Blob | undefined>('readonly', (store) => store.get(key));
      if (!blob) throw new Error('素材不在应用存储里');
      return new Uint8Array(await blob.arrayBuffer());
    },
    async remove(key) {
      await withMediaStore('readwrite', (store) => store.delete(key));
    },
    async list() {
      const keys = await withMediaStore<IDBValidKey[]>('readonly', (store) => store.getAllKeys());
      return keys.map(String);
    },
  };
}

interface FilePickerWindow extends Window {
  showOpenFilePicker?: (options?: unknown) => Promise<Array<{ getFile(): Promise<File> }>>;
  showSaveFilePicker?: (options?: unknown) => Promise<{
    createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void> }>;
    name: string;
  }>;
}

async function fileToMedia(file: File): Promise<MediaFile> {
  return {
    name: file.name,
    mime: file.type || mimeFromName(file.name),
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
}

function pickWithInput(): Promise<MediaFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = MEDIA_EXTENSIONS.map((ext) => `.${ext}`).join(',');
    input.style.display = 'none';
    document.body.appendChild(input);
    const finish = async () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      resolve(await Promise.all(files.map(fileToMedia)));
    };
    input.addEventListener('change', finish, { once: true });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve([]);
    }, { once: true });
    input.click();
  });
}

function downloadBytes(bytes: Uint8Array, name: string, mime: string): SavedFile {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { path: name };
}

/** 浏览器实现：File System Access API 优先，回退到 <input type=file> 与下载链接 */
export function createWebPlatform(): Platform {
  const w = window as FilePickerWindow;
  return {
    kind: 'web',
    files: {
      async openMedia() {
        if (w.showOpenFilePicker) {
          try {
            const handles = await w.showOpenFilePicker({
              multiple: true,
              types: [
                {
                  description: '图片与视频',
                  accept: {
                    'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic', '.heif'],
                    'video/*': ['.mp4', '.webm', '.mov'],
                  },
                },
              ],
            });
            const files = await Promise.all(handles.map((h) => h.getFile()));
            return Promise.all(files.map(fileToMedia));
          } catch (err) {
            if ((err as DOMException).name === 'AbortError') return [];
            // 其他错误（例如 iframe 内不允许）回退到 input
          }
        }
        return pickWithInput();
      },
      async save(bytes, name, mime) {
        if (w.showSaveFilePicker) {
          try {
            const ext = name.slice(name.lastIndexOf('.'));
            const handle = await w.showSaveFilePicker({
              suggestedName: name,
              types: [{ description: mime, accept: { [mime]: [ext] } }],
            });
            const writable = await handle.createWritable();
            await writable.write(bytes);
            await writable.close();
            return { path: handle.name };
          } catch (err) {
            if ((err as DOMException).name === 'AbortError') return null;
          }
        }
        return downloadBytes(bytes, name, mime);
      },
      async read() {
        throw new Error('web 端不支持按路径读取文件');
      },
    },
    storage: {
      async get<T>(key: string) {
        try {
          const raw = localStorage.getItem(STORAGE_PREFIX + key);
          return raw === null ? null : (JSON.parse(raw) as T);
        } catch {
          return null;
        }
      },
      async set(key, value) {
        localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
      },
      async remove(key) {
        localStorage.removeItem(STORAGE_PREFIX + key);
      },
    },
    mediaStore: typeof indexedDB !== 'undefined' ? createWebMediaStore() : undefined,
    clipboard: {
      async writeImage(png) {
        if (!('clipboard' in navigator) || typeof ClipboardItem === 'undefined') {
          throw new Error('当前浏览器不支持写入图片到剪贴板');
        }
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      },
    },
  };
}
