import { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, shell } from 'electron';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { installMenu, type MenuAction } from './menu';
import type { MediaFile, SavedFile } from '@/platform/types';
import { mimeFromName } from '@/platform/types';

const execFileAsync = promisify(execFile);
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const APP_NAME = 'Dither Studio';

// 开发模式下运行的是 Electron 二进制，macOS 菜单栏第一项仍会显示 Electron（系统取的是 bundle 名），
// 但 about 面板、通知、Dock 图标可以先改过来；打包后由 productName 决定。
app.setName(APP_NAME);

const SMOKE_SCRIPT = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 50 && !document.querySelector('[data-slot="0"]'); i++) await wait(100);
  const slot = document.querySelector('[data-slot="0"]');
  if (!slot) return 'no-slot';
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, '#000'); g.addColorStop(1, '#fff');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'smoke.png', { type: 'image/png' }));
  slot.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  for (let i = 0; i < 100 && slot.getAttribute('data-rendered') !== 'true'; i++) await wait(100);
  return slot.getAttribute('data-rendered') === 'true' ? 'rendered' : 'not-rendered';
})()`;

// ---------- 窗口 ----------

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1920,
    height: 992,
    minWidth: 1180,
    minHeight: 720,
    title: APP_NAME,
    show: false,
    // 圆角由系统按窗口形状裁剪，应用侧用 --tda-radius-window 对齐；窗口底色取页面底色，
    // 免得系统圆角比应用圆角小的时候在四角露出一圈不同的颜色。
    backgroundColor: '#F9F9F9',
    // macOS：隐藏标题栏（连带标题文字与那条分隔线），只把红黄绿三个圆点浮在内容上，
    // 位置对齐 --tda-titlebar-height 那条透明拖动区。Windows / Linux 保留系统标题栏。
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 16, y: 11 } } : {}),
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
    // 冒烟模式：页面加载后合成一张图丢进坑位，等待 Worker 渲染完成再退出。用于无头环境验证壳层 + Worker 可用。
    win.webContents.on('console-message', (event) => {
      const level = 'level' in event ? String(event.level) : 'log';
      console.log(`[renderer:${level}]`, 'message' in event ? event.message : '');
    });
    win.webContents.once('did-finish-load', async () => {
      console.log('[smoke] 渲染进程加载完成:', win.webContents.getURL());
      try {
        const result = await win.webContents.executeJavaScript(SMOKE_SCRIPT, true);
        console.log('[smoke] 结果:', result);
        setTimeout(() => app.exit(result === 'rendered' ? 0 : 2), 200);
      } catch (err) {
        console.error('[smoke] 脚本失败', err);
        app.exit(1);
      }
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

  ipcMain.handle('files:saveTemp', async (_event, bytes: Uint8Array, name: string): Promise<SavedFile> => {
    const dir = path.join(app.getPath('temp'), 'dither-studio');
    await fs.mkdir(dir, { recursive: true });
    const safe = name.replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_');
    const filePath = path.join(dir, `${Date.now()}-${safe}`);
    await fs.writeFile(filePath, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    return { path: filePath };
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
  installMenu((action: MenuAction) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    win?.webContents.send('menu', action);
  });
  if (!app.isPackaged && process.platform === 'darwin' && app.dock) {
    const icon = path.join(__dirname, '..', '..', 'build', 'icon.png');
    app.dock.setIcon(icon);
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
