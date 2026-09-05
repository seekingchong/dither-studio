import { describe, expect, it } from 'vitest';
import { PARAM_SCHEMA, coerceParam, defaultParams, getParamDef, isParamVisible, sanitizeParams } from '@/params';
import { useStudioStore } from '@/state/store';

describe('参数 schema', () => {
  it('id 唯一且属于合法分组', () => {
    const ids = new Set<string>();
    for (const def of PARAM_SCHEMA) {
      expect(ids.has(def.id)).toBe(false);
      ids.add(def.id);
      expect(def.id.startsWith(`${def.group}.`)).toBe(true);
    }
  });

  it('默认值都在合法范围内', () => {
    for (const def of PARAM_SCHEMA) {
      expect(coerceParam(def, def.default)).toBe(def.default);
    }
  });

  it('coerceParam 夹紧数值并回退非法枚举', () => {
    expect(coerceParam(getParamDef('pixel.size'), 999)).toBe(16);
    expect(coerceParam(getParamDef('pixel.size'), -3)).toBe(1);
    expect(coerceParam(getParamDef('pixel.size'), 'abc')).toBe(4);
    expect(coerceParam(getParamDef('dither.family'), 'nope')).toBe('ordered');
    expect(coerceParam(getParamDef('color.tint.dark'), '#abcdef')).toBe('#ABCDEF');
    expect(coerceParam(getParamDef('color.tint.dark'), 'red')).toBe('#000000');
  });

  it('sanitizeParams 丢弃未知键并补齐缺失键', () => {
    const params = sanitizeParams({ 'pixel.size': 8, bogus: 1 });
    expect(params['pixel.size']).toBe(8);
    expect('bogus' in params).toBe(false);
    expect(Object.keys(params).length).toBe(PARAM_SCHEMA.length);
  });

  it('默认：Dither 风格、有序 Bayer 2×2、单色、像素尺寸 4', () => {
    const params = defaultParams();
    expect(params['style.kind']).toBe('dither');
    expect(params['dither.family']).toBe('ordered');
    expect(params['dither.ordered.matrix']).toBe('bayer2');
    expect(params['color.mode']).toBe('mono');
    expect(params['pixel.size']).toBe(4);
    const size = getParamDef('pixel.size');
    expect(size.type === 'number' && [size.min, size.max]).toEqual([1, 16]);
  });

  it('visibleWhen 按算法族切换；两端颜色在单色 / 灰阶 / Tint 下都可见', () => {
    const params = defaultParams();
    expect(isParamVisible(getParamDef('dither.ordered.matrix'), params)).toBe(true);
    expect(isParamVisible(getParamDef('dither.ed.kernel'), params)).toBe(false);
    params['dither.family'] = 'error-diffusion';
    expect(isParamVisible(getParamDef('dither.ed.kernel'), params)).toBe(true);
    for (const mode of ['mono', 'gray', 'tint']) {
      params['color.mode'] = mode;
      expect(isParamVisible(getParamDef('color.tint.dark'), params), mode).toBe(true);
    }
    params['color.mode'] = 'palette';
    expect(isParamVisible(getParamDef('color.tint.dark'), params)).toBe(false);
    // Halftone：分级级数随开关出现，网点颜色只在双色模式下出现
    expect(isParamVisible(getParamDef('halftone.levels'), params)).toBe(false);
    params['halftone.stepped'] = true;
    expect(isParamVisible(getParamDef('halftone.levels'), params)).toBe(true);
    expect(isParamVisible(getParamDef('ink.dot'), params)).toBe(true);
    params['ink.mode'] = 'cmyk';
    expect(isParamVisible(getParamDef('ink.dot'), params)).toBe(false);
  });
});

describe('store', () => {
  it('setParam 走 coerce，且相同值不产生新对象', () => {
    const store = useStudioStore.getState();
    store.resetParams();
    const before = useStudioStore.getState().params;
    store.setParam('pixel.size', 4);
    expect(useStudioStore.getState().params).toBe(before);
    store.setParam('pixel.size', 100);
    expect(useStudioStore.getState().params['pixel.size']).toBe(16);
  });

  it('切换坑位数量时保留已有坑位', () => {
    const store = useStudioStore.getState();
    store.setSettings({ slotCount: 4 });
    expect(useStudioStore.getState().slots.length).toBe(4);
    store.setSettings({ slotCount: 1 });
    expect(useStudioStore.getState().slots.length).toBe(1);
  });
});
