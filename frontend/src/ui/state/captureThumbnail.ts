import type { RenderClient } from '@/engine';
import { useStudioStore } from '@/state';
import { useFrameStore } from '@/ui/renderer/RendererContext';
import { frameToThumbnail } from './thumbnail';

/** 等待渲染结果落定的上限；超时就用手头的帧 */
const THUMBNAIL_SETTLE_MS = 2000;

/**
 * 当前活动坑位的结果缩略图。参数刚改过时 Worker 可能还没渲完，此时先等这一帧回来，
 * 否则存进历史的缩略图会是上一套参数的结果。
 */
export async function captureThumbnail(client: RenderClient | null): Promise<string | undefined> {
  const slot = useStudioStore.getState().view.activeSlot;
  // 让参数变化触发的 render() 先排上队
  await new Promise<void>((r) => window.setTimeout(r, 0));
  if (client && !client.isSettled(slot)) {
    await new Promise<void>((resolve) => {
      const done = () => {
        window.clearTimeout(timer);
        off();
        resolve();
      };
      const timer = window.setTimeout(done, THUMBNAIL_SETTLE_MS);
      const off = client.onFrame((frame) => {
        if (frame.slot === slot) done();
      });
    });
  }
  return frameToThumbnail(useFrameStore.getState().frames[slot]);
}
