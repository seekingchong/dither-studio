import type { Params } from '@/params';
import { computeFit, type FitMode } from './preprocess/fit';
import { resample } from './preprocess/resample';
import type { RGBAFrame } from './types';

/**
 * 预览降分辨率：优先把画布与格子尺寸（像素尺寸 / 排线间距）同比缩小，格子数不变，
 * 图案与全分辨率一致，只是每个格子画得更小。格子已经缩不动时（1 或 2），改为按倍率减少格子数——
 * 图案会比最终结果粗，但只发生在播放过程中，暂停与导出仍是全分辨率。
 */
export function scaleParamsForPreview(params: Params, scale: number): { params: Params; scale: number } {
  if (scale >= 1) return { params, scale: 1 };
  // 排线 / 网点风格的"格子"是横纵间距，按短的那边缩
  const hatch = params['style.type'] === 'hatch';
  const halftone = params['style.type'] === 'halftone';
  const spacingX = Number(params['hatch.spacingX']) || 1;
  const spacingY = Number(params['hatch.spacingY']) || 1;
  const pitchX = Number(params['screen.pitchX']) || 1;
  const pitchY = Number(params['screen.pitchY']) || 1;
  const size = hatch ? Math.min(spacingX, spacingY) : halftone ? Math.min(pitchX, pitchY) : Number(params['pixel.size']) || 1;
  const newSize = Math.max(1, Math.round(size * scale));
  // 格子一点都没缩小 → 这一档只能靠减少格子数拿到
  const effective = newSize === size ? scale : newSize / size;
  if (effective >= 1) return { params, scale: 1 };
  const width = Math.max(16, Math.round((Number(params['canvas.width']) || 1000) * effective));
  const height = Math.max(16, Math.round((Number(params['canvas.height']) || 600) * effective));
  const px = (id: string) => Math.round((Number(params[id]) || 0) * effective);
  const scaled: Params = {
    ...params,
    'canvas.width': width,
    'canvas.height': height,
    'pixel.offsetX': px('pixel.offsetX'),
    'pixel.offsetY': px('pixel.offsetY'),
    'grid.gapX': px('grid.gapX'),
    'grid.gapY': px('grid.gapY'),
    'grid.lineWidth': Math.max(1, px('grid.lineWidth')),
    'tone.blur': (Number(params['tone.blur']) || 0) * effective,
  };
  if (hatch) {
    scaled['hatch.spacingX'] = Math.max(1, Math.round(spacingX * effective));
    scaled['hatch.spacingY'] = Math.max(1, Math.round(spacingY * effective));
    scaled['hatch.linkWidth'] = Math.max(1, px('hatch.linkWidth'));
  } else if (halftone) {
    scaled['screen.pitchX'] = Math.max(2, Math.round(pitchX * effective));
    scaled['screen.pitchY'] = Math.max(2, Math.round(pitchY * effective));
    scaled['screen.offsetX'] = px('screen.offsetX');
    scaled['screen.offsetY'] = px('screen.offsetY');
  } else {
    scaled['pixel.size'] = newSize;
  }
  return { scale: effective, params: scaled };
}

/** 预览画布在屏幕上怎么摆：CSS 尺寸、canvas 后备存储尺寸，以及帧怎么落到后备存储上 */
export interface DisplayGeometry {
  /** 画布元素的 CSS 尺寸 */
  shownWidth: number;
  shownHeight: number;
  /** canvas 后备存储（`canvas.width / height`）的尺寸 */
  backingWidth: number;
  backingHeight: number;
  /**
   * `area`：屏幕物理像素比画布像素少，后备存储就开成物理像素，帧照浏览器 / GPU 显示大图的方式
   * （mipmap 逐级 2×2 平均 + 双线性，见 `resampleForDisplay`）缩进去，看到的就是导出图缩到这么大的样子；
   * `nearest`：后备存储就是画布尺寸，屏幕像素只多不少，放大交给 CSS 最近邻，每个像素都还是实的。
   */
  mode: 'area' | 'nearest';
}

/**
 * 按画布尺寸、缩放档位与 devicePixelRatio 算预览画布的显示几何。
 *
 * 关键是「缩小时绝不抽样」：以前后备存储永远是画布全尺寸、缩小全靠 CSS，
 * 而 `image-rendering: pixelated` 让浏览器用最近邻做降采样——10% 时每 10 个像素只挑 1 个，
 * 抖动颗粒被挑得整整齐齐、看起来又脆又干净，跟把导出图放进设计软件缩到 10% 时那种「糊到一起」完全两回事。
 * 现在屏幕像素少于画布像素就照它们的方式缩到物理像素，预览与真实观感一致。
 */
