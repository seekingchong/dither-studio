import { beforeEach, describe, expect, it } from 'vitest';
import { PARAM_SCHEMA, defaultParams, sanitizeParams } from '@/params';
import { BUILTIN_PRESETS, HISTORY_COALESCE_MS, HISTORY_LIMIT, sanitizeSettings, sanitizeUserPresets, useStudioStore } from '@/state';

function reset() {
  useStudioStore.setState({
    params: defaultParams(),
    history: { past: [], future: [], lastEditId: null, lastEditAt: 0 },
    view: { zoom: 'fit', tab: 'result', activeSlot: 0, autoPixelSize: true },
    presets: [],
  });
}

describe('撤销 / 重做', () => {
  beforeEach(reset);

  it('setParam 记录历史，undo / redo 往返', () => {
    const s = useStudioStore.getState();
    s.setParam('tone.brightness', 20);
    expect(useStudioStore.getState().history.past.length).toBe(1);
    useStudioStore.getState().undo();
    expect(useStudioStore.getState().params['tone.brightness']).toBe(0);
    expect(useStudioStore.getState().history.future.length).toBe(1);
    useStudioStore.getState().redo();
    expect(useStudioStore.getState().params['tone.brightness']).toBe(20);
    expect(useStudioStore.getState().history.future.length).toBe(0);
    useStudioStore.getState().redo();
    expect(useStudioStore.getState().params['tone.brightness']).toBe(20);
  });

  it('同一参数连续变化合并成一条记录，换参数就新开一条', () => {
    const s = useStudioStore.getState();
    for (let v = 1; v <= 10; v++) s.setParam('tone.brightness', v);
    expect(useStudioStore.getState().history.past.length).toBe(1);
    s.setParam('tone.contrast', 5);
    expect(useStudioStore.getState().history.past.length).toBe(2);
    useStudioStore.getState().undo();
    expect(useStudioStore.getState().params['tone.contrast']).toBe(0);
    expect(useStudioStore.getState().params['tone.brightness']).toBe(10);
    useStudioStore.getState().undo();
    expect(useStudioStore.getState().params['tone.brightness']).toBe(0);
  });

  it('超过合并时间后同一参数也新开记录', () => {
    const s = useStudioStore.getState();
    s.setParam('tone.brightness', 1);
    useStudioStore.setState((st) => ({ history: { ...st.history, lastEditAt: st.history.lastEditAt - HISTORY_COALESCE_MS - 1 } }));
    s.setParam('tone.brightness', 2);
    expect(useStudioStore.getState().history.past.length).toBe(2);
  });

  it('新编辑清空 redo 栈，历史长度有上限', () => {
    const s = useStudioStore.getState();
    s.setParam('tone.brightness', 5);
    useStudioStore.getState().undo();
    expect(useStudioStore.getState().history.future.length).toBe(1);
    s.setParam('tone.contrast', 5);
    expect(useStudioStore.getState().history.future.length).toBe(0);
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) {
      s.setParam(i % 2 === 0 ? 'tone.brightness' : 'tone.contrast', i);
      useStudioStore.setState((st) => ({ history: { ...st.history, lastEditAt: 0 } }));
    }
    expect(useStudioStore.getState().history.past.length).toBeLessThanOrEqual(HISTORY_LIMIT);
  });

  it('replaceParams / resetParams 进历史，自动像素尺寸不进', () => {
    const s = useStudioStore.getState();
    s.applySuggestedPixelSize(3);
    expect(useStudioStore.getState().params['pixel.size']).toBe(3);
    expect(useStudioStore.getState().history.past.length).toBe(0);
    s.replaceParams({ 'pixel.size': 6, 'dither.family': 'ordered' });
    expect(useStudioStore.getState().history.past.length).toBe(1);
    expect(useStudioStore.getState().view.autoPixelSize).toBe(false);
    s.resetParams();
    expect(useStudioStore.getState().history.past.length).toBe(2);
    expect(useStudioStore.getState().view.autoPixelSize).toBe(true);
    useStudioStore.getState().undo();
    expect(useStudioStore.getState().params['dither.family']).toBe('ordered');
  });
});

describe('预设与设置', () => {
  it('内置预设的参数 id 都存在且取值合法', () => {
    const ids = new Set(PARAM_SCHEMA.map((p) => p.id));
    expect(BUILTIN_PRESETS.length).toBeGreaterThanOrEqual(7);
    for (const preset of BUILTIN_PRESETS) {
      for (const [id, value] of Object.entries(preset.params)) {
        expect(ids.has(id), `${preset.id} 使用了未知参数 ${id}`).toBe(true);
        const cleaned = sanitizeParams({ [id]: value });
        expect(cleaned[id], `${preset.id}.${id} 取值不合法`).toBe(value);
      }
    }
    expect(new Set(BUILTIN_PRESETS.map((p) => p.id)).size).toBe(BUILTIN_PRESETS.length);
  });

  it('用户预设与设置的存储校验', () => {
    const list = sanitizeUserPresets([{ id: 'a', name: 'x'.repeat(100), params: { 'pixel.size': 3 }, createdAt: 5 }, { bad: true }, null, { id: 1 }]);
    expect(list.length).toBe(1);
    expect(list[0].name.length).toBe(60);
    expect(sanitizeUserPresets('nope')).toEqual([]);
    expect(sanitizeSettings({ slotCount: 4, gpu: false, theme: 'dark' })).toEqual({ slotCount: 4, gpu: false, theme: 'dark' });
    expect(sanitizeSettings({ slotCount: 3, theme: 'purple' })).toEqual({ slotCount: 1, gpu: true, theme: 'light' });
    expect(sanitizeSettings(null).theme).toBe('light');
  });

  it('切换坑位数时活动坑位回到范围内', () => {
    reset();
    const s = useStudioStore.getState();
    s.setSettings({ slotCount: 4 });
    s.setActiveSlot(3);
    s.setSettings({ slotCount: 1 });
    expect(useStudioStore.getState().view.activeSlot).toBe(0);
    expect(useStudioStore.getState().slots.length).toBe(1);
  });
});
