import { useShallow } from 'zustand/react/shallow';
import { isAnimated, useStudioStore, ZOOM_LEVELS, type PreviewTab, type ZoomLevel } from '@/state';
import { formatTime, usePlaybackStore } from '@/ui/media/playback';
import { usePlaybackController } from '@/ui/media/usePlaybackController';
import { IconButton, Select, Tabs, Toast } from '@/ui/primitives';
import { useFrameStore, useRenderClient } from '@/ui/renderer/RendererContext';
import { SlotView } from './SlotView';

/** 播放 / 暂停 + 进度条，只在当前坑位是视频或 GIF 时出现 */
function Transport({ slot }: { slot: number }) {
  const media = useStudioStore((s) => s.slots[slot]?.media ?? null);
  const entry = usePlaybackStore((s) => s.slots[slot]);
  const client = useRenderClient();
  const { seek, toggle } = usePlaybackController(slot, isAnimated(media) ? media : null, null);
  if (!media || !isAnimated(media) || !entry || !client) return null;
  const duration = entry.duration || media.duration || 0;
  return (
    <div className="transport" data-testid="transport">
      <IconButton icon={entry.playing ? 'pause' : 'play'} label={entry.playing ? '暂停' : '播放'} className="tda-iconbtn--sm" onClick={toggle} />
      <input
        type="range"
        className="tda-slider__range transport__range"
        min={0}
        max={Math.max(0.01, duration)}
        step={0.01}
        value={Math.min(entry.time, duration)}
        style={{ '--tda-slider-fill': `${duration > 0 ? (entry.time / duration) * 100 : 0}%` } as React.CSSProperties}
        onChange={(e) => seek(Number(e.target.value))}
        aria-label="进度"
      />
      <span className="transport__time">
        {formatTime(entry.time)} / {formatTime(duration)}
      </span>
    </div>
  );
}

/**
 * 多坑位：顶部只留一个播放 / 暂停按钮，统一控制所有视频 / GIF；不显示进度条。
 * 只要有任一坑位在播就显示"暂停"，按下后全部暂停，否则全部播放。
 */
function GroupTransport() {
  const animatedSlots = useStudioStore(useShallow((s) => s.slots.filter((slot) => isAnimated(slot.media)).map((slot) => slot.id)));
  const anyPlaying = usePlaybackStore((s) => animatedSlots.some((id) => s.slots[id]?.playing ?? true));
  if (animatedSlots.length === 0) return null;
  const toggleAll = () => {
    const { update } = usePlaybackStore.getState();
    for (const id of animatedSlots) update(id, { playing: !anyPlaying });
  };
  return (
    <div className="transport transport--group" data-testid="transport-group">
      <IconButton icon={anyPlaying ? 'pause' : 'play'} label={anyPlaying ? '全部暂停' : '全部播放'} className="tda-iconbtn--sm" onClick={toggleAll} />
    </div>
  );
}

const ZOOM_OPTIONS = ZOOM_LEVELS.map((z) => ({ value: String(z), label: z === 'fit' ? '适应窗口' : `${Math.round(z * 100)}%` }));

const PREVIEW_TABS: Array<{ id: PreviewTab; label: string }> = [
  { id: 'result', label: '结果' },
  { id: 'source', label: '原图' },
];

export function PreviewPane() {
  const { slots, zoom, tab, activeSlot, width, height, setZoom, setTab } = useStudioStore(
    useShallow((s) => ({
      slots: s.slots,
      zoom: s.view.zoom,
      tab: s.view.tab,
      activeSlot: s.view.activeSlot,
      width: Number(s.params['canvas.width']),
      height: Number(s.params['canvas.height']),
      setZoom: s.setZoom,
      setTab: s.setTab,
    })),
  );
  const rendered = useFrameStore((s) => s.frames[activeSlot]);
  const media = slots[activeSlot]?.media;
  const multi = slots.length > 1;
  const previewNote = rendered && rendered.scale < 1 ? ` · 预览 ${Math.round(rendered.scale * 100)}%` : '';
  const gpuNote = rendered?.gpu ? ' · GPU' : '';

  return (
    <section className="pane pane--preview" aria-label="预览">
      <div className="preview-head">
        <Tabs items={PREVIEW_TABS} value={tab} onChange={setTab} />
        {multi ? <GroupTransport /> : <Transport slot={activeSlot} />}
        <div className="preview-tools">
          {/* 多坑位下顶部只留播放按钮与缩放，不显示分辨率 / 耗时 */}
          {!multi && (
            <span className="preview-meta" data-testid="preview-meta">
              {media ? `${media.width} × ${media.height} → ${width} × ${height}` : `${width} × ${height}`}
              {rendered ? ` · ${rendered.elapsedMs.toFixed(0)} ms${previewNote}${gpuNote}` : ''}
            </span>
          )}
          <Select
            label="缩放"
            value={String(zoom)}
            options={ZOOM_OPTIONS}
            onChange={(v) => setZoom(v === 'fit' ? 'fit' : (Number(v) as ZoomLevel))}
            labelWidth={36}
            className="preview-zoom"
          />
        </div>
      </div>
      <div className={['preview-body', multi ? 'preview-body--grid' : ''].filter(Boolean).join(' ')}>
        {slots.map((slot) => (
          <SlotView key={slot.id} index={slot.id} />
        ))}
      </div>
      <Toast />
    </section>
  );
}