export function displayGeometry(width: number, height: number, scale: number, dpr: number): DisplayGeometry {
  const shownWidth = Math.max(1, Math.round(width * scale));
  const shownHeight = Math.max(1, Math.round(height * scale));
  const ratio = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  const physicalWidth = Math.max(1, Math.round(shownWidth * ratio));
  const physicalHeight = Math.max(1, Math.round(shownHeight * ratio));
  if (physicalWidth >= width && physicalHeight >= height) {
    return { shownWidth, shownHeight, backingWidth: width, backingHeight: height, mode: 'nearest' };
  }
  return { shownWidth, shownHeight, backingWidth: physicalWidth, backingHeight: physicalHeight, mode: 'area' };
}

/**
 * 把一帧缩到屏幕物理像素，照着浏览器 / GPU 显示一张大图的路子走：
 * 先按 2×2 平均逐级缩到「不小于目标」的那一级 mipmap，再用不展宽的双线性（GPU 那种，只看最近两个纹素）采样到目标尺寸。
 * Chrome 显示 `<img>`、Figma 贴纹理都是这么做的，所以缩出来的灰度与残留的纹理跟它们一致
 * （对着 Chrome `<img>` 实测：10%/DPR 1 逐像素平均差 3.4/255；精确的面积平均反而更平滑，差 11）。
 * 目标比帧还大（播放中的降分辨率帧）时按最近邻铺开，保持像素感。
 */
export function resampleForDisplay(frame: RGBAFrame, width: number, height: number): RGBAFrame {
  let level = frame;
  while (level.width >= width * 2 && level.height >= height * 2) {
    level = resample(level, Math.floor(level.width / 2), Math.floor(level.height / 2), 'box');
  }
  if (level.width === width && level.height === height) return level;
  const upscale = level.width <= width && level.height <= height;
  return resample(level, width, height, upscale ? 'nearest' : 'linear');
}

/** 预览倍率档位，从清晰到粗糙 */
export const PREVIEW_SCALES = [1, 0.75, 0.5, 0.35, 0.25];

/** 播放时的单帧时间预算：30 fps */
export const PREVIEW_BUDGET_MS = 1000 / 30;

/** 连续多少帧有余量才升一档，避免在两档之间来回跳 */
const UPSCALE_STREAK = 4;

export interface PreviewPacer {
  scale: number;
  /** 连续「有余量」的帧数 */
  streak: number;
}

export const INITIAL_PACER: PreviewPacer = { scale: 1, streak: 0 };

/**
 * 按上一帧的端到端耗时挑下一帧的预览倍率。
 * 超预算立刻降一档；只有连续几帧都明显有余量才升一档（迟滞），
 * 这样倍率不会每帧翻转，画面清晰度和帧间隔都稳定。
 */
export function pacePreview(pacer: PreviewPacer, elapsedMs: number, budgetMs = PREVIEW_BUDGET_MS): PreviewPacer {
  const index = Math.max(0, PREVIEW_SCALES.indexOf(pacer.scale));
  if (elapsedMs > budgetMs * 2.5) {
    // 严重超预算：一次降两档，别慢慢试探
    const next = Math.min(PREVIEW_SCALES.length - 1, index + 2);
    return { scale: PREVIEW_SCALES[next], streak: 0 };
  }
  if (elapsedMs > budgetMs) {
    const next = Math.min(PREVIEW_SCALES.length - 1, index + 1);
    return { scale: PREVIEW_SCALES[next], streak: 0 };
  }
  // 升档要求耗时明显低于预算，留出升档后变慢的余量
  if (index > 0 && elapsedMs < budgetMs * 0.5) {
    const streak = pacer.streak + 1;
    if (streak >= UPSCALE_STREAK) return { scale: PREVIEW_SCALES[index - 1], streak: 0 };
    return { scale: pacer.scale, streak };
  }
  return { scale: pacer.scale, streak: 0 };
}

/**
 * 抓帧时应该直接缩到的尺寸：流水线的第一步就是把源帧重采样进画布，
 * 而浏览器的原生缩放比引擎里的 JS 重采样快一个数量级。抓帧就缩到位，
 * `fitFrame` 里的重采样会因尺寸相同直接跳过。需要放大时返回 null，交给流水线。
 */
export function captureSizeFor(srcW: number, srcH: number, params: Params): { width: number; height: number } | null {
  const mode = String(params['canvas.fit'] || 'contain') as FitMode;
  if (mode === 'native') return null;
  const dstW = Math.round(Number(params['canvas.width']) || 0);
  const dstH = Math.round(Number(params['canvas.height']) || 0);
  if (!(dstW > 0 && dstH > 0) || !(srcW > 0 && srcH > 0)) return null;
  const rect = computeFit(srcW, srcH, dstW, dstH, mode);
  if (rect.width >= srcW || rect.height >= srcH) return null;
  return { width: rect.width, height: rect.height };
}
