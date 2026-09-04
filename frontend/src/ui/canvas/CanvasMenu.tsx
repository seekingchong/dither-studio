import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getParamDef } from '@/params';
import { useStudioStore, ZOOM_LEVELS, type ZoomLevel } from '@/state';
import { ParamControl } from '@/ui/panel/ParamControl';
import { Icon, NumberField, Select } from '@/ui/primitives';

const ZOOM_OPTIONS = ZOOM_LEVELS.map((z) => ({ value: String(z), label: z === 'fit' ? '适应窗口' : `${Math.round(z * 100)}%` }));
const zoomLabel = (zoom: ZoomLevel) => ZOOM_OPTIONS.find((o) => o.value === String(zoom))?.label ?? String(zoom);

const WIDTH_DEF = getParamDef('canvas.width');
const HEIGHT_DEF = getParamDef('canvas.height');
const FIT_DEF = getParamDef('canvas.fit');
const range = (def: typeof WIDTH_DEF) => (def.type === 'number' ? { min: def.min, max: def.max } : {});

/**
 * 预览区右上角的「画布」菜单：缩放档位、画布尺寸（就是导出尺寸）与源图适配方式都在这里，
 * 左栏不再有「画布」分区。触发按钮上直接显示当前尺寸与缩放。
 */
export function CanvasMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { zoom, width, height, setZoom, setParams } = useStudioStore(
    useShallow((s) => ({
      zoom: s.view.zoom,
      width: Number(s.params['canvas.width']),
      height: Number(s.params['canvas.height']),
      setZoom: s.setZoom,
      setParams: s.setParams,
    })),
  );

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const setSize = (w: number, h: number) => setParams({ 'canvas.width': w, 'canvas.height': h });

  return (
    <div className="canvas-menu-wrap" ref={ref}>
      <button
        type="button"
        className={['tda-select', 'canvas-trigger', open ? 'is-open' : ''].filter(Boolean).join(' ')}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="canvas-menu-button"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="tda-select__label">画布</span>
        <span className="tda-select__value">
          {width} × {height} · {zoomLabel(zoom)}
        </span>
        <Icon name="chevron" size={12} className="tda-select__chevron" />
      </button>
      {open && (
        <div className="canvas-menu" role="dialog" aria-label="画布" data-testid="canvas-menu">
          <Select
            label="缩放"
            value={String(zoom)}
            options={ZOOM_OPTIONS}
            onChange={(v) => setZoom(v === 'fit' ? 'fit' : (Number(v) as ZoomLevel))}
            className="preview-zoom"
            data-param="view.zoom"
          />
          <div className="canvas-menu__group">
            <span className="canvas-menu__label">画布尺寸（导出尺寸）</span>
            <div className="canvas-size">
              <NumberField label="宽" value={width} {...range(WIDTH_DEF)} unit="px" onChange={(w) => setSize(w, height)} data-param="canvas.width" />
              <span className="canvas-size__x" aria-hidden="true">
                ×
              </span>
              <NumberField label="高" value={height} {...range(HEIGHT_DEF)} unit="px" onChange={(h) => setSize(width, h)} data-param="canvas.height" />
            </div>
          </div>
          <ParamControl def={FIT_DEF} />
          <p className="canvas-menu__hint">适配方式决定源图如何放进画布：Contain 留白、Cover 裁切、Fill 拉伸、原尺寸不缩放。</p>
        </div>
      )}
    </div>
  );
}
