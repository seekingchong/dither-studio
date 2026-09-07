import { resampleCore } from '../preprocess/resample';
import { applyTone } from '../preprocess/tone';
import type { RGBAFrame, RGBFrame } from '../types';
import type { EffectDef, EffectParamValues } from './types';

const n = (p: EffectParamValues, id: string, fallback: number) => (typeof p[id] === 'number' ? (p[id] as number) : fallback);
const s = (p: EffectParamValues, id: string, fallback: string) => (typeof p[id] === 'string' ? (p[id] as string) : fallback);
const b = (p: EffectParamValues, id: string, fallback: boolean) => (typeof p[id] === 'boolean' ? (p[id] as boolean) : fallback);

/** 原图垫在成品下面时两层怎么合：正片叠底透亮部、滤色透暗部、正常按不透明度直接混合 */
export type OverlayBlend = 'multiply' | 'screen' | 'normal';

/** 缩放 + 偏移之后原图落在画布上的位置（可能超出画布，绘制时裁剪） */
export interface OverlayPlacement {
  /** 缩放后的原图尺寸 */
  width: number;
  height: number;
  /** 左上角在画布上的坐标 */
  x: number;
  y: number;
}

/**
 * 缩放绕画布中心，偏移按画布尺寸的百分比：这样换画布尺寸、预览降分辨率时位置都不变。
 */
export function overlayPlacement(canvasW: number, canvasH: number, scalePercent: number, offsetXPercent: number, offsetYPercent: number): OverlayPlacement {
  const k = Math.max(0.01, scalePercent / 100);
  const width = Math.max(1, Math.round(canvasW * k));
  const height = Math.max(1, Math.round(canvasH * k));
  const x = Math.round((canvasW - width) / 2 + (offsetXPercent / 100) * canvasW);
  const y = Math.round((canvasH - height) / 2 + (offsetYPercent / 100) * canvasH);
  return { width, height, x, y };
}

/**
 * 叠加原图：把适配到画布的原图（视频则是当前帧）垫在成品下面当背景。
 *
 * 成品是不透明的，"垫在下面"靠混合方式表达：正片叠底让亮部（纸）透出原图、墨色不动，
 * 是"网点印在照片上"的效果；滤色反过来，暗底透出原图、亮点不动，给深底浅点的成品用；
 * 正常就是按不透明度直接混合。
 *
 * 原图先按尺寸缩放（绕画布中心）与偏移摆好，只重采样落在画布内的那一块（放大 4 倍也不会开一张巨图），
 * 再在这一块上做亮度 / 对比度 / 饱和度与可选的高斯模糊（和影调分节同一套曲线），
 * 最后按不透明度合进成品；缩放后没盖到的地方成品原样保留。
 */
export const sourceOverlay: EffectDef = {
  id: 'sourceOverlay',
  label: '叠加原图',
  hint: '把原图 / 原视频垫在成品下面当背景，可调明暗、模糊、缩放与位置',
  params: [
    {
      id: 'blend',
      label: '混合模式',
      type: 'select',
      default: 'multiply',
      options: [
        { value: 'multiply', label: '正片叠底' },
        { value: 'screen', label: '滤色' },
        { value: 'normal', label: '正常' },
      ],
    },
    { id: 'opacity', label: '不透明度', type: 'number', min: 0, max: 100, step: 1, default: 100, unit: '%' },
    { id: 'saturation', label: '饱和度', type: 'number', min: -100, max: 100, step: 1, default: 0 },
    { id: 'brightness', label: '亮度', type: 'number', min: -100, max: 100, step: 1, default: 0 },
    { id: 'contrast', label: '对比度', type: 'number', min: -100, max: 100, step: 1, default: 0 },
    { id: 'blur', label: '高斯模糊', type: 'boolean', default: false },
    { id: 'blurRadius', label: '模糊半径', type: 'number', min: 1, max: 100, step: 1, default: 8, unit: 'px', visibleWhen: { id: 'blur', equals: true } },
    { id: 'scale', label: '尺寸缩放', type: 'number', min: 10, max: 400, step: 1, default: 100, unit: '%' },
    { id: 'offsetX', label: '横向偏移', type: 'number', min: -100, max: 100, step: 1, default: 0, unit: '%' },
    { id: 'offsetY', label: '纵向偏移', type: 'number', min: -100, max: 100, step: 1, default: 0, unit: '%' },
  ],
  apply(frame, p, ctx) {
    const source = ctx?.source;
    const opacity = n(p, 'opacity', 100) / 100;
    // 没有原图（单独调用特效）或完全透明：什么都不用画
    if (!source || opacity <= 0) return frame;

    const { width: W, height: H } = frame;
    const place = overlayPlacement(W, H, n(p, 'scale', 100), n(p, 'offsetX', 0), n(p, 'offsetY', 0));
    // 画布内可见的那一块
    const xa = Math.max(0, place.x);
    const ya = Math.max(0, place.y);
    const xb = Math.min(W, place.x + place.width);
    const yb = Math.min(H, place.y + place.height);
    if (xa >= xb || ya >= yb) return frame;
    const vw = xb - xa;
    const vh = yb - ya;

    // 只重采样可见区域：每个画布像素盖住的源像素数 = 源尺寸 / 缩放后尺寸，起点按可见块相对原图左上角的位置偏移
    const scaleX = source.width / place.width;
    const scaleY = source.height / place.height;
    const same = scaleX === 1 && scaleY === 1;
    const method = same ? 'nearest' : scaleX > 1 || scaleY > 1 ? 'box' : 'bilinear';
    const region = resampleCore(source, vw, vh, scaleX, scaleY, (place.x - xa) * scaleX, (place.y - ya) * scaleY, method);

    // 影调：与影调分节同一套亮度 / 对比 / 饱和曲线，模糊半径就是画布像素
    const rgb: RGBFrame = { width: vw, height: vh, data: new Float32Array(vw * vh * 3) };
    for (let i = 0, j = 0; i < region.length; i += 4, j += 3) {
      rgb.data[j] = region[i] / 255;
      rgb.data[j + 1] = region[i + 1] / 255;
      rgb.data[j + 2] = region[i + 2] / 255;
    }
    const toned = applyTone(rgb, {
      brightness: n(p, 'brightness', 0) / 100,
      contrast: n(p, 'contrast', 0) / 100,
      saturation: n(p, 'saturation', 0) / 100,
      blur: b(p, 'blur', false) ? Math.max(0, n(p, 'blurRadius', 8)) : 0,
    }).data;

    const blend = s(p, 'blend', 'multiply') as OverlayBlend;
    const out: RGBAFrame = { width: W, height: H, data: new Uint8ClampedArray(frame.data) };
    const data = out.data;
    for (let y = ya; y < yb; y++) {
      for (let x = xa; x < xb; x++) {
        const q = ((y - ya) * vw + (x - xa)) * 3;
        const o = (y * W + x) * 4;
        for (let c = 0; c < 3; c++) {
          const r = data[o + c];
          const bg = toned[q + c] * 255;
          let mixed: number;
          switch (blend) {
            case 'screen':
              mixed = 255 - ((255 - r) * (255 - bg)) / 255;
              break;
            case 'normal':
              mixed = bg;
              break;
            case 'multiply':
            default:
              mixed = (r * bg) / 255;
          }
          data[o + c] = r + (mixed - r) * opacity;
        }
        data[o + 3] = 255;
      }
    }
    return out;
  },
};
