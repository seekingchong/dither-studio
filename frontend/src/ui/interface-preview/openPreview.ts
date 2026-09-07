import { FRAME_HEIGHT, FRAME_WIDTH } from './design';
import { SlotExporter } from './exporter';
import { previewMessage } from './protocol';
import { PREVIEW_ROUTE, previewWindowName } from './route';

/** 开着的预览窗口：既用来复用窗口，也用来确认「这条请求是我开的窗发来的」 */
const windows = new Map<number, Window>();
/** 每个坑位一个导出器，窗口关了再开复用同一个（里面有成品缓存） */
const exporters = new Map<number, SlotExporter>();
let listening = false;
let closeWatcher = 0;

/** 关窗的巡检间隔：跨窗口没有关闭事件可听，只能定时看 closed */
const CLOSE_POLL_MS = 1000;

/** 预览窗口跑的是同一份前端，只是地址上多一个 hash */
function previewUrl(slot: number): string {
  const url = new URL(window.location.href);
  url.hash = `${PREVIEW_ROUTE}?slot=${slot}`;
  return url.toString();
}

/** 新窗口开多大：按设计稿比例，尽量大又不超出屏幕（留出窗口边框与标题栏） */
function windowSize(): { width: number; height: number } {
  const availWidth = window.screen?.availWidth ?? FRAME_WIDTH;
  const availHeight = window.screen?.availHeight ?? FRAME_HEIGHT;
  const scale = Math.min((availWidth - 80) / FRAME_WIDTH, (availHeight - 120) / FRAME_HEIGHT, 1);
  return { width: Math.round(FRAME_WIDTH * scale), height: Math.round(FRAME_HEIGHT * scale) };
}

function exporterFor(slot: number): SlotExporter {
  let exporter = exporters.get(slot);
  if (!exporter) {
    exporter = new SlotExporter(slot, (message, transfer) => {
      const win = windows.get(slot);
      if (!win || win.closed) return;
      try {
        win.postMessage(message, '*', transfer ?? []);
      } catch {
        // 窗口刚关，这份成品作废；再开时从缓存给
      }
    });
    exporters.set(slot, exporter);
  }
  return exporter;
}

function onMessage(event: MessageEvent): void {
  const msg = previewMessage(event.data);
  if (!msg || msg.type !== 'request') return;
  const win = windows.get(msg.slot);
  // 只回应自己开出去的那扇窗
  if (!win || win.closed || event.source !== win) return;
  exporterFor(msg.slot).resend();
}

/** 窗口关了就把那个坑位的导出停掉，别再白导 */
function watchClosed(): void {
  if (closeWatcher) return;
  closeWatcher = window.setInterval(() => {
    for (const [slot, win] of windows) {
      if (!win.closed) continue;
      windows.delete(slot);
      exporters.get(slot)?.stop();
    }
    if (windows.size === 0) {
      window.clearInterval(closeWatcher);
      closeWatcher = 0;
    }
  }, CLOSE_POLL_MS);
}

/**
 * 打开（或聚焦）某个坑位的界面预览窗口。
 * 窗口里跑的是同一份前端，按 hash 路由渲染成那张静态界面；
 * 里面的「video cover」放的是真正导出的成品：这边把当前坑位导成 PNG（图片）或 MP4（视频 / GIF）
 * 送过去，参数一改就重导，所以那边看到的就是最终导出文件的样子。
 *
 * 返回 false 表示被浏览器的弹窗拦截拦下了。
 */
export function openInterfacePreview(slot: number): boolean {
  const existing = windows.get(slot);
  if (existing && !existing.closed) {
    existing.focus();
    return true;
  }
  windows.delete(slot);
  if (!listening) {
    window.addEventListener('message', onMessage);
    listening = true;
  }
  const { width, height } = windowSize();
  const win = window.open(previewUrl(slot), previewWindowName(slot), `popup=yes,width=${width},height=${height}`);
  if (!win) return false;
  windows.set(slot, win);
  // 窗口还在加载就先导起来：那边就绪后来要，成品多半已经在手上了
  exporterFor(slot).start();
  watchClosed();
  return true;
}
