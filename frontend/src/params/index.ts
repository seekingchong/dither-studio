import { PARAM_SCHEMA } from './schema';
import type { ParamDef, ParamValue, Params, VisibleWhen } from './types';

export * from './types';
export { PARAM_SCHEMA, DITHER_FAMILIES } from './schema';

const byId = new Map<string, ParamDef>(PARAM_SCHEMA.map((p) => [p.id, p]));

export function getParamDef(id: string): ParamDef {
  const def = byId.get(id);
  if (!def) throw new Error(`未知参数：${id}`);
  return def;
}

export function hasParam(id: string): boolean {
  return byId.has(id);
}

export function defaultParams(): Params {
  const params: Params = {};
  for (const def of PARAM_SCHEMA) params[def.id] = def.default;
  return params;
}

function matchCondition(cond: VisibleWhen, params: Params): boolean {
  const value = params[cond.id];
  if (cond.equals !== undefined && value !== cond.equals) return false;
  if (cond.in && !cond.in.includes(value)) return false;
  return true;
}

export function isParamVisible(def: ParamDef, params: Params): boolean {
  if (!def.visibleWhen) return true;
  const conds = Array.isArray(def.visibleWhen) ? def.visibleWhen : [def.visibleWhen];
  return conds.every((c) => matchCondition(c, params));
}

/** 把任意值收敛到该参数的合法取值：数值夹在 min/max 并按 step 对齐，枚举回退到默认 */
export function coerceParam(def: ParamDef, value: unknown): ParamValue {
  switch (def.type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) return def.default;
      const clamped = Math.min(def.max, Math.max(def.min, n));
      const stepped = Math.round((clamped - def.min) / def.step) * def.step + def.min;
      return Number(stepped.toFixed(6));
    }
    case 'select':
      return typeof value === 'string' && def.options.some((o) => o.value === value) ? value : def.default;
    case 'boolean':
      return typeof value === 'boolean' ? value : def.default;
    case 'color':
      return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : def.default;
  }
}

/** 从任意对象（预设文件、旧版本存档）还原出完整参数，未知键丢弃，缺失键补默认 */
export function sanitizeParams(input: unknown): Params {
  const params = defaultParams();
  if (input && typeof input === 'object') {
    for (const [id, value] of Object.entries(input as Record<string, unknown>)) {
      const def = byId.get(id);
      if (def) params[id] = coerceParam(def, value);
    }
  }
  return params;
}

export function num(params: Params, id: string): number {
  const v = params[id];
  return typeof v === 'number' ? v : Number(getParamDef(id).default);
}

export function str(params: Params, id: string): string {
  const v = params[id];
  return typeof v === 'string' ? v : String(getParamDef(id).default);
}

export function bool(params: Params, id: string): boolean {
  const v = params[id];
  return typeof v === 'boolean' ? v : Boolean(getParamDef(id).default);
}
