import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { RenderClient, type RenderedFrame } from '@/engine';
import { useStudioStore } from '@/state';
import { playbackOf } from '@/ui/media/playback';
import { useToast } from '@/ui/primitives/Toast';

interface FrameState {
  frames: Record<number, RenderedFrame>;
  setFrame(frame: RenderedFrame): void;
  clear(slot: number): void;
}

/** 每个坑位最近一帧渲染结果，画布与导出都从这里取 */
export const useFrameStore = create<FrameState>((set) => ({
  frames: {},
  setFrame: (frame) => set((s) => ({ frames: { ...s.frames, [frame.slot]: frame } })),
  clear: (slot) =>
    set((s) => {
      if (!(slot in s.frames)) return s;
      const frames = { ...s.frames };
      delete frames[slot];
      return { frames };
    }),
}));

const RendererContext = createContext<RenderClient | null>(null);

export function useRenderClient(): RenderClient | null {
  return useContext(RendererContext);
}

/**
 * 渲染调度：把 store 里的坑位媒体同步到 Worker，参数变化时请求重渲染。
 * 位图先复制一份再转移给 Worker，主线程保留原图用于"原图"视图。
 */
export function RendererProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<RenderClient | null>(null);
  const posted = useRef(new Map<number, string>());

  useEffect(() => {
    const c = new RenderClient();
    const offFrame = c.onFrame((frame) => useFrameStore.getState().setFrame(frame));
    const offError = c.onError((slot, message) => useToast.getState().show(`渲染失败（坑位 ${slot + 1}）：${message}`, 'error'));
    setClient(c);
    posted.current.clear();
    return () => {
      offFrame();
      offError();
      c.dispose();
      setClient(null);
    };
  }, []);

  const slots = useStudioStore((s) => s.slots);
  const params = useStudioStore((s) => s.params);
  const gpu = useStudioStore((s) => s.settings.gpu);

  // 坑位媒体 → Worker 源帧
  useEffect(() => {
    if (!client) return;
    const map = posted.current;
    slots.forEach((slot, i) => {
      const media = slot.media;
      const postedId = map.get(i);
      if (!media) {
        if (postedId) {
          map.delete(i);
          client.clearSource(i);
          useFrameStore.getState().clear(i);
        }
        return;
      }
      if (postedId === media.id) return;
      map.set(i, media.id);
      createImageBitmap(media.bitmap).then(
        (bitmap) => {
          if (map.get(i) !== media.id) {
            bitmap.close();
            return;
          }
          client.setSource(i, media.id, bitmap);
          const { params, settings } = useStudioStore.getState();
          client.render(i, params, { gpu: settings.gpu, previewScale: 1 });
        },
        (err: Error) => useToast.getState().show(`无法解码 ${media.name}：${err.message}`, 'error'),
      );
    });
    for (const i of Array.from(map.keys())) {
      if (i >= slots.length) {
        map.delete(i);
        client.clearSource(i);
        useFrameStore.getState().clear(i);
      }
    }
  }, [client, slots]);

  // 参数或 GPU 开关变化 → 重渲染所有已就绪的坑位（播放中的坑位沿用当前预览倍率）
  useEffect(() => {
    if (!client) return;
    for (const [i, id] of posted.current) {
      if (slots[i]?.media?.id === id) {
        const pb = playbackOf(i);
        client.render(i, params, { gpu, previewScale: pb.playing && pb.duration > 0 ? pb.previewScale : 1 });
      }
    }
  }, [client, params, slots, gpu]);

  return <RendererContext.Provider value={client}>{children}</RendererContext.Provider>;
}
