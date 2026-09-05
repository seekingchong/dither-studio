import { create } from 'zustand';
import { getEffectHelp, getOptionHelp, getParamHelp, INLINE_OPTIONS_MAX, type ParamDef } from '@/params';

export interface HelpValue {
  label: string;
  desc: string;
}

/** 解读浮层的内容。key 用来去重：同一个目标重复触发不会重置浮层 */
export interface HelpContent {
  key: string;
  title: string;
  summary: string;
  values?: HelpValue[];
  tip?: string;
  /** 选项太多，属性浮层里不逐条列，提示去下拉里看 */
  more?: boolean;
  variant: 'param' | 'option';
}

interface HelpState {
  anchor: HTMLElement | null;
  content: HelpContent | null;
  /** 下拉展开时不弹属性解读，只让选项解读出现 */
  suppressed: boolean;
  show(anchor: HTMLElement, content: HelpContent): void;
  hide(key?: string): void;
  setSuppressed(suppressed: boolean): void;
}

/** 全局只有一个解读浮层，谁触发谁占用 */
export const useHelpStore = create<HelpState>((set, get) => ({
  anchor: null,
  content: null,
  suppressed: false,
  show: (anchor, content) => {
    if (get().suppressed && content.variant === 'param') return;
    set({ anchor, content });
  },
  hide: (key) => {
    if (key && get().content?.key !== key) return;
    set({ anchor: null, content: null });
  },
  setSuppressed: (suppressed) => {
    const { content } = get();
    // 下拉一展开就收掉属性解读；一收起就把选项解读也收掉
    const clear = suppressed ? content?.variant === 'param' : content?.variant === 'option';
    set(clear ? { suppressed, anchor: null, content: null } : { suppressed });
  },
}));

/** 参数标签的解读内容；没有文案时退回 schema 自带的 hint，两者都没有就不弹 */
export function helpForParam(def: ParamDef, label?: string): HelpContent | null {
  const help = getParamHelp(def.id);
  const title = label ?? def.label;
  if (!help) return def.hint ? { key: def.id, title, summary: def.hint, variant: 'param' } : null;

  const inline = def.type === 'select' && def.options.length <= INLINE_OPTIONS_MAX;
  const values =
    def.type === 'select' && inline && help.options
      ? def.options.map((o) => ({ label: o.label, desc: help.options?.[o.value] ?? '' })).filter((v) => v.desc)
      : undefined;

  return {
    key: def.id,
    title,
    summary: help.summary,
    values: values?.length ? values : undefined,
    tip: help.tip,
    more: def.type === 'select' && !inline && !!help.options,
    variant: 'param',
  };
}

/** 面板上合成的控件（不是 schema 参数，如排线 / 网点的「像素尺寸」）的解读：按 id 查文案，没有就不弹 */
export function helpForId(id: string, title: string): HelpContent | null {
  const help = getParamHelp(id);
  return help ? { key: id, title, summary: help.summary, tip: help.tip, variant: 'param' } : null;
}

/** 下拉某一行的解读 */
export function helpForOption(paramId: string, value: string, label: string): HelpContent | null {
  const desc = getOptionHelp(paramId, value);
  return desc ? { key: `${paramId}:${value}`, title: label, summary: desc, variant: 'option' } : null;
}

/** 特效卡片标题的解读 */
export function helpForEffect(effectId: string, label: string): HelpContent | null {
  const help = getEffectHelp(effectId);
  return help ? { key: `effect:${effectId}`, title: label, summary: help.summary, tip: help.tip, variant: 'param' } : null;
}
