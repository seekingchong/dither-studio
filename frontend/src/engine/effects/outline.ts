import { hexToRgb } from '../color/srgb';
import type { RGBAFrame } from '../types';
import { styleLevelCount } from './tone';
import type { EffectContext, EffectDef, EffectParamValues, ToneBins, ToneMap } from './types';

export const LEVEL_OUTLINE_ID = 'levelOutline';
export const LEVEL_OUTLINE_MIN_LEVELS = 2;
export const LEVEL_OUTLINE_MAX_LEVELS = 16;
const MAX_WIDTH = 32;

const n = (p: EffectParamValues, id: string, fallback: number) => (typeof p[id] === 'number' ? (p[id] as number) : fallback);
const s = (p: EffectParamValues, id: string, fallback: string) => (typeof p[id] === 'string' ? (p[id] as string) : fallback);
const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

/** 第 i 阶（0 最亮）的描边是否开着：开关串里缺位视为开 */
export function levelEnabled(mask: string, i: number): boolean {
  return mask.charAt(i) !== '0';
}

/** 亮度 0..1 → 第几阶（0 最亮），按风格自己的分阶规则 */
export function toneLevel(gray: number, levels: number, bins: ToneBins): number {
  const g = gray < 0 ? 0 : gray > 1 ? 1 : gray;
  if (bins === 'floor') {
    const k = Math.floor((1 - g) * levels);
    return k >= levels ? levels - 1 : k;
  }
  return levels - 1 - Math.round(g * (levels - 1));
}

/** 没有流水线上下文（直接调特效、或将来别的宿主）时，把成品自己的亮度当作明暗分布：一像素一格 */
export function toneFromFrame(frame: RGBAFrame): ToneMap {
  const { width, height, data } = frame;
  const gray = new Float32Array(width * height);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (0.2126 * data[j] + 0.7152 * data[j + 1] + 0.0722 * data[j + 2]) / 255;
  return { width, height, gray, cellW: 1, cellH: 1, originX: 0, originY: 0, bins: 'round' };
}

/**
 * 描边蒙版：相邻两格不同阶、且至少一方的描边开着，两格之间那条格子边就画一段线，宽 w 像素，线心在格子边上。
 * 边线落在像素缝上，偶数粗细两边各分一半；奇数粗细多出的那一像素放在左 / 上侧。
 * 圆角：每段线只画到格子边的两端，端点处按线粗盖一个圆——直线段上圆被线盖住看不出，转角处外角就被削圆；
 * 方角：每段线两端各多伸半个线粗，转角拼成方的。
 */
export function outlineMask(tone: ToneMap, width: number, height: number, levels: number, mask: string, strokeWidth: number, round: boolean): Uint8Array {
  const { width: cw, height: ch, gray, cellW, cellH, originX, originY, bins } = tone;
  const w = clampInt(strokeWidth, 1, MAX_WIDTH);
  const lead = Math.ceil(w / 2);
  const trail = Math.floor(w / 2);
  const radius = (w - 1) / 2;
  const off = w & 1 ? -0.5 : 0;
  const r2 = radius * radius + 1e-6;

  const level = new Uint8Array(cw * ch);
  for (let i = 0; i < level.length; i++) level[i] = toneLevel(gray[i], levels, bins);
  const on = new Uint8Array(levels);
  for (let i = 0; i < levels; i++) on[i] = levelEnabled(mask, i) ? 1 : 0;

  const out = new Uint8Array(width * height);
  /** 填 [x0, x1) × [y0, y1)，越界部分裁掉 */
  const rect = (x0: number, x1: number, y0: number, y1: number) => {
    const xa = Math.max(0, x0);
    const xb = Math.min(width, x1);
    const ya = Math.max(0, y0);
    const yb = Math.min(height, y1);
    for (let y = ya; y < yb; y++) out.fill(1, y * width + xa, y * width + xb);
  };
  /** 以格点 (X, Y) 为心、线粗为直径的圆（像素中心落在圆内才算） */
  const disc = (X: number, Y: number) => {
    const cx = X + off;
    const cy = Y + off;
    for (let y = Math.max(0, Y - lead); y < Math.min(height, Y + trail); y++) {
      const dy = y + 0.5 - cy;
      for (let x = Math.max(0, X - lead); x < Math.min(width, X + trail); x++) {
        const dx = x + 0.5 - cx;
        if (dx * dx + dy * dy <= r2) out[y * width + x] = 1;
      }
    }
  };
  const drawn = (a: number, b: number) => a !== b && (on[a] === 1 || on[b] === 1);

  for (let j = 0; j < ch; j++) {
    const row = j * cw;
    const y0 = originY + j * cellH;
    const y1 = y0 + cellH;
    for (let i = 0; i < cw; i++) {
      const a = level[row + i];
      const x0 = originX + i * cellW;
      const x1 = x0 + cellW;
      if (i + 1 < cw && drawn(a, level[row + i + 1])) {
        // 与右邻的竖边，落在 x = x1
        if (round) {
          rect(x1 - lead, x1 + trail, y0, y1);
          disc(x1, y0);
          disc(x1, y1);
        } else {
          rect(x1 - lead, x1 + trail, y0 - lead, y1 + trail);
        }
      }
      if (j + 1 < ch && drawn(a, level[row + cw + i])) {
        // 与下邻的横边，落在 y = y1
        if (round) {
          rect(x0, x1, y1 - lead, y1 + trail);
          disc(x0, y1);
          disc(x1, y1);
        } else {
          rect(x0 - lead, x1 + trail, y1 - lead, y1 + trail);
        }
      }
    }
  }
  return out;
}

