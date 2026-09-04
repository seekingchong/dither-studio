import { describe, expect, it } from 'vitest';
import { EFFECT_DEFS } from '@/engine';
import { getEffectHelp, INLINE_OPTIONS_MAX, PARAM_HELP, PARAM_SCHEMA, paramsMissingHelp, staleHelpOptions } from '@/params';
import { helpForOption, helpForParam } from '@/ui/state/helpStore';

describe('参数解读', () => {
  it('每个参数都能解释自己', () => {
    expect(paramsMissingHelp()).toEqual([]);
  });

  it('每个特效都能解释自己', () => {
    expect(EFFECT_DEFS.filter((d) => !getEffectHelp(d.id)).map((d) => d.id)).toEqual([]);
  });

  it('选项解读与 schema 一一对应，没有多余也没有遗漏', () => {
    expect(staleHelpOptions()).toEqual([]);
  });

  it('文案不写成裹脚布：一句话 ≤ 60 字，单个值 ≤ 40 字', () => {
    const tooLong: string[] = [];
    for (const [id, help] of Object.entries(PARAM_HELP)) {
      if ([...help.summary].length > 60) tooLong.push(`${id}.summary`);
      if (help.tip && [...help.tip].length > 60) tooLong.push(`${id}.tip`);
      for (const [value, desc] of Object.entries(help.options ?? {})) {
        if ([...desc].length > 40) tooLong.push(`${id}.${value}`);
      }
    }
    expect(tooLong).toEqual([]);
  });

  it('选项少的枚举把值列在属性浮层里，选项多的交给下拉逐行解读', () => {
    const few = PARAM_SCHEMA.find((d) => d.type === 'select' && d.options.length <= INLINE_OPTIONS_MAX && PARAM_HELP[d.id]?.options);
    const many = PARAM_SCHEMA.find((d) => d.type === 'select' && d.options.length > INLINE_OPTIONS_MAX && PARAM_HELP[d.id]?.options);
    expect(few && helpForParam(few)?.values?.length).toBeGreaterThan(0);
    expect(many && helpForParam(many)?.values).toBeUndefined();
    expect(many && helpForParam(many)?.more).toBe(true);
  });

  it('下拉的每一行都有自己的解读', () => {
    const missing: string[] = [];
    for (const def of PARAM_SCHEMA) {
      if (def.type !== 'select' || !PARAM_HELP[def.id]?.options) continue;
      for (const o of def.options) if (!helpForOption(def.id, o.value, o.label)) missing.push(`${def.id}.${o.value}`);
    }
    expect(missing).toEqual([]);
  });

  it('没写解读的参数退回 schema 自带的 hint，两者都没有就不弹', () => {
    const withHint = { id: 'x.y', group: 'pixel', label: '甲', type: 'boolean', default: false, hint: '备用说明' } as const;
    const bare = { id: 'x.z', group: 'pixel', label: '乙', type: 'boolean', default: false } as const;
    expect(helpForParam(withHint)?.summary).toBe('备用说明');
    expect(helpForParam(bare)).toBeNull();
  });
});
