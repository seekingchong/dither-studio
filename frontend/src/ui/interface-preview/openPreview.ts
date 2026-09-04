import { useStudioStore } from '@/state';
import { slotCanvas } from '@/ui/canvas/slotCanvasRegistry';
import { FRAME_HEIGHT, FRAME_WIDTH } from './design';
import { PREVIEW_CHANNEL, previewMessage, type PreviewFrame } from './protocol';
import { PREVIEW_ROUTE, previewWindowName } from './route';

/**
 * 传给预览窗口的位图最长边上限。封面容器在设计稿上只有 99×59，
 * 再大也只是白搬运；这个值只是防住异常大的请求。
 */
const MAX_FRAME_EDGE = 720;

/** 开着的预览窗口：既用来复用窗口，也用来确认「这条请求是我开的窗发来的」 */
const windows = new Map<number, Window>();
let listening = false;

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

/**
 * 抓帧尺寸：等比缩到预览窗口要的框里（它是「整张放进去」的画法，所以按 contain 算），
 * 画布本来就比框小就原样传。
 */
function captureSize(canvas: HTMLCanvasElement, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const limitWidth = Math.min(Math.max(1, maxWidth), MAX_FRAME_EDGE);
  const limitHeight = Math.min(Math.max(1, maxHeight), MAX_FRAME_EDGE);
  const scale = Math.min(limitWidth / canvas.width, limitHeight / canvas.height, 1);
  return {
    width: Math.max(1, Math.round(canvas.width * scale)),
    height: Math.max(1, Math.round(canvas.height * scale)),
  };
}

/** 回一帧给预览窗口 */
async function serveFrame(win: Window, slot: number, maxWidth: number, maxHeight: number): Promise<void> {
  const media = useStudioStore.getState().slots[slot]?.media ?? null;
  const canvas = slotCanvas(slot);
  let bitmap: ImageBitmap | null = null;
  if (media && canvas && canvas.width > 0 && canvas.height > 0) {
    const size = captureSize(canvas, maxWidth, maxHeight);
    try {
      bitmap = await createImageBitmap(canvas, { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'high' });
    } catch {
      // 画布这一刻读不了（尺寸刚变成 0 / 正在重建），这一帧作废，下一帧再要
      bitmap = null;
    }
  }
  // 抓帧是异步的，回来时窗口可能已经关了
  if (win.closed) {
    bitmap?.close();
    return;
  }
  const frame: PreviewFrame = {
    channel: PREVIEW_CHANNEL,
    type: 'frame',
    slot,
    bitmap,
    media: media ? { name: media.name, kind: media.kind, width: media.width, height: media.height } : null,
  };
  try {
    win.postMessage(frame, '*', bitmap ? [bitmap] : []);
  } catch {
    bitmap?.close();
  }
}

function onMessage(event: MessageEvent): void {
  const msg = previewMessage(event.data);
  if (!msg || msg.type !== 'request') return;
  const win = windows.get(msg.slot);
  // 只回应自己开出去的那扇窗
  if (!win || win.closed || event.source !== win) return;
  void serveFrame(win, msg.slot, msg.width, msg.height);
}

/**
 * 打开（或聚焦）某个坑位的界面预览窗口。
 * 窗口里跑的是同一份前端，按 hash 路由渲染成那张静态界面；
 * 里面的「video cover」是活的——它按自己的节奏来要帧，这边逐帧回传当前预览画布，
 * 所以视频 / GIF 在那儿跟主窗口一样循环播放。
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
  return true;
}
