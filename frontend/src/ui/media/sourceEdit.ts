import { create } from 'zustand';

/**
 * 素材本身的简单编辑：旋转、镜像、裁剪缩放。
 * 跟播放状态一样按坑位存、不进撤销栈也不进预设——它属于"这段素材"，不属于"这套抖动方案"。
 * 变换在送进 Worker 之前就烤进源帧，所以结果预览、PNG 与视频导出都自动带上。
 */
export interface SourceEdit {
  /** 顺时针旋转的角度 */
  rotate: 0 | 90 | 180 | 270;
  /** 左右镜像（在旋转之后的画面上翻） */
  flipX: boolean;
  /** 上下镜像 */
  flipY: boolean;
  /** 放大倍数；比例始终不变，放大多少就等比裁掉多少 */
  zoom: number;
  /** 裁剪窗口在可移动余量里的位置，-1 = 贴左 / 上，1 = 贴右 / 下 */
  offsetX: number;
  offsetY: number;
}

export const IDENTITY_EDIT: SourceEdit = { rotate: 0, flipX: false, flipY: false, zoom: 1, offsetX: 0, offsetY: 0 };

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;

const clamp = (v: number, min: number, max: number) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min);

interface SourceEditStore {
  slots: Record<number, SourceEdit>;
  update(slot: number, patch: Partial<SourceEdit>): void;
  reset(slot: number): void;
}

export const useSourceEditStore = create<SourceEditStore>((set) => ({
  slots: {},
  update: (slot, patch) => set((s) => ({ slots: { ...s.slots, [slot]: { ...(s.slots[slot] ?? IDENTITY_EDIT), ...patch } } })),
  reset: (slot) =>
    set((s) => {
      if (!(slot in s.slots)) return s;
      const slots = { ...s.slots };
      delete slots[slot];
      return { slots };
    }),
}));

export const editOf = (slot: number): SourceEdit => useSourceEditStore.getState().slots[slot] ?? IDENTITY_EDIT;

export function isIdentityEdit(edit: SourceEdit): boolean {
  return edit.rotate === 0 && !edit.flipX && !edit.flipY && edit.zoom <= ZOOM_MIN && edit.offsetX === 0 && edit.offsetY === 0;
}

/** 判断"要不要重新推一帧"用的键 */
export function editKey(edit: SourceEdit): string {
  return `${edit.rotate}${edit.flipX ? 'x' : ''}${edit.flipY ? 'y' : ''}z${edit.zoom.toFixed(3)}p${edit.offsetX.toFixed(3)},${edit.offsetY.toFixed(3)}`;
}

export interface EditGeometry {
  /** 旋转之后、裁剪之前的画面尺寸 */
  rotatedWidth: number;
  rotatedHeight: number;
  /** 裁剪矩形，坐标在旋转后的画面里 */
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
}

/** 旋转 90 / 270 度时长宽互换；裁剪矩形按倍数等比缩小，位置由 offset 在余量里插值 */
export function editGeometry(sourceWidth: number, sourceHeight: number, edit: SourceEdit): EditGeometry {
  const swap = edit.rotate === 90 || edit.rotate === 270;
  const rotatedWidth = Math.max(1, swap ? sourceHeight : sourceWidth);
  const rotatedHeight = Math.max(1, swap ? sourceWidth : sourceHeight);
  const zoom = clamp(edit.zoom, ZOOM_MIN, ZOOM_MAX);
  const cropWidth = rotatedWidth / zoom;
  const cropHeight = rotatedHeight / zoom;
  const cropX = ((rotatedWidth - cropWidth) * (clamp(edit.offsetX, -1, 1) + 1)) / 2;
  const cropY = ((rotatedHeight - cropHeight) * (clamp(edit.offsetY, -1, 1) + 1)) / 2;
  return { rotatedWidth, rotatedHeight, cropX, cropY, cropWidth, cropHeight };
}

/** 变换后交给流水线的画面尺寸；比例与旋转后的画面一致，所以裁剪缩放不会拉伸 */
export function editedSize(sourceWidth: number, sourceHeight: number, edit: SourceEdit): { width: number; height: number } {
  const g = editGeometry(sourceWidth, sourceHeight, edit);
  return { width: Math.max(1, Math.round(g.cropWidth)), height: Math.max(1, Math.round(g.cropHeight)) };
}

function intrinsicSize(source: CanvasImageSource): { width: number; height: number } {
  if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) return { width: source.videoWidth, height: source.videoHeight };
  const s = source as { width: number; height: number };
  return { width: s.width, height: s.height };
}

/**
 * 把变换后的画面画进 ctx 的目标矩形。
 * 变换顺序是"先转再翻"：镜像作用在旋转之后的画面上，跟看到的方向一致
 * （画布变换是后写的先作用于图形，所以代码里 scale 写在 rotate 前面）。
 */
export function drawEditedInto(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  source: CanvasImageSource,
  edit: SourceEdit,
  dest: { x: number; y: number; width: number; height: number },
): void {
  const { width: sw, height: sh } = intrinsicSize(source);
  if (sw <= 0 || sh <= 0 || dest.width <= 0 || dest.height <= 0) return;
  const g = editGeometry(sw, sh, edit);
  ctx.save();
  ctx.beginPath();
  ctx.rect(dest.x, dest.y, dest.width, dest.height);
  ctx.clip();
  ctx.translate(dest.x, dest.y);
  ctx.scale(dest.width / g.cropWidth, dest.height / g.cropHeight);
  ctx.translate(-g.cropX, -g.cropY);
  ctx.translate(g.rotatedWidth / 2, g.rotatedHeight / 2);
  ctx.scale(edit.flipX ? -1 : 1, edit.flipY ? -1 : 1);
  ctx.rotate((edit.rotate * Math.PI) / 180);
  ctx.drawImage(source, -sw / 2, -sh / 2, sw, sh);
  ctx.restore();
}

/** 变换后的源帧位图；没做过任何编辑时直接原样取帧，不多绕一次画布 */
export async function editedBitmap(source: CanvasImageSource, edit: SourceEdit): Promise<ImageBitmap> {
  if (isIdentityEdit(edit)) return createImageBitmap(source as ImageBitmapSource);
  const { width: sw, height: sh } = intrinsicSize(source);
  const size = editedSize(sw, sh, edit);
  const canvas = new OffscreenCanvas(size.width, size.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return createImageBitmap(source as ImageBitmapSource);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  drawEditedInto(ctx, source, edit, { x: 0, y: 0, width: size.width, height: size.height });
  return createImageBitmap(canvas);
}