export const levelOutline: EffectDef = {
  id: LEVEL_OUTLINE_ID,
  label: '灰度块描边',
  hint: '按明暗分阶，同一阶的色块沿格子边缘描线，每阶可单独开关',
  params: [
    { id: 'levels', label: '灰阶数', type: 'number', min: LEVEL_OUTLINE_MIN_LEVELS, max: LEVEL_OUTLINE_MAX_LEVELS, step: 1, default: 8, unit: '阶' },
    { id: 'width', label: '粗细', type: 'number', min: 1, max: MAX_WIDTH, step: 1, default: 2, unit: 'px' },
    { id: 'color', label: '颜色', type: 'color', default: '#000000' },
    {
      id: 'join',
      label: '转角',
      type: 'select',
      default: 'round',
      options: [
        { value: 'round', label: '圆角' },
        { value: 'square', label: '方角' },
      ],
    },
    {
      id: 'fill',
      label: '画面',
      type: 'select',
      default: 'keep',
      options: [
        { value: 'keep', label: '保留' },
        { value: 'flat', label: '只留描边' },
      ],
    },
    { id: 'paper', label: '底色', type: 'color', default: '#FFFFFF', visibleWhen: { id: 'fill', equals: 'flat' } },
    { id: 'mask', label: '各阶描边', type: 'levels', countFrom: 'levels', default: '' },
  ],
  /** 添加时阶数跟着当前风格的灰阶数走：风格分几阶，描边就分几阶，线正好落在风格的分界上 */
  init: (params) => ({ levels: styleLevelCount(params) }),
  apply(frame: RGBAFrame, p: EffectParamValues, ctx?: EffectContext): RGBAFrame {
    const levels = clampInt(n(p, 'levels', 8), LEVEL_OUTLINE_MIN_LEVELS, LEVEL_OUTLINE_MAX_LEVELS);
    const strokeWidth = clampInt(n(p, 'width', 2), 1, MAX_WIDTH);
    const [r, g, b] = hexToRgb(s(p, 'color', '#000000'));
    const round = s(p, 'join', 'round') !== 'square';
    const flat = s(p, 'fill', 'keep') === 'flat';
    const mask = s(p, 'mask', '');
    const { width, height } = frame;
    const tone = ctx?.tone ?? toneFromFrame(frame);
    const stroke = outlineMask(tone, width, height, levels, mask, strokeWidth, round);

    const data = new Uint8ClampedArray(width * height * 4);
    if (flat) {
      const [pr, pg, pb] = hexToRgb(s(p, 'paper', '#FFFFFF'));
      for (let o = 0; o < data.length; o += 4) {
        data[o] = pr;
        data[o + 1] = pg;
        data[o + 2] = pb;
        data[o + 3] = 255;
      }
    } else {
      data.set(frame.data);
    }
    for (let i = 0, o = 0; i < stroke.length; i++, o += 4) {
      if (stroke[i] === 0) continue;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
    return { width, height, data };
  },
};
