import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { LoadedMedia } from '@/state';
import { TRIM_SECONDS, formatTime, playbackOf, trimRange, usePlaybackStore } from './playback';

/** 方向键每次挪 0.1 秒，按住 Shift 挪 1 秒 */
const STEP = 0.1;
const STEP_FAST = 1;

interface VideoTrimProps {
  slot: number;
  media: LoadedMedia;
}

/**
 * 「原图」页里视频素材卡片下的裁剪条：窗长固定 TRIM_SECONDS 秒，
 * 左右拖窗口挑这段视频里的哪四秒。播放在这个窗口里循环，导出也只出这一段。
 * 视频短于窗长时窗口就是整段，滑不动。
 */
export function VideoTrim({ slot, media }: VideoTrimProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const entry = usePlaybackStore((s) => s.slots[slot]);
  const duration = entry?.duration || media.duration || 0;
  const time = entry?.time ?? 0;
  const { start, end, length, maxStart } = trimRange(duration, entry?.trimStart ?? 0);
  if (duration <= 0) return null;

  const pct = (seconds: number) => `${(seconds / duration) * 100}%`;

  const setStart = (next: number) => {
    const clamped = Math.min(maxStart, Math.max(0, next));
    if (Math.abs(clamped - start) < 1e-4) return;
    usePlaybackStore.getState().update(slot, { trimStart: clamped });
    // 播放头落在新窗口外就拉回起点，免得画面停在裁掉的那截上
    const current = playbackOf(slot).time;
    if (current < clamped || current > clamped + length) {
      usePlaybackStore.getState().update(slot, { time: clamped });
      if (media.video) media.video.currentTime = clamped;
    }
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (e.button !== 0 || !track || maxStart <= 0) return;
    e.preventDefault();
    const rect = track.getBoundingClientRect();
    const timeAt = (clientX: number) => ((clientX - rect.left) / Math.max(1, rect.width)) * duration;
    // 按在窗口里就保持抓取点的相对位置，按在窗口外就把窗口居中挪过去
    const grabbed = timeAt(e.clientX);
    const offset = grabbed >= start && grabbed <= end ? grabbed - start : length / 2;
    setStart(grabbed - offset);
    const move = (ev: PointerEvent) => setStart(timeAt(ev.clientX) - offset);
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? STEP_FAST : STEP;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      setStart(start + (e.key === 'ArrowLeft' ? -step : step));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setStart(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setStart(maxStart);
    }
  };

  return (
    <div className="trim" data-testid={`trim-${slot}`} data-trim-start={start.toFixed(2)} data-duration={duration.toFixed(2)}>
      <div className="trim__head">
        <span className="trim__title">裁剪 {length.toFixed(1)} 秒</span>
        <span className="trim__range" data-testid={`trim-range-${slot}`}>
          {formatTime(start)} – {formatTime(end)}
        </span>
      </div>
      <div
        ref={trackRef}
        className="trim__track"
        data-disabled={maxStart <= 0 ? 'true' : 'false'}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        role="slider"
        tabIndex={0}
        aria-label={`裁剪 ${TRIM_SECONDS} 秒片段的起点`}
        aria-valuemin={0}
        aria-valuemax={Number(maxStart.toFixed(2))}
        aria-valuenow={Number(start.toFixed(2))}
        aria-valuetext={`${formatTime(start)} 起，共 ${length.toFixed(1)} 秒`}
      >
        <div className="trim__window" style={{ left: pct(start), width: pct(length) }}>
          <span className="trim__grip" aria-hidden="true" />
          <span className="trim__grip" aria-hidden="true" />
        </div>
        <div className="trim__playhead" style={{ left: pct(Math.min(duration, Math.max(0, time))) }} aria-hidden="true" />
      </div>
    </div>
  );
}
