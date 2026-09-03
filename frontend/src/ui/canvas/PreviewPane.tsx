import { useShallow } from 'zustand/react/shallow';
import { useStudioStore, ZOOM_LEVELS, type PreviewTab, type ZoomLevel } from '@/state';
import { Select, Tabs, Toast } from '@/ui/primitives';
import { useFrameStore } from '@/ui/renderer/RendererContext';
import { SlotView } from './SlotView';

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

  return (
    <section className="pane pane--preview" aria-label="预览">
      <div className="preview-head">
        <Tabs items={PREVIEW_TABS} value={tab} onChange={setTab} />
        <div className="preview-tools">
          <span className="preview-meta" data-testid="preview-meta">
            {media ? `${media.width} × ${media.height} → ${width} × ${height}` : `${width} × ${height}`}
            {rendered ? ` · ${rendered.elapsedMs.toFixed(0)} ms` : ''}
          </span>
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
      <div className={['preview-body', slots.length > 1 ? 'preview-body--grid' : ''].filter(Boolean).join(' ')}>
        {slots.map((slot) => (
          <SlotView key={slot.id} index={slot.id} />
        ))}
      </div>
      <Toast />
    </section>
  );
}
