import { useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { computeFit, displayGeometry, resampleForDisplay, type FitMode, type RenderedFrame, type RGBAFrame } from '@/engine';
import type { LoadedMedia, PreviewTab } from '@/state';
import { usePlaybackStore } from '@/ui/media/playback';
import { IDENTITY_EDIT, drawEditedInto, editGeometry, editedSize, useSourceEditStore, type SourceEdit } from '@/ui/media/sourceEdit';
import { useDevicePixelRatio } from './useDevicePixelRatio';

interface SlotCanvasProps {
  slot: number;
  media: LoadedMedia;
  rendered: RenderedFrame | undefined;
  tab: PreviewTab;
  width: number;
  height: number;
  fit: FitMode;
  scale: number;
}

/**
 * 预览画布的圆角比例：宽 100px 时 7.2px、宽 500px 时 36px，即宽度的 7.2%。
 * 只是 DOM 元素的 border-radius，不动像素，所以导出的 PNG / 视频不带圆角。
 */
export const PREVIEW_RADIUS_RATIO = 0.072;

/** 一次绘制要用到的全部输入 */
interface PaintInput {
  tab: PreviewTab;
  media: LoadedMedia;
  rendered: RenderedFrame | undefined;
  width: number;
  height: number;
  fit: FitMode;
  frameIndex: number;
  edit: SourceEdit;
}

/** 「原图」页此刻该画的源：视频取 <video>，GIF 取当前帧，图片取位图 */
function sourceOf(media: LoadedMedia, frameIndex: number): CanvasImageSource {
  if (media.kind === 'video' && media.video) return media.video;
  if (media.kind === 'gif' && media.frames) return media.frames[frameIndex % media.frames.length];
  return media.bitmap;
}

const toImageData = (frame: RGBAFrame) => new ImageData(frame.data as Uint8ClampedArray<ArrayBuffer>, frame.width, frame.height);

/**
 * 把当前视图按画布全尺寸画进 canvas：结果视图贴 Worker 返回的帧（播放中的降分辨率帧按最近邻放大），
 * 原图视图按适配矩形绘制当前源帧。canvas 的后备存储不是画布尺寸时先改过来。
 */
function paintFull(canvas: HTMLCanvasElement, input: PaintInput, scratch: { current: HTMLCanvasElement | null }): void {
  const { tab, media, rendered, width, height, fit, frameIndex, edit } = input;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (tab === 'source') {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    // 「原图」页看的是编辑之后的素材：按变换后的尺寸算适配矩形，再把旋转 / 镜像 / 裁剪画进去
    const size = editedSize(media.width, media.height, edit);
    const rect = computeFit(size.width, size.height, width, height, fit);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    drawEditedInto(ctx, sourceOf(media, frameIndex), edit, rect);
    return;
  }
  if (!rendered) {
    ctx.clearRect(0, 0, width, height);
    return;
  }
  const { frame } = rendered;
  if (frame.width === width && frame.height === height) {
    ctx.putImageData(toImageData(frame), 0, 0);
    return;
  }
  // 降分辨率预览：先贴到暂存画布再最近邻放大
  if (!scratch.current) scratch.current = document.createElement('canvas');
  const tmp = scratch.current;
  if (tmp.width !== frame.width || tmp.height !== frame.height) {
    tmp.width = frame.width;
    tmp.height = frame.height;
  }
  tmp.getContext('2d')!.putImageData(toImageData(frame), 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(tmp, 0, 0, frame.width, frame.height, 0, 0, width, height);
}

/** 缩到屏幕物理像素的帧缓存：同一帧、同一目标尺寸只算一次 */
interface AreaCache {
  frame: RGBAFrame;
  width: number;
  height: number;
  image: ImageData;
}

/**
 * 预览画布。
 *
 * 屏幕物理像素不少于画布像素时（100%、或高分屏上的 50%），后备存储就是画布尺寸，
 * 放大交给 CSS 的 `image-rendering: pixelated`，每个像素都是实的。
 *
 * 屏幕物理像素少于画布像素时（10%、25%、适应窗口……），后备存储只开屏幕物理像素那么大，
 * 帧照浏览器 / GPU 显示大图的方式（mipmap 逐级平均 + 双线性）缩进去。这跟浏览器、Figma 把一张导出图显示成这么大时做的是同一件事，
 * 所以预览里看到的「糊」就是导出图真的会有的糊；以前让 CSS 用最近邻抽样，10% 时每 10 个像素只挑 1 个，
 * 抖动颗粒被挑得整整齐齐、又脆又干净，是一张根本不存在的图。
 */
export function SlotCanvas({ slot, media, rendered, tab, width, height, fit, scale }: SlotCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const scratch = useRef<HTMLCanvasElement | null>(null);
  const areaCache = useRef<AreaCache | null>(null);
  const frameIndex = usePlaybackStore((s) => s.slots[slot]?.frameIndex ?? 0);
  const edit = useSourceEditStore((s) => s.slots[slot] ?? IDENTITY_EDIT);
  const dpr = useDevicePixelRatio();

  const geometry = displayGeometry(width, height, scale, dpr);
  const { shownWidth, shownHeight, backingWidth, backingHeight, mode } = geometry;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (mode === 'nearest') {
      paintFull(canvas, { tab, media, rendered, width, height, fit, frameIndex, edit }, scratch);
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (tab === 'source') {
      // 源帧是照片，浏览器自己的平滑缩放就是它在网页里显示时的样子
      ctx.setTransform(backingWidth / width, 0, 0, backingHeight / height, 0, 0);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      const size = editedSize(media.width, media.height, edit);
      const rect = computeFit(size.width, size.height, width, height, fit);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      drawEditedInto(ctx, sourceOf(media, frameIndex), edit, rect);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!rendered) {
      ctx.clearRect(0, 0, backingWidth, backingHeight);
      return;
    }
    // 抖动结果照浏览器 / GPU 显示大图的路子缩到屏幕物理像素（mipmap 逐级 2×2 平均 + 双线性），一个像素都不抽掉
    const { frame } = rendered;
    const cached = areaCache.current;
    let image: ImageData;
    if (cached && cached.frame === frame && cached.width === backingWidth && cached.height === backingHeight) {
      image = cached.image;
    } else {
      image = toImageData(resampleForDisplay(frame, backingWidth, backingHeight));
      areaCache.current = { frame, width: backingWidth, height: backingHeight, image };
    }
    ctx.putImageData(image, 0, 0);
  }, [tab, rendered, media, width, height, fit, frameIndex, edit, mode, backingWidth, backingHeight]);

  // 圆角按屏幕上的实际宽度算，缩放档位变了也保持同一个比例
  const style: CSSProperties = {
    width: shownWidth,
    height: shownHeight,
    borderRadius: `${(shownWidth * PREVIEW_RADIUS_RATIO).toFixed(2)}px`,
  };

  /**
   * 放大之后直接拖画面挪裁剪窗口，两个页签都能拖——编辑条在「结果」页也在，
   * 拖的是同一个裁剪窗口，成品跟着重渲染。
   * 屏幕上挪 1px 相当于挪 裁剪宽 / 目标矩形宽 个源像素，再换算成余量里的比例；
   * 「结果」页的成品是同一份变换后的源帧按同一个 fit 铺进画布的，所以这套换算两边通用。
   */
  const pannable = edit.zoom > 1;
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!pannable || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const g = editGeometry(media.width, media.height, edit);
    const size = editedSize(media.width, media.height, edit);
    const rect = computeFit(size.width, size.height, width, height, fit);
    const slackX = g.rotatedWidth - g.cropWidth;
    const slackY = g.rotatedHeight - g.cropHeight;
    // 目标矩形是画布坐标，屏幕上还要再乘一次预览缩放
    const perPixelX = slackX > 0 ? (2 * g.cropWidth) / (rect.width * scale * slackX) : 0;
    const perPixelY = slackY > 0 ? (2 * g.cropHeight) / (rect.height * scale * slackY) : 0;
    const from = { x: e.clientX, y: e.clientY, offsetX: edit.offsetX, offsetY: edit.offsetY };
    const move = (ev: PointerEvent) => {
      useSourceEditStore.getState().update(slot, {
        offsetX: Math.min(1, Math.max(-1, from.offsetX - (ev.clientX - from.x) * perPixelX)),
        offsetY: Math.min(1, Math.max(-1, from.offsetY - (ev.clientY - from.y) * perPixelY)),
      });
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  return (
    <canvas
      ref={ref}
      className="slot__canvas"
      width={backingWidth}
      height={backingHeight}
      style={style}
      data-tab={tab}
      data-scale={rendered?.scale ?? 1}
      data-resample={mode}
      data-pannable={pannable ? 'true' : 'false'}
      onPointerDown={onPointerDown}
    />
  );
}
