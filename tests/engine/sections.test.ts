import { describe, expect, it } from 'vitest';
import { PARAM_SCHEMA, defaultParams, getParamDef, getParamHelp, type Params, type StyleKind } from '@/params';
import { CELL_PAIRS, SECTIONS, cellPairOf, cellSummary, leadParamIds } from '@/ui/panel/sections';

const basic = SECTIONS.find((s) => s.id === 'basic')!;

describe('排线 / 网点的像素尺寸：横纵间距合成一个控件', () => {
  it('每对都指向 schema 里两个范围一致的数值参数，且都是「基础」的领头参数', () => {
    for (const [style, pair] of Object.entries(CELL_PAIRS) as [StyleKind, NonNullable<(typeof CELL_PAIRS)[StyleKind]>][]) {
      const x = getParamDef(pair.x);
      const y = getParamDef(pair.y);
      expect(x.type).toBe('number');
      expect(y.type).toBe('number');
      if (x.type !== 'number' || y.type !== 'number') continue;
      expect([x.min, x.max, x.step, x.unit]).toEqual([y.min, y.max, y.step, y.unit]);
      expect(x.group).toBe(y.group);
      const leads = leadParamIds({ ...defaultParams(), 'style.type': style });
      expect(leads.indexOf(pair.y)).toBe(leads.indexOf(pair.x) + 1);
      // 合成控件与它的开关不是 schema 参数，但要有自己的解读文案
      expect(PARAM_SCHEMA.some((d) => d.id === pair.id)).toBe(false);
      expect(getParamHelp(pair.id)?.summary).toBeTruthy();
      expect(getParamHelp(`${pair.id}.split`)?.summary).toBeTruthy();
    }
    expect(cellPairOf('dither')).toBeUndefined();
    expect(cellPairOf('hatch')?.id).toBe('hatch.cell');
    expect(cellPairOf('halftone')?.id).toBe('screen.cell');
  });

  it('摘要里横纵相等写一个数，不等写成 7×16', () => {
    const pair = cellPairOf('hatch')!;
    const p: Params = { ...defaultParams(), 'style.type': 'hatch' };
    expect(cellSummary(p, pair)).toBe('像素 14');
    expect(basic.summary(p)).toBe('排线 · 45° · 像素 14');
    p['hatch.spacingX'] = 7;
    p['hatch.spacingY'] = 16;
    expect(cellSummary(p, pair)).toBe('像素 7×16');
    expect(basic.summary(p)).toBe('排线 · 45° · 像素 7×16');
  });
});
