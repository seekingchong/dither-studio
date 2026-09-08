import type { ParamValue } from '@/params';
import { parseColorList } from '../color/palettes';
import type { RGBAFrame } from '../types';
import { blocksSvgFragment, layoutBlocks, letterStyleOf, parseTextList, serializeTextList } from './blocks';
import { EFFECT_DEFS, getEffectDef } from './defs';
import { DEFAULT_GRID_UNIT, type EffectContext, type EffectDef, type EffectInstance, type EffectParamDef, type EffectParamValues, type GridUnit } from './types';

/** 按定义把实例参数收敛到合法值 */
export function coerceEffectParams(def: EffectDef, input: unknown): EffectParamValues {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: EffectParamValues = {};
  for (const p of def.params) {
    const v = src[p.id];
    switch (p.type) {
      case 'number': {
        const num = typeof v === 'number' ? v : Number(v);
        if (!Number.isFinite(num)) {
          out[p.id] = p.default;
          break;
        }
        const min = p.min ?? -Infinity;
        const max = p.max ?? Infinity;
        const step = p.step ?? 1;
        const clamped = Math.min(max, Math.max(min, num));
        out[p.id] = Number.isFinite(min) ? Number((Math.round((clamped - min) / step) * step + min).toFixed(6)) : clamped;
        break;
      }
      case 'select':
        out[p.id] = typeof v === 'string' && p.options?.some((o) => o.value === v) ? v : p.default;
        break;
      case 'boolean':
        out[p.id] = typeof v === 'boolean' ? v : p.default;
        break;
      case 'text':
        out[p.id] = typeof v === 'string' ? v.slice(0, p.maxLength ?? 200) : p.default;
        break;
      case 'color':
        out[p.id] = typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : p.default;
        break;
      case 'colors':
        out[p.id] = typeof v === 'string' ? parseColorList(v).slice(0, 64).join(' ') : p.default;
        break;
      case 'texts':
        // 逐块文字列表：JSON 数组，每块只留画得出来的字；不是列表就退回空串（按批量字母展开）
        out[p.id] = typeof v === 'string' ? serializeTextList(parseTextList(v), p.maxLength) : p.default;
        break;
      case 'levels':
        // 只留 0 / 1，长度不按阶数裁：阶数改多了新阶默认开，改少了多出的位忽略
        out[p.id] = typeof v === 'string' ? v.replace(/[^01]/g, '').slice(0, 32) : p.default;
        break;
    }
  }
  return out;
}

/** 这个子参数在当前实例参数下要不要露出：定义了 visibleWhen 的，每个条件（等于某值 / 属于某集合）都满足才显示 */
export function isEffectParamVisible(def: EffectParamDef, params: EffectParamValues): boolean {
  if (!def.visibleWhen) return true;
  const conds = Array.isArray(def.visibleWhen) ? def.visibleWhen : [def.visibleWhen];
  return conds.every((c) => (c.equals === undefined || params[c.id] === c.equals) && (!c.in || c.in.includes(params[c.id])));
}

/** 新实例：全部默认值；给了当前参数表时，定义了 init 的特效按它给初始值（如描边的阶数跟随风格的灰阶数） */
export function defaultEffectInstance(type: string, params?: Record<string, ParamValue>): EffectInstance | null {
  const def = getEffectDef(type);
  if (!def) return null;
  return { type, enabled: true, params: coerceEffectParams(def, params && def.init ? def.init(params) : {}) };
}

/** 解析特效栈 JSON，未知类型丢弃，参数按定义收敛 */
export function parseStack(json: string | ParamValue | undefined): EffectInstance[] {
  if (typeof json !== 'string' || !json.trim()) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: EffectInstance[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const def = typeof rec.type === 'string' ? getEffectDef(rec.type) : undefined;
    if (!def) continue;
    out.push({ type: def.id, enabled: rec.enabled !== false, params: coerceEffectParams(def, rec.params) });
    if (out.length >= 16) break;
  }
  return out;
}

export function serializeStack(stack: EffectInstance[]): string {
  return stack.length === 0 ? '' : JSON.stringify(stack);
}

/** 依次应用启用的特效；ctx 是流水线交来的上下文（原图、明暗分布、格子等），需要的特效自己取用，直接调用时可省 */
export function applyEffects(frame: RGBAFrame, stack: EffectInstance[], ctx: EffectContext = {}): RGBAFrame {
  let current = frame;
  for (const inst of stack) {
    if (!inst.enabled) continue;
    const def = getEffectDef(inst.type);
    if (!def) continue;
    current = def.apply(current, inst.params, ctx);
  }
  return current;
}

/**
 * 特效栈里能出矢量的那部分（目前只有叠加随机方块）的 SVG 片段，按栈顺序拼在一起。
 * 排线 / 网点 / 符号的矢量导出从几何直接出图形、不经过位图，靠它把方块补到成品上；
 * 其余特效是位图运算，矢量里没有。
 */
export function effectsSvgFragment(stack: EffectInstance[], width: number, height: number, grid: GridUnit = DEFAULT_GRID_UNIT): string {
  const parts: string[] = [];
  for (const inst of stack) {
    if (!inst.enabled || inst.type !== 'blocks') continue;
    const fragment = blocksSvgFragment(layoutBlocks(width, height, inst.params, grid), letterStyleOf(inst.params));
    if (fragment) parts.push(fragment);
  }
  return parts.length ? `<g data-effect="blocks">${parts.join('')}</g>` : '';
}

/** 把特效片段塞进一份 SVG 的末尾（`</svg>` 之前）；片段为空则原样返回 */
export function appendSvgFragment(svg: string, fragment: string): string {
  if (!fragment) return svg;
  const end = svg.lastIndexOf('</svg>');
  return end < 0 ? svg + fragment : svg.slice(0, end) + fragment + svg.slice(end);
}

export { EFFECT_DEFS, getEffectDef };
