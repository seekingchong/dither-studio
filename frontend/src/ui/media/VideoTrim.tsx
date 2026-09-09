import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { LoadedMedia } from '@/state';
import { useRenderClient } from '@/ui/renderer/RendererContext';
import { formatTime, playbackOf, trimRange, usePlaybackStore } from './playback';
import { usePlaybackControls } from './usePlaybackController';

/** 方向键每次挪 0.1 秒，按住 Shift 挪 1 秒 */
const STEP = 0.1;
const STEP_FAST = 1;

/** 边线左右多少像素内按下算「拖这一端」 */
const EDGE_PX = 9;

/** 正在拖谁：窗口整体 / 起点 / 终点 */
type Grab = 'move' | 'start' | 'end';

interface VideoTrimProps {
  slot: number;
  media: LoadedMedia;
}

/**
 * 视频素材卡片下的裁剪条，「原图」「结果」两个页签都在：拖两端定裁剪范围、拖中间整体挪。
 * 窗长由用户自己定（最短 TRIM_MIN_SECONDS，最长整段），刚载入的视频默认取开头 TRIM_SECONDS 秒。
 * 播放在这个窗口里循环，导出也只出这一段。
 *
 * 暂停时拖两端，画面跟着停在被拖的那一端（`seek` 会重渲染那一帧），手上改哪头就看见哪头——
 * 「原图」页看到的是源画面那一帧，「结果」页看到的是同一帧的成品；
 * 播放中不抢画面——播放本来就在新窗口里循环，一圈之内自己就走到新范围里了。
 */
