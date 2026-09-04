import { useCallback } from 'react';
import type { RenderedFrame } from '@/engine';
import { usePlatform } from '@/platform';
import { useStudioStore } from '@/state';
import { usePlaybackStore } from '@/ui/media/playback';
import { useToast } from '@/ui/primitives/Toast';
import { useFrameStore } from '@/ui/renderer/RendererContext';
import { exportFileName, frameToPngBlob } from './png';

/** 等一帧全分辨率结果的超时；超时就用手上这帧，总比不导出好 */
const FULL_FRAME_TIMEOUT_MS = 5000;

/**
 * 播放中的预览帧是降分辨率的，直接导出会得到一张糊图。
 * 先暂停该坑位，等驱动重新渲染出全分辨率的一帧再导。
 */
function fullFrame(slot: number, current: RenderedFrame): Promise<RenderedFrame> {
  if (current.scale >= 1) return Promise.resolve(current);
  usePlaybackStore.getState().update(slot, { playing: false, previewScale: 1 });
  return new Promise((resolve) => {
    let off = () => {};
    const timer = window.setTimeout(() => {
      off();
      resolve(useFrameStore.getState().frames[slot] ?? current);
    }, FULL_FRAME_TIMEOUT_MS);
    off = useFrameStore.subscribe((state) => {
      const f = state.frames[slot];
      if (!f || f.scale < 1) return;
      window.clearTimeout(timer);
      off();
      resolve(f);
    });
  });
}

/** 导出与复制当前坑位的 PNG */
export function useExport() {
  const platform = usePlatform();
  const show = useToast((s) => s.show);
  const activeSlot = useStudioStore((s) => s.view.activeSlot);
  const media = useStudioStore((s) => s.slots[s.view.activeSlot]?.media ?? null);
  const rendered = useFrameStore((s) => s.frames[activeSlot]);
  const canExport = !!rendered && !!media;

  const exportPng = useCallback(async () => {
    if (!rendered || !media) return;
    try {
      const blob = await frameToPngBlob((await fullFrame(activeSlot, rendered)).frame);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const saved = await platform.files.save(bytes, exportFileName(media.name, 'png'), 'image/png');
      if (saved) show(`已导出 ${saved.path}`);
    } catch (err) {
      show(`导出失败：${(err as Error).message}`, 'error');
    }
  }, [platform, rendered, media, show, activeSlot]);

  const copyPng = useCallback(async () => {
    if (!rendered) return;
    try {
      const blob = await frameToPngBlob((await fullFrame(activeSlot, rendered)).frame);
      await platform.clipboard.writeImage(blob);
      show('已复制 PNG 到剪贴板');
    } catch (err) {
      show(`复制失败：${(err as Error).message}`, 'error');
    }
  }, [platform, rendered, show, activeSlot]);

  return { canExport, exportPng, copyPng };
}
