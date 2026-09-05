import { useCallback } from 'react';
import type { RGBAFrame } from '@/engine';
import { usePlatform } from '@/platform';
import { useStudioStore } from '@/state';
import { usePlaybackStore } from '@/ui/media/playback';
import { useToast } from '@/ui/primitives/Toast';
import { useFrameStore, useRenderClient } from '@/ui/renderer/RendererContext';
import { exportFileName, frameToPngBlob } from './png';
import { frameToSvg } from './svg';

/** 等全分辨率那一帧回来的上限；超时就用手头的 */
const FULL_FRAME_SETTLE_MS = 2000;

/**
 * 导出用的当前帧。播放中的预览是降分辨率的（`scale < 1`），直接拿去导会得到一张比画布小的图，
 * 所以先暂停，等控制器补回来的那张全分辨率帧。
 */
async function fullFrame(slot: number, current: RGBAFrame, scale: number): Promise<RGBAFrame> {
  if (scale === 1) return current;
  usePlaybackStore.getState().update(slot, { playing: false });
  return new Promise<RGBAFrame>((resolve) => {
    const done = (frame: RGBAFrame) => {
      window.clearTimeout(timer);
      off();
      resolve(frame);
    };
    const timer = window.setTimeout(() => done(useFrameStore.getState().frames[slot]?.frame ?? current), FULL_FRAME_SETTLE_MS);
    const off = useFrameStore.subscribe((state) => {
      const next = state.frames[slot];
      if (next && next.scale === 1) done(next.frame);
    });
  });
}

/** 导出当前坑位：PNG、SVG（当前帧的矢量版）、复制 PNG */
export function useExport() {
  const platform = usePlatform();
  const client = useRenderClient();
  const show = useToast((s) => s.show);
  const activeSlot = useStudioStore((s) => s.view.activeSlot);
  const media = useStudioStore((s) => s.slots[s.view.activeSlot]?.media ?? null);
  const rendered = useFrameStore((s) => s.frames[activeSlot]);
  const canExport = !!rendered && !!media;

  const exportPng = useCallback(async () => {
    if (!rendered || !media) return;
    try {
      const frame = await fullFrame(activeSlot, rendered.frame, rendered.scale);
      const blob = await frameToPngBlob(frame);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const saved = await platform.files.save(bytes, exportFileName(media.name, 'png'), 'image/png');
      if (saved) show(`已导出 ${saved.path}`);
    } catch (err) {
      show(`导出失败：${(err as Error).message}`, 'error');
    }
  }, [platform, rendered, media, activeSlot, show]);

  /**
   * 矢量版由 Worker 按全分辨率参数直接算：抖动把成品帧的实色块并成 path，排线出真正的笔画（圆角矩形），
   * 不用等预览补回全分辨率帧。播放中先停下，Worker 里的源帧就是停下那一帧。没有渲染器时退回主线程从当前帧出。
   */
  const exportSvg = useCallback(async () => {
    if (!rendered || !media) return;
    try {
      let svg: string;
      if (client) {
        if (rendered.scale !== 1) usePlaybackStore.getState().update(activeSlot, { playing: false });
        const state = useStudioStore.getState();
        svg = await client.exportSvg(activeSlot, state.params, { gpu: state.settings.gpu });
      } else {
        svg = frameToSvg(await fullFrame(activeSlot, rendered.frame, rendered.scale));
      }
      const bytes = new TextEncoder().encode(svg);
      const saved = await platform.files.save(bytes, exportFileName(media.name, 'svg'), 'image/svg+xml');
      if (saved) show(`已导出 ${saved.path}`);
    } catch (err) {
      show(`导出帧失败：${(err as Error).message}`, 'error');
    }
  }, [platform, client, rendered, media, activeSlot, show]);

  const copyPng = useCallback(async () => {
    if (!rendered) return;
    try {
      const blob = await frameToPngBlob(rendered.frame);
      await platform.clipboard.writeImage(blob);
      show('已复制 PNG 到剪贴板');
    } catch (err) {
      show(`复制失败：${(err as Error).message}`, 'error');
    }
  }, [platform, rendered, show]);

  return { canExport, exportPng, exportSvg, copyPng };
}
