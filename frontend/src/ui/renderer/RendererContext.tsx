import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { RenderClient, type RenderedFrame } from '@/engine';
import { useStudioStore } from '@/state';
import { playbackOf } from '@/ui/media/playback';
import { editKey, editOf, editedBitmap, useSourceEditStore } from '@/ui/media/sourceEdit';
import { useToast } from '@/ui/primitives/Toast';

interface FrameState {
  frames: Record<number, RenderedFrame>;
  /** 每个坑位的渲染序号，每收到一帧 +1。落到 DOM 上供验收脚本判断"又渲染了一次" */
  seq: Record<number, number>;
  setFrame(frame: RenderedFrame): void;
  clear(slot: number): void;
}

/** 每个坑位最近一帧渲染结果，画布与导出都从这里取 */
export const useFrameStore = create<FrameState>((set) => ({
  frames: {},
  seq: {},
  setFrame: (frame) =>
    set((s) => ({ frames: { ...s.frames, [frame.slot]: frame }, seq: { ...s.seq, [frame.slot]: (s.seq[frame.slot] ?? 0) + 1 } })),
  clear: (slot) =>
    set((s) => {
      if (!(slot in s.frames)) return s;
      const frames = { ...s.frames };
      delete frames[slot];
      const seq = { ...s.seq };
      delete seq[slot];
      return { frames, seq };
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
  // 素材编辑（旋转 / 镜像 / 裁剪缩放）也决定送进 Worker 的源帧，改了要重推
  const edits = useSourceEditStore((s) => s.slots);

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
      const key = `${media.id}#${editKey(editOf(i))}`;
      if (postedId === key) return;
      map.set(i, key);
      editedBitmap(media.bitmap, editOf(i)).then(
        (bitmap) => {
          if (map.get(i) !== key) {
            bitmap.close();
            return;
          }
          client.setSource(i, key, bitmap);
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
  }, [client, slots, edits]);

  // 参数或 GPU 开关变化 → 重渲染所有已就绪的坑位（播放中的坑位沿用当前预览倍率）
  useEffect(() => {
    if (!client) return;
    for (const [i, key] of posted.current) {
      // 推送键是「媒体 id # 编辑」，这里只认媒体那一截
      const mediaId = slots[i]?.media?.id;
      if (mediaId && key.slice(0, key.indexOf('#')) === mediaId) {
        const pb = playbackOf(i);
        client.render(i, params, { gpu, previewScale: pb.playing && pb.duration > 0 ? pb.previewScale : 1 });
      }
    }
  }, [client, params, slots, gpu]);

  return <RendererContext.Provider value={client}>{children}</RendererContext.Provider>;
}
