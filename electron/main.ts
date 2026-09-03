import { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, shell } from 'electron';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { MediaFile, SavedFile } from '@/platform/types';
import { mimeFromName } from '@/platform/types';

const execFileAsync = promisify(execFile);
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

// ---------- 窗口 ----------

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1920,
    height: 992,
    minWidth: 1180,
    minHeight: 720,
    title: 'Dither Studio',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  if (process.env.DITHER_SMOKE) {
    // 冒烟模式：页面加载完成即退出，用于无头环境验证壳层能起来
    win.webContents.once('did-finish-load', () => {
      console.log('[smoke] 渲染进程加载完成:', win.webContents.getURL());
      setTimeout(() => app.quit(), 500);
    });
    win.webContents.once('did-fail-load', (_e, code, desc) => {
      console.error('[smoke] 加载失败', code, desc);
      app.exit(1);
    });
  }
  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(__dirname, '..', '..', 'frontend', 'dist', 'index.html'));
  }
  // 外链一律交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  return win;
}

// ---------- 本地存储（预设、设置） ----------

const storageFile = () => path.join(app.getPath('userData'), 'storage.json');
let storageCache: Record<string, unknown> | null = null;

async function loadStorage(): Promise<Record<string, unknown>> {
  if (storageCache) return storageCache;
  try {
    storageCache = JSON.parse(await fs.readFile(storageFile(), 'utf8')) as Record<string, unknown>;
  } catch {
    storageCache = {};
  }
  return storageCache;
}

let storageWrite: Promise<void> = Promise.resolve();
function persistStorage(data: Record<string, unknown>): Promise<void> {
  const file = storageFile();
  storageWrite = storageWrite
    .then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(data), 'utf8');
      await fs.rename(tmp, file);
    })
    .catch((err) => console.error('[storage] 写入失败', err));
  return storageWrite;
}

// ---------- IPC ----------

const MEDIA_FILTERS = [
  { name: '图片与视频', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'heif', 'mp4', 'webm', 'mov'] },
  { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'heif'] },
  { name: '视频', extensions: ['mp4', 'webm', 'mov'] },
];

function registerIpc() {
  ipcMain.handle('files:openMedia', async (event): Promise<MediaFile[]> => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      filters: MEDIA_FILTERS,
    });
    if (result.canceled) return [];
    return Promise.all(
      result.filePaths.map(async (filePath) => ({
        name: path.basename(filePath),
        mime: mimeFromName(filePath),
        bytes: new Uint8Array(await fs.readFile(filePath)),
        path: filePath,
      })),
    );
  });

  ipcMain.handle('files:save', async (event, bytes: Uint8Array, name: string, mime: string): Promise<SavedFile | null> => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const ext = path.extname(name).replace('.', '');
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: path.join(app.getPath('pictures'), name),
      filters: ext ? [{ name: mime || ext.toUpperCase(), extensions: [ext] }] : [],
    });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    return { path: result.filePath };
  });

  ipcMain.handle('files:read', async (_event, filePath: string): Promise<Uint8Array> => {
    return new Uint8Array(await fs.readFile(filePath));
  });

  ipcMain.handle('files:reveal', async (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle('storage:get', async (_event, key: string) => {
    const data = await loadStorage();
    return data[key] ?? null;
  });
  ipcMain.handle('storage:set', async (_event, key: string, value: unknown) => {
    const data = await loadStorage();
    data[key] = value;
    await persistStorage(data);
  });
  ipcMain.handle('storage:remove', async (_event, key: string) => {
    const data = await loadStorage();
    delete data[key];
    await persistStorage(data);
  });

  ipcMain.handle('clipboard:writeImage', async (_event, png: Uint8Array) => {
    const blob = new Blob([Buffer.from(png.buffer, png.byteOffset, png.byteLength)], { type: 'image/png' });
    await clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  });
  ipcMain.handle('clipboard:writeFile', async (_event, filePath: string) => {
    if (process.platform === 'darwin') {
      // macOS 原生 pasteboard 的 public.file-url 类型：Finder 里可直接粘贴出文件
      const url = pathToFileURL(filePath).href;
      await clipboard.write([
        new ClipboardItem({
          'electron application/osclipboard;format="public.file-url"': new Blob([Buffer.from(url, 'utf8')]),
          'text/plain': filePath,
        }),
      ]);
    } else {
      await clipboard.writeText(filePath);
    }
  });

  // HEIC → PNG：macOS 自带 sips，零依赖
  ipcMain.handle('media:convertHeic', async (_event, bytes: Uint8Array): Promise<Uint8Array> => {
    if (process.platform !== 'darwin') throw new Error('HEIC 转码仅支持 macOS');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dither-heic-'));
    const input = path.join(dir, 'input.heic');
    const output = path.join(dir, 'output.png');
    try {
      await fs.writeFile(input, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      await execFileAsync('sips', ['-s', 'format', 'png', input, '--out', output]);
      return new Uint8Array(await fs.readFile(output));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
}

// ---------- 生命周期 ----------

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
