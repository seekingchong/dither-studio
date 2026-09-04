import { useShallow } from 'zustand/react/shallow';
import { isAnimated, useStudioStore, type PreviewTab } from '@/state';
import { ExportVideoDialog } from '@/ui/export/ExportVideoDialog';
import { useExport } from '@/ui/export/useExport';
import { trimRange, usePlaybackStore } from '@/ui/media/playback';
import { usePlaybackController } from '@/ui/media/usePlaybackController';
import { Button, IconButton, Tabs, Toast } from '@/ui/primitives';
import { useUiStore } from '@/ui/state/uiStore';
import { useRenderClient } from '@/ui/renderer/RendererContext';
import { CanvasMenu } from './CanvasMenu';
import { SlotView } from './SlotView';

/** 播放 / 暂停 + 进度条，只在当前坑位是视频或 GIF 时出现 */
function Transport({ slot }: { slot: number }) {
  const media = useStudioStore((s) => s.slots[slot]?.media ?? null);
  const entry = usePlaybackStore((s) => s.slots[slot]);
  const client = useRenderClient();
  const { seek, toggle } = usePlaybackController(slot, isAnimated(media) ? media : null, null);
  if (!media || !isAnimated(media) || !entry || !client) return null;
  const duration = entry.duration || media.duration || 0;
  // 视频裁剪过之后，进度条就是那一段：min / max 跟着窗口走，拖不到裁掉的部分
  const { start, end, length } = media.kind === 'video' ? trimRange(duration, entry.trimStart) : { start: 0, end: duration, length: duration };
  const span = Math.max(0.01, length);
  const value = Math.min(end, Math.max(start, entry.time));
  return (
    <div className="transport" data-testid="transport">
      <IconButton icon={entry.playing ? 'pause' : 'play'} label={entry.playing ? '暂停' : '播放'} className="tda-iconbtn--sm" onClick={toggle} />
      <input
        type="range"
        className="tda-slider__range transport__range"
        min={start}
        max={Math.max(start + 0.01, end)}
        step={0.01}
        value={value}
        style={{ '--tda-slider-fill': `${((value - start) / span) * 100}%` } as React.CSSProperties}
        onChange={(e) => seek(Number(e.target.value))}
        aria-label="进度"
      />
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

const PREVIEW_TABS: Array<{ id: PreviewTab; label: string }> = [
  { id: 'result', label: '结果' },
  { id: 'source', label: '原图' },
];

export function PreviewPane() {
  const { slots, tab, activeSlot, setTab } = useStudioStore(
    useShallow((s) => ({
      slots: s.slots,
      tab: s.view.tab,
      activeSlot: s.view.activeSlot,
      setTab: s.setTab,
    })),
  );
  const { canExport, exportPng, exportSvg } = useExport();
  const animated = useStudioStore((s) => isAnimated(s.slots[s.view.activeSlot]?.media));
  const { videoDialog, setVideoDialog } = useUiStore(useShallow((s) => ({ videoDialog: s.exportVideoOpen, setVideoDialog: s.setExportVideoOpen })));
  const multi = slots.length > 1;

  return (
    <section className="pane pane--preview" aria-label="预览">
      <div className="preview-head">
        <Tabs items={PREVIEW_TABS} value={tab} onChange={setTab} />
        {multi ? <GroupTransport /> : <Transport slot={activeSlot} />}
        <div className="preview-tools">
          {/* 缩放、画布尺寸与适配都在这个菜单里；导出按钮紧挨着放在它右侧 */}
          <CanvasMenu />
          {/* 当前帧的矢量版：抖动结果本来就是一格一格的实色块，合并成矩形就是天然的 SVG */}
          <Button variant="secondary" icon="crop" disabled={!canExport} onClick={() => void exportSvg()} title="把当前帧导出为 SVG 矢量图" data-testid="export-svg">
            导出帧
          </Button>
          {/*
           * 主导出入口：跟着当前坑位的媒体类型换文案与去处——
           * 视频 / GIF 走导出视频对话框，图片直接存 PNG。左栏不再另放一个导出按钮。
           */}
          <Button
            variant="primary"
            icon={animated ? 'film' : 'download'}
            disabled={!canExport}
            onClick={() => (animated ? setVideoDialog(true) : void exportPng())}
          >
            {animated ? '导出视频' : '导出图片'}
          </Button>
        </div>
      </div>
      <div className={['preview-body', multi ? 'preview-body--grid' : ''].filter(Boolean).join(' ')}>
        {slots.map((slot) => (
          <SlotView key={slot.id} index={slot.id} />
        ))}
      </div>
      <ExportVideoDialog open={videoDialog} onClose={() => setVideoDialog(false)} />
      <Toast />
    </section>
  );
}
