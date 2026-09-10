import { getEffectDef, parseStack, serializeStack } from '@/engine';
import type { ParamValue, Params } from '@/params';

/**
 * 导出分辨率：始终等比。
 *
 * 放大不是把成品图拉大——那只会糊——而是把画布连同「画布上的尺寸」（像素格、间距、笔画粗细、
 * 特效里那些 px 参数）按同一个比例一起放大，再原样重渲一遍：格子数不变，图案与预览里看到的一致，
 * 只是每个格子占的像素更多，边缘更实。缩小同理。这与预览降分辨率（`scaleParamsForPreview`）是同一套想法，
 * 区别只在导出要的是「正好这个尺寸」，所以画布直接钉到目标值，格子按精确比例四舍五入。
 */

export interface ExportSize {
  width: number;
  height: number;
}

/** 分辨率怎么给：按画布尺寸的倍率，或直接写一个尺寸（写宽写高都行，另一边等比跟着走） */
export type ResolutionMode = 'scale' | 'custom';

/** 倍率档位 */
export const SCALE_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const;

/** 长边上限：再大编码器多半直接拒（H.264 常见上限就是 4096），逐帧渲染也慢得没法用 */
export const MAX_EXPORT_SIDE = 4096;
/** 短边下限：太小编码器同样拒 */
export const MIN_EXPORT_SIDE = 16;

/** 编码器只接受偶数尺寸 */
export function evenSize(n: number): number {
  const r = Math.round(n);
  return Math.max(2, r - (r % 2));
}

/** 画布逻辑尺寸，也就是 1× 的基准 */
export function canvasSizeOf(params: Params): ExportSize {
  return {
    width: Math.max(1, Math.round(Number(params['canvas.width']) || 1000)),
    height: Math.max(1, Math.round(Number(params['canvas.height']) || 600)),
  };
}

/**
 * 倍率能开多大 / 多小：长边顶到 MAX_EXPORT_SIDE、短边落到 MIN_EXPORT_SIDE 为止。
 * 1× 永远在范围里——画布本身就比上限还大时（宽高最大能填到 8192），1× 仍然是原尺寸，
 * 上下限只管「还能往外推多少」，不会把 1× 悄悄缩水。
 */
export function scaleLimits(canvas: ExportSize): { min: number; max: number } {
  return {
    min: Math.min(1, MIN_EXPORT_SIDE / Math.min(canvas.width, canvas.height)),
    max: Math.max(1, MAX_EXPORT_SIDE / Math.max(canvas.width, canvas.height)),
  };
}

export function clampScale(canvas: ExportSize, scale: number): number {
  const { min, max } = scaleLimits(canvas);
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return Math.min(Math.max(scale, min), max);
}

/** 倍率 → 导出尺寸（等比，宽高都取偶数） */
export function sizeForScale(canvas: ExportSize, scale: number): ExportSize {
  const s = clampScale(canvas, scale);
  return { width: evenSize(canvas.width * s), height: evenSize(canvas.height * s) };
}

/** 给宽度 → 导出尺寸；高度按画布比例跟着走 */
export function sizeForWidth(canvas: ExportSize, width: number): ExportSize {
  return sizeForScale(canvas, width / canvas.width);
}

/** 给高度 → 导出尺寸；宽度按画布比例跟着走 */
export function sizeForHeight(canvas: ExportSize, height: number): ExportSize {
  return sizeForScale(canvas, height / canvas.height);
}

/** 这个尺寸相当于几倍画布（宽高两边的平均，偶数取整带来的零头在这里抹平） */
export function scaleOfSize(canvas: ExportSize, size: ExportSize): number {
  return (size.width / canvas.width + size.height / canvas.height) / 2;
}

/** 当前画布放得下的倍率档位（超出上下限的档不给选，免得选了却给不到那个尺寸） */
export function scaleOptionsFor(canvas: ExportSize): Array<{ value: string; label: string }> {
  const { min, max } = scaleLimits(canvas);
  return SCALE_STEPS.filter((s) => s >= min && s <= max).map((s) => ({ value: String(s), label: `${s}×` }));
}

/**
 * 画布上的尺寸类参数：跟着画布一起缩，成品才是「同一张画、像素更多」。
 * `min` 是这个参数缩到底也不能再小的值（与参数表的下限一致）；`round` 为 false 的按浮点缩。
 */
const SCALED_PARAMS: Array<{ id: string; min?: number; round?: boolean }> = [
  { id: 'pixel.size', min: 1 },
  { id: 'pixel.offsetX' },
  { id: 'pixel.offsetY' },
  { id: 'grid.gapX' },
  { id: 'grid.gapY' },
  { id: 'grid.lineWidth', min: 1 },
  { id: 'hatch.spacingX', min: 3 },
  { id: 'hatch.spacingY', min: 3 },
  { id: 'hatch.linkWidth', min: 1 },
  { id: 'screen.pitchX', min: 3 },
  { id: 'screen.pitchY', min: 3 },
  { id: 'screen.offsetX' },
  { id: 'screen.offsetY' },
  { id: 'tile.pitchX', min: 3 },
  { id: 'tile.pitchY', min: 3 },
  { id: 'tile.offsetX' },
  { id: 'tile.offsetY' },
  { id: 'tone.blur', round: false },
];

/** 特效里标了 px 的子参数（线间距、位移、模糊半径…）也是画布上的尺寸，一起缩 */
function scaleEffectStack(value: ParamValue | undefined, scale: number): string | null {
  const stack = parseStack(value);
  if (stack.length === 0) return null;
  const scaled = stack.map((inst) => {
    const def = getEffectDef(inst.type);
    if (!def) return inst;
    const params = { ...inst.params };
    for (const p of def.params) {
      if (p.type !== 'number' || p.unit !== 'px') continue;
      const v = params[p.id];
      if (typeof v !== 'number') continue;
      params[p.id] = Math.max(p.min ?? 0, Math.round(v * scale));
    }
    return { ...inst, params };
  });
  return serializeStack(scaled);
}

/** 按目标尺寸重排参数：画布钉到目标值，格子 / 间距 / 粗细按同一比例跟着走 */
export function scaleParamsForSize(params: Params, size: ExportSize): Params {
  const canvas = canvasSizeOf(params);
  const out: Params = { ...params, 'canvas.width': size.width, 'canvas.height': size.height };
  const scale = scaleOfSize(canvas, size);
  if (!Number.isFinite(scale) || scale <= 0 || Math.abs(scale - 1) < 1e-6) return out;
  for (const { id, min, round } of SCALED_PARAMS) {
    const v = Number(params[id]);
    if (!Number.isFinite(v)) continue;
    out[id] = round === false ? v * scale : Math.max(min ?? 0, Math.round(v * scale));
  }
  const stack = scaleEffectStack(params['effects.stack'], scale);
  if (stack !== null) out['effects.stack'] = stack;
  return out;
}
