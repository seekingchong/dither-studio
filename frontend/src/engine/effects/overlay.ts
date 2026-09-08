import { resampleCore } from '../preprocess/resample';
import { applyTone } from '../preprocess/tone';
import type { RGBAFrame, RGBFrame } from '../types';
import type { EffectDef, EffectParamValues, RGBTriple } from './types';

const n = (p: EffectParamValues, id: string, fallback: number) => (typeof p[id] === 'number' ? (p[id] as number) : fallback);
const s = (p: EffectParamValues, id: string, fallback: string) => (typeof p[id] === 'string' ? (p[id] as string) : fallback);
const b = (p: EffectParamValues, id: string, fallback: boolean) => (typeof p[id] === 'boolean' ? (p[id] as boolean) : fallback);

/** 原图与它下面那一层怎么合：正片叠底透亮部、滤色透暗部、正常按不透明度直接混合 */
export type OverlayBlend = 'multiply' | 'screen' | 'normal';

/** 原图放在哪一层：背景与前景之间（底色上铺原图，墨点 / 笔画留在最上面），或整个成品之上 */
export type OverlayLayer = 'between' | 'top';

/** 偏离底色 → 墨色这条线多远（单通道 0–255）就完全算前景 */
export const PAPER_TOLERANCE = 64;

/**
 * 成品里一个像素有多少是"底色"：把它投影到底色 → 墨色这条线上，投影位置 t 就是墨的覆盖率（抗锯齿边缘、多级灰阶都落在这条线上），
 * 偏离这条线的部分（别的颜色：调色板、原图色网点、强调色）视为前景。返回 0..1，1 是纯底色。
 */
export function paperWeight(r: number, g: number, bl: number, paper: RGBTriple, ink: RGBTriple): number {
  const vr = ink[0] - paper[0];
  const vg = ink[1] - paper[1];
  const vb = ink[2] - paper[2];
  const dr = r - paper[0];
  const dg = g - paper[1];
  const db = bl - paper[2];
  const len2 = vr * vr + vg * vg + vb * vb;
  const t = len2 > 0 ? Math.min(1, Math.max(0, (dr * vr + dg * vg + db * vb) / len2)) : 0;
  const resid = Math.max(Math.abs(dr - t * vr), Math.abs(dg - t * vg), Math.abs(db - t * vb));
  return (1 - t) * Math.min(1, Math.max(0, 1 - resid / PAPER_TOLERANCE));
}

function blendChannel(blend: OverlayBlend, under: number, over: number): number {
  switch (blend) {
    case 'screen':
      return 255 - ((255 - under) * (255 - over)) / 255;
    case 'normal':
      return over;
    case 'multiply':
    default:
      return (under * over) / 255;
  }
}

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
 * 叠加原图：把适配到画布的原图（视频则是当前帧）夹在成品的背景与前景之间。
 *
 * 成品是不透明的一张图，分不出层；靠流水线交来的底色（纸）与墨色把它拆开：每个像素投影到底色 → 墨色这条线上，
 * 投影位置就是墨的覆盖率——纯底色的地方铺上原图，墨点 / 笔画 / 网点 / 符号原样留在最上面，抗锯齿边缘与多级灰阶按覆盖率过渡，
 * 别的颜色（调色板、原图色网点、强调色）一律当前景不动。原图与底色之间按混合模式合（正片叠底 / 滤色 / 正常）并按不透明度过渡，
 * 所以 100% 正常就是"照片上印着网点"，调低不透明度底色就透出来。
 *
 * 「层级」切到「最上层」是老的整幅混合：不管前景背景，原图按混合模式盖在整张成品上。直接调用、没有底色信息时也走这一路。
 *
 * 原图先按尺寸缩放（绕画布中心）与偏移摆好，只重采样落在画布内的那一块（放大 4 倍也不会开一张巨图），
 * 再在这一块上做亮度 / 对比度 / 饱和度与可选的高斯模糊（和影调分节同一套曲线）；缩放后没盖到的地方成品原样保留。
 */
export const sourceOverlay: EffectDef = {
  id: 'sourceOverlay',
  label: '叠加原图',
  hint: '把原图 / 原视频夹在底色与前景之间，可调明暗、模糊、缩放与位置',
  params: [
    {
      id: 'layer',
      label: '层级',
      type: 'select',
      default: 'between',
      options: [
        { value: 'between', label: '背景与前景之间' },
        { value: 'top', label: '最上层' },
      ],
      hint: '背景与前景之间：底色上铺原图，墨点 / 笔画 / 网点 / 符号留在最上面。最上层：原图按混合模式盖在整张成品上。',
    },
    {
      id: 'blend',
      label: '混合模式',
      type: 'select',
      default: 'normal',
      options: [
        { value: 'normal', label: '正常' },
        { value: 'multiply', label: '正片叠底' },
        { value: 'screen', label: '滤色' },
      ],
      hint: '原图与它下面那一层怎么合：正常直接盖上去，正片叠底只往下压暗（白底上就是原图本身），滤色只往上提亮（黑底上就是原图本身）。',
    },
    { id: 'opacity', label: '不透明度', type: 'number', min: 0, max: 100, step: 1, default: 100, unit: '%', hint: '原图露出多少；低于 100% 时它下面那一层透出来。' },
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

    const blend = s(p, 'blend', 'normal') as OverlayBlend;
    const between = s(p, 'layer', 'between') === 'between' && !!ctx?.paper;
    const paper = ctx?.paper ?? [255, 255, 255];
    const ink = ctx?.ink ?? [0, 0, 0];
    const out: RGBAFrame = { width: W, height: H, data: new Uint8ClampedArray(frame.data) };
    const data = out.data;
    for (let y = ya; y < yb; y++) {
      for (let x = xa; x < xb; x++) {
        const q = ((y - ya) * vw + (x - xa)) * 3;
        const o = (y * W + x) * 4;
        if (between) {
          // 底色上铺原图（按混合模式与不透明度），再按这个像素里底色占的份额换进去：前景那部分原样不动
          const w = paperWeight(data[o], data[o + 1], data[o + 2], paper, ink);
          if (w > 0) {
            for (let c = 0; c < 3; c++) {
              const under = paper[c];
              const laid = under + (blendChannel(blend, under, toned[q + c] * 255) - under) * opacity;
              data[o + c] += (laid - under) * w;
            }
          }
        } else {
          for (let c = 0; c < 3; c++) {
            const r = data[o + c];
            data[o + c] = r + (blendChannel(blend, r, toned[q + c] * 255) - r) * opacity;
          }
        }
        data[o + 3] = 255;
      }
    }
    return out;
  },
};
