import { useEffect, useRef } from 'react';
import { captureSizeFor, INITIAL_PACER, pacePreview, scaleParamsForPreview, type PreviewPacer, type RenderClient } from '@/engine';
import { isAnimated, useStudioStore, type LoadedMedia } from '@/state';
import { useFrameStore } from '@/ui/renderer/RendererContext';
import { gifFrameAt, playbackOf, trimOf, usePlaybackStore } from './playback';
import { IDENTITY_EDIT, editKey, editOf, editedBitmap, editedSizeOf, useSourceEditStore } from './sourceEdit';

/** 进度条与时间文字的刷新间隔：播放中每帧都写 store 会让整个预览区每帧重渲染 */
const TIME_UPDATE_MS = 120;

/**
 * 播放控制：播放 / 暂停、拖动进度。只读写播放状态，不驱动逐帧渲染，
 * 因此可以在进度条这类组件里安全地用第二份。
 */
export function usePlaybackControls(slot: number, media: LoadedMedia | null, client: RenderClient | null) {
  const counter = useRef(0);

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
                bitmap = await editedBitmap(video, editOf(slot));
              } catch {
                return; // 定位期间媒体被换掉
              }
              const { params, settings } = useStudioStore.getState();
              client.setSource(slot, `${media.id}#seek${++counter.current}`, bitmap);
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

/**
 * 动态媒体的逐帧驱动：视频用 requestVideoFrameCallback，GIF 用各帧时长计时；
 * 每来一帧就把位图送进 Worker 并请求渲染，Worker 忙时丢帧。
 * 抓帧时直接缩到画布尺寸（旋转 / 镜像 / 裁剪也在这一步一起烤进去），
 * 省掉流水线里的整帧重采样；播放时按上一帧的端到端耗时升降预览倍率，
 * 暂停或拖动进度时回到全分辨率。一个坑位只能挂一份，否则会重复抓帧。
 */
export function usePlaybackController(slot: number, media: LoadedMedia | null, client: RenderClient | null) {
  const counter = useRef(0);
  const pacer = useRef<PreviewPacer>(INITIAL_PACER);
  const pushedAt = useRef(0);
  const entry = usePlaybackStore((s) => s.slots[slot]);
  const playing = entry?.playing ?? true;
  const controls = usePlaybackControls(slot, media, client);

  // 媒体切换：初始化播放状态
  useEffect(() => {
    if (!isAnimated(media)) {
      usePlaybackStore.getState().remove(slot);
      return;
    }
    pacer.current = INITIAL_PACER;
    usePlaybackStore.getState().update(slot, { playing: true, time: 0, duration: media!.duration ?? 0, previewScale: 1, frameIndex: 0, trimStart: 0 });
    return () => usePlaybackStore.getState().remove(slot);
  }, [slot, media]);

  // 端到端耗时（抓帧 + 渲染 + 回传）→ 下一帧的预览倍率
  useEffect(() => {
    if (!isAnimated(media)) return;
    return useFrameStore.subscribe((state, prev) => {
      const f = state.frames[slot];
      if (!f || f === prev.frames[slot]) return;
      const pb = playbackOf(slot);
      if (!pb.playing) return;
      const elapsed = pushedAt.current > 0 ? performance.now() - pushedAt.current : f.elapsedMs;
      const next = pacePreview(pacer.current, elapsed);
      pacer.current = next;
      if (next.scale !== pb.previewScale) usePlaybackStore.getState().update(slot, { previewScale: next.scale });
    });
  }, [slot, media]);

  /**
   * 旋转 / 镜像 / 裁剪缩放变了：播放中下一帧自然带上，暂停时得手动补一帧，
   * 否则画面要等到下次播放才更新。
   */
  const currentEditKey = useSourceEditStore((s) => editKey(s.slots[slot] ?? IDENTITY_EDIT));
  useEffect(() => {
    if (!client || !media || !isAnimated(media) || playbackOf(slot).playing) return;
    let cancelled = false;
    void (async () => {
      const frames = media.frames;
      const source = media.kind === 'video' && media.video ? media.video : frames?.[playbackOf(slot).frameIndex % frames.length];
      if (!source) return;
      let bitmap: ImageBitmap;
      try {
        bitmap = await editedBitmap(source, editOf(slot));
      } catch {
        return;
      }
      if (cancelled) {
        bitmap.close();
        return;
      }
      const { params, settings } = useStudioStore.getState();
      client.setSource(slot, `${media.id}#edit${++counter.current}`, bitmap);
      client.render(slot, params, { gpu: settings.gpu, previewScale: 1 });
    })();
    return () => {
      cancelled = true;
    };
  }, [client, media, slot, currentEditKey]);

  useEffect(() => {
    if (!client || !media || !isAnimated(media)) return;
    let disposed = false;
    let capturing = false;
    let lastTimeWrite = 0;

    /** 进度只按固定间隔写进 store：每帧写会带着整个预览区一起重渲染 */
    const reportTime = (time: number, force: boolean) => {
      const now = performance.now();
      if (!force && now - lastTimeWrite < TIME_UPDATE_MS) return;
      lastTimeWrite = now;
      usePlaybackStore.getState().update(slot, { time });
    };

    const push = async (source: ImageBitmap | HTMLVideoElement, full: boolean) => {
      if (disposed) return;
      // capturing 的判断不能省：抓帧是异步的，下一帧回调可能在 render 派发前就到
      if (!full && (capturing || client.isBusy(slot))) return; // 丢帧
      capturing = true;
      const startedAt = performance.now();
      try {
        const { params, settings } = useStudioStore.getState();
        const previewScale = full ? 1 : playbackOf(slot).previewScale;
        const edit = editOf(slot);
        // 抓帧尺寸按降分辨率后的画布算，才不会缩到一半又被流水线再缩一次；
        // 尺寸取变换之后的画面，旋转 90° 与裁剪缩放都算在内。
        // 暂停与拖动进度时抓全分辨率：只抓一帧不差这点耗时，而且之后改画布尺寸
        // 还是从源分辨率重采样，不会二次缩放掉细节。
        const effective = scaleParamsForPreview(params, previewScale).params;
        const out = editedSizeOf(source, edit);
        const size = full ? null : captureSizeFor(out.width, out.height, effective);
        let bitmap: ImageBitmap;
        try {
          bitmap = await editedBitmap(source, edit, size);
        } catch {
          // 媒体刚被换掉 / 释放（<video> 已卸掉 src、位图已 close），这一帧作废即可，不算错误
          return;
        }
        if (disposed) {
          bitmap.close();
          return;
        }
        pushedAt.current = startedAt;
        client.setSource(slot, `${media.id}#${++counter.current}`, bitmap);
        client.render(slot, params, { gpu: settings.gpu, previewScale });
      } finally {
        capturing = false;
      }
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
            reportTime(wrap(meta.mediaTime), false);
            void push(video, false);
            loop();
          });
        } else {
          // 没有 rVFC 的环境按 30 fps 轮询
          fallbackTimer = window.setTimeout(() => {
            reportTime(wrap(video.currentTime), false);
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
        reportTime(video.currentTime, true);
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

  return controls;
}
