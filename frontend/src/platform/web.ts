import { MEDIA_EXTENSIONS, mimeFromName, type MediaFile, type Platform, type SavedFile } from './types';

const STORAGE_PREFIX = 'dither-studio:';

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
