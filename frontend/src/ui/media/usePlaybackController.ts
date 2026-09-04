import { useEffect, useRef } from 'react';
import { nextPreviewScale, type RenderClient } from '@/engine';
import { isAnimated, useStudioStore, type LoadedMedia } from '@/state';
import { useFrameStore } from '@/ui/renderer/RendererContext';
import { gifFrameAt, playbackOf, trimOf, usePlaybackStore } from './playback';

/**
 * 动态媒体的逐帧驱动：视频用 requestVideoFrameCallback，GIF 用各帧时长计时；
 * 每来一帧就把位图送进 Worker 并请求渲染，Worker 忙时丢帧。
 * 暂停或拖动进度时以全分辨率渲染当前帧；播放时按上一帧耗时自动降预览分辨率。
 */
export function usePlaybackController(slot: number, media: LoadedMedia | null, client: RenderClient | null) {
  const counter = useRef(0);
  const entry = usePlaybackStore((s) => s.slots[slot]);
  const playing = entry?.playing ?? true;

  // 媒体切换：初始化播放状态
  useEffect(() => {
    if (!isAnimated(media)) {
      usePlaybackStore.getState().remove(slot);
      return;
    }
    usePlaybackStore.getState().update(slot, { playing: true, time: 0, duration: media!.duration ?? 0, previewScale: 1, frameIndex: 0, trimStart: 0 });
    return () => usePlaybackStore.getState().remove(slot);
  }, [slot, media]);

  // 渲染耗时 → 预览倍率
  useEffect(() => {
    if (!isAnimated(media)) return;
    return useFrameStore.subscribe((state, prev) => {
      const f = state.frames[slot];
      if (!f || f === prev.frames[slot]) return;
      const pb = playbackOf(slot);
      if (!pb.playing) return;
      const next = nextPreviewScale(pb.previewScale, f.elapsedMs);
      if (next !== pb.previewScale) usePlaybackStore.getState().update(slot, { previewScale: next });
    });
  }, [slot, media]);

  useEffect(() => {
    if (!client || !media || !isAnimated(media)) return;
    let disposed = false;
    const push = async (source: ImageBitmap | HTMLVideoElement, full: boolean) => {
      if (disposed) return;
      if (!full && client.isBusy(slot)) return; // 丢帧
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(source);
      } catch {
        // 媒体刚被换掉 / 释放（<video> 已卸掉 src、位图已 close），这一帧作废即可，不算错误
        return;
      }
      if (disposed) {
        bitmap.close();
        return;
      }
      const id = `${media.id}#${++counter.current}`;
      const { params, settings } = useStudioStore.getState();
      client.setSource(slot, id, bitmap);
      client.render(slot, params, { gpu: settings.gpu, previewScale: full ? 1 : playbackOf(slot).previewScale });
    };

    if (media.kind === 'video' && media.video) {
      const video = media.video;
      const hasRvfc = typeof (video as unknown as Record<string, unknown>).requestVideoFrameCallback === 'function';
      let handle = 0;
      let fallbackTimer = 0;
      /**
       * 播放只在裁剪窗口里循环：越过窗口末尾（或被拖到窗口外）就跳回起点。
       * 起点变化不用重启这个 effect——每帧现取窗口即可。
       */
      const wrap = (time: number): number => {
        const { start, end } = trimOf(slot);
        if (time >= end - 1e-3 || time < start - 1e-3) {
          video.currentTime = start;
          return start;
        }
        return time;
      };
      const loop = () => {
        if (disposed) return;
        if (hasRvfc) {
          handle = video.requestVideoFrameCallback((_now, meta) => {
            usePlaybackStore.getState().update(slot, { time: wrap(meta.mediaTime) });
            void push(video, false);
            loop();
          });
        } else {
          // 没有 rVFC 的环境按 30 fps 轮询
          fallbackTimer = window.setTimeout(() => {
            usePlaybackStore.getState().update(slot, { time: wrap(video.currentTime) });
            void push(video, false);
            loop();
          }, 33);
        }
      };
      if (playing) {
        void video.play().catch(() => undefined);
        loop();
      } else {
        video.pause();
        void push(video, true);
      }
      return () => {
        disposed = true;
        if (handle && hasRvfc) video.cancelVideoFrameCallback(handle);
        window.clearTimeout(fallbackTimer);
        video.pause();
      };
    }

    if (media.kind === 'gif' && media.frames && media.delays) {
      const frames = media.frames;
      const delays = media.delays;
      let timer = 0;
      const tick = () => {
        if (disposed) return;
        const pb = playbackOf(slot);
        const index = pb.frameIndex % frames.length;
        void push(frames[index], !pb.playing);
        if (!pb.playing) return;
        const next = (index + 1) % frames.length;
        const elapsed = delays.slice(0, next).reduce((s, d) => s + d, 0);
        timer = window.setTimeout(() => {
          usePlaybackStore.getState().update(slot, { frameIndex: next, time: elapsed });
          tick();
        }, delays[index] * 1000);
      };
      tick();
      return () => {
        disposed = true;
        window.clearTimeout(timer);
      };
    }
    return undefined;
  }, [client, media, slot, playing]);

  /** 拖动进度：视频定位后渲染一帧；GIF 切到对应帧 */
  const seek = (time: number) => {
    if (!media || !isAnimated(media)) return;
    if (media.kind === 'video' && media.video) {
      const video = media.video;
      video.currentTime = time;
      usePlaybackStore.getState().update(slot, { time });
      if (!playbackOf(slot).playing && client) {
        video.addEventListener(
          'seeked',
          () => {
            void (async () => {
              let bitmap: ImageBitmap;
              try {
                bitmap = await createImageBitmap(video);
              } catch {
                return; // 定位期间媒体被换掉
              }
              const { params, settings } = useStudioStore.getState();
              client.setSource(slot, `${media.id}#${++counter.current}`, bitmap);
              client.render(slot, params, { gpu: settings.gpu, previewScale: 1 });
            })();
          },
          { once: true },
        );
      }
    } else if (media.kind === 'gif' && media.delays) {
      const index = gifFrameAt(media.delays, time);
      usePlaybackStore.getState().update(slot, { time, frameIndex: index });
    }
  };

  const toggle = () => usePlaybackStore.getState().update(slot, { playing: !playbackOf(slot).playing });

  return { seek, toggle };
}
