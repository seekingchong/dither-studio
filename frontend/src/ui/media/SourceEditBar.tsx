import type { LoadedMedia } from '@/state';
import { IconButton } from '@/ui/primitives';
import { IDENTITY_EDIT, ZOOM_MAX, ZOOM_MIN, editedSize, isIdentityEdit, useSourceEditStore, type SourceEdit } from './sourceEdit';

interface SourceEditBarProps {
  slot: number;
  media: LoadedMedia;
}

const ROTATE_NEXT: Record<number, SourceEdit['rotate']> = { 0: 90, 90: 180, 180: 270, 270: 0 };

/**
 * 「原图」页素材卡片上的简单编辑：旋转 90°、左右 / 上下镜像、裁剪缩放。
 * 缩放始终等比——放大多少就等比裁掉多少，画面比例不会变；放大后直接拖预览挪裁剪窗口。
 * 变换在送进流水线之前就烤进源帧，所以结果预览与导出都跟着变。
 */
export function SourceEditBar({ slot, media }: SourceEditBarProps) {
  const edit = useSourceEditStore((s) => s.slots[slot] ?? IDENTITY_EDIT);
  const update = useSourceEditStore((s) => s.update);
  const reset = useSourceEditStore((s) => s.reset);
  const size = editedSize(media.width, media.height, edit);
  const zoomed = edit.zoom > ZOOM_MIN;

  return (
    <div className="source-edit" data-testid={`source-edit-${slot}`} data-rotate={edit.rotate} data-zoom={edit.zoom.toFixed(2)}>
      <div className="source-edit__group">
        <IconButton
          icon="rotate"
          label="旋转 90°"
          className="tda-iconbtn--sm"
          onClick={() => update(slot, { rotate: ROTATE_NEXT[edit.rotate] })}
          data-testid={`rotate-${slot}`}
        />
        <IconButton
          icon="flipH"
          label="左右镜像"
          className={['tda-iconbtn--sm', edit.flipX ? 'is-on' : ''].filter(Boolean).join(' ')}
          aria-pressed={edit.flipX}
          onClick={() => update(slot, { flipX: !edit.flipX })}
          data-testid={`flip-x-${slot}`}
        />
        <IconButton
          icon="flipV"
          label="上下镜像"
          className={['tda-iconbtn--sm', edit.flipY ? 'is-on' : ''].filter(Boolean).join(' ')}
          aria-pressed={edit.flipY}
          onClick={() => update(slot, { flipY: !edit.flipY })}
          data-testid={`flip-y-${slot}`}
        />
      </div>

      <label className="source-edit__zoom">
        <span className="source-edit__label">缩放</span>
        <input
          type="range"
          className="tda-slider__range"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={0.05}
          value={edit.zoom}
          style={{ '--tda-slider-fill': `${((edit.zoom - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100}%` } as React.CSSProperties}
          onChange={(e) => update(slot, { zoom: Number(e.target.value) })}
          aria-label="画面裁剪缩放"
        />
        <span className="source-edit__value">{Math.round(edit.zoom * 100)}%</span>
      </label>

      <span className="source-edit__size" data-testid={`source-edit-size-${slot}`}>
        {size.width} × {size.height}
        {zoomed ? ' · 拖预览挪位置' : ''}
      </span>

      <IconButton
        icon="undo"
        label="重置编辑"
        className="tda-iconbtn--sm"
        disabled={isIdentityEdit(edit)}
        onClick={() => reset(slot)}
        data-testid={`source-edit-reset-${slot}`}
      />
    </div>
  );
}