export function VideoTrim({ slot, media }: VideoTrimProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLSpanElement>(null);
  const endRef = useRef<HTMLSpanElement>(null);
  const client = useRenderClient();
  const { seek } = usePlaybackControls(slot, media, client);
  const [grab, setGrab] = useState<Grab | null>(null);
  const entry = usePlaybackStore((s) => s.slots[slot]);
  const duration = entry?.duration || media.duration || 0;
  const time = entry?.time ?? 0;
  const { start, end, length, maxStart, minLength, maxLength } = trimRange(duration, entry?.trimStart ?? 0, entry?.trimLength ?? null);
  if (duration <= 0) return null;

  const pct = (seconds: number) => `${(seconds / duration) * 100}%`;

  /** 写回窗口；`at` 是这一步想让画面停在哪（拖两端时就是被拖的那一端，播放中不给） */
  const setWindow = (nextStart: number, nextLength: number, at?: number) => {
    const next = trimRange(duration, nextStart, nextLength);
    if (Math.abs(next.start - start) < 1e-4 && Math.abs(next.length - length) < 1e-4) return;
    usePlaybackStore.getState().update(slot, { trimStart: next.start, trimLength: next.length });
    // 播放头落在新窗口外就拉回来，免得画面停在裁掉的那截上
    const current = playbackOf(slot).time;
    const target = at ?? (current < next.start || current > next.end ? next.start : null);
    if (target != null) seek(Math.min(next.end, Math.max(next.start, target)));
  };

  /** 拖两端时让画面跟到那一端；播放中交给播放循环，别跟它抢 */
  const peek = (at: number) => (playbackOf(slot).playing ? undefined : at);

  const moveTo = (nextStart: number) => setWindow(nextStart, length);
  const setStart = (nextStart: number) => {
    const clamped = Math.min(end - minLength, Math.max(0, nextStart));
    setWindow(clamped, end - clamped, peek(clamped));
  };
  const setEnd = (nextEnd: number) => {
    const clamped = Math.min(maxLength, Math.max(start + minLength, nextEnd));
    setWindow(start, clamped - start, peek(clamped));
  };

  /**
   * 按在条上拖谁，只看按下的位置离两端有多近，不看压在最上面的是哪个元素——
   * 窗口窄到把手叠在一起时，中间仍然是「整体挪」，两端从窗口外面够得着。
   */
  const targetAt = (px: number, width: number): Grab => {
    const at = (seconds: number) => (seconds / duration) * width;
    const [left, right] = [at(start), at(end)];
    if (right - left >= 3 * EDGE_PX) {
      if (Math.abs(px - left) <= EDGE_PX) return 'start';
      if (Math.abs(px - right) <= EDGE_PX) return 'end';
      return 'move';
    }
    if (px >= left - EDGE_PX && px < left) return 'start';
    if (px > right && px <= right + EDGE_PX) return 'end';
    return 'move';
  };

  /** 一次拖动：按位置认出拖的是哪一段，指针挪到哪就换算成秒喂给对应的写入口 */
  const drag = (e: ReactPointerEvent<HTMLElement>) => {
    const track = trackRef.current;
    if (e.button !== 0 || !track) return;
    e.preventDefault();
    const rect = track.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const timeAt = (clientX: number) => ((clientX - rect.left) / width) * duration;
    const which = targetAt(e.clientX - rect.left, width);
    // 拖整体时保持抓取点在窗口里的相对位置，从窗口外按下则把窗口居中挪过去
    const grabbed = timeAt(e.clientX);
    const offset = which !== 'move' ? 0 : grabbed >= start && grabbed <= end ? grabbed - start : length / 2;
    const apply = (at: number) => (which === 'move' ? moveTo(at - offset) : which === 'start' ? setStart(at) : setEnd(at));
    setGrab(which);
    // 焦点跟着落到被拖的那一段上，松手后方向键接着微调这一端
    (which === 'start' ? startRef : which === 'end' ? endRef : windowRef).current?.focus();
    if (which === 'move') apply(grabbed);
    const move = (ev: PointerEvent) => apply(timeAt(ev.clientX));
    const stop = () => {
      setGrab(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  /** 方向键：`which` 那一段左右微调，Home / End 顶到各自的极限 */
  const keys = (e: KeyboardEvent<HTMLElement>, which: Grab) => {
    const step = e.shiftKey ? STEP_FAST : STEP;
    const delta = e.key === 'ArrowLeft' ? -step : step;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      if (which === 'move') moveTo(start + delta);
      else if (which === 'start') setStart(start + delta);
      else setEnd(end + delta);
    } else if (e.key === 'Home') {
      e.preventDefault();
      if (which === 'move') moveTo(0);
      else if (which === 'start') setStart(0);
      else setEnd(start + minLength);
    } else if (e.key === 'End') {
      e.preventDefault();
      if (which === 'move') moveTo(maxStart);
      else if (which === 'start') setStart(end - minLength);
      else setEnd(maxLength);
    } else return;
    e.stopPropagation();
  };

  /** 窗口两端的把手：画出边线、给键盘一个落脚点；按下拖谁由 `targetAt` 按位置认 */
  const handle = (which: 'start' | 'end') => (
    <span
      ref={which === 'start' ? startRef : endRef}
      className={`trim__handle trim__handle--${which}`}
      style={{ left: pct(which === 'start' ? start : end) }}
      data-testid={`trim-${which}-${slot}`}
      onKeyDown={(e) => keys(e, which)}
      role="slider"
      tabIndex={0}
      aria-label={which === 'start' ? '裁剪起点' : '裁剪终点'}
      aria-valuemin={which === 'start' ? 0 : Number((start + minLength).toFixed(2))}
      aria-valuemax={which === 'start' ? Number((end - minLength).toFixed(2)) : Number(maxLength.toFixed(2))}
      aria-valuenow={Number((which === 'start' ? start : end).toFixed(2))}
      aria-valuetext={formatTime(which === 'start' ? start : end)}
    >
      <span className="trim__handle-bar" aria-hidden="true" />
    </span>
  );

  return (
    <div
      className="trim"
      data-testid={`trim-${slot}`}
      data-trim-start={start.toFixed(2)}
      data-trim-length={length.toFixed(2)}
      data-trim-end={end.toFixed(2)}
      data-duration={duration.toFixed(2)}
      data-grab={grab ?? 'none'}
    >
      <div className="trim__head">
        <span className="trim__title">裁剪 {length.toFixed(1)} 秒</span>
        <span className="trim__range" data-testid={`trim-range-${slot}`}>
          {formatTime(start)} – {formatTime(end)}
        </span>
      </div>
      <div ref={trackRef} className="trim__track" onPointerDown={drag} role="group" aria-label="裁剪范围">
        <div
          ref={windowRef}
          className="trim__window"
          style={{ left: pct(start), width: pct(length) }}
          onKeyDown={(e) => keys(e, 'move')}
          role="slider"
          tabIndex={0}
          aria-label="裁剪窗口的位置"
          aria-valuemin={0}
          aria-valuemax={Number(maxStart.toFixed(2))}
          aria-valuenow={Number(start.toFixed(2))}
          aria-valuetext={`${formatTime(start)} 起，共 ${length.toFixed(1)} 秒`}
        >
          <span className="trim__grip" aria-hidden="true" />
          <span className="trim__grip" aria-hidden="true" />
        </div>
        {handle('start')}
        {handle('end')}
        <div className="trim__playhead" style={{ left: pct(Math.min(duration, Math.max(0, time))) }} aria-hidden="true" />
      </div>
    </div>
  );
}
