import { beforeEach, describe, expect, it } from 'vitest';
import { PARAM_SCHEMA, defaultParams, getParamDef, sanitizeParams } from '@/params';
import {
  BUILTIN_PRESETS,
  DEFAULT_PRESET_ID,
  HALFTONE_DEFAULT_PRESET_ID,
  HISTORY_COALESCE_MS,
  HISTORY_LIMIT,
  builtinPresetParams,
  builtinPresetsOf,
  defaultPresetIdFor,
  findBuiltinPreset,
  isParamExposed,
  paramsDiffer,
  presetStyle,
  presetStyleById,
  resolveBase,
  sanitizeSettings,
  sanitizeUserPresets,
  summarizeParams,
  useStudioStore,
} from '@/state';

function reset() {
  useStudioStore.setState({
    params: defaultParams(),
    presetId: DEFAULT_PRESET_ID,
    history: { past: [], future: [], lastEditId: null, lastEditAt: 0 },
    view: { zoom: 'fit', tab: 'result', activeSlot: 0 },
    presets: [],
    lastPresetByStyle: {},
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

  it('replaceParams / resetParams 进历史', () => {
    const s = useStudioStore.getState();
    expect(useStudioStore.getState().params['pixel.size']).toBe(4);
    s.replaceParams({ 'pixel.size': 6, 'dither.family': 'error-diffusion' });
    expect(useStudioStore.getState().history.past.length).toBe(1);
    expect(useStudioStore.getState().params['pixel.size']).toBe(6);
    s.resetParams();
    expect(useStudioStore.getState().history.past.length).toBe(2);
    expect(useStudioStore.getState().params['pixel.size']).toBe(4);
    useStudioStore.getState().undo();
    expect(useStudioStore.getState().params['dither.family']).toBe('error-diffusion');
  });

  it('应用预设记录来源，微调不改变来源，撤销 / 重做连同来源一起回退', () => {
    const s = useStudioStore.getState();
    const gameboy = findBuiltinPreset('gameboy')!;
    s.replaceParams(builtinPresetParams(gameboy), 'gameboy');
    expect(useStudioStore.getState().presetId).toBe('gameboy');
    s.setParam('tone.brightness', 12);
    expect(useStudioStore.getState().presetId).toBe('gameboy');
    useStudioStore.getState().undo();
    expect(useStudioStore.getState().presetId).toBe('gameboy');
    useStudioStore.getState().undo();
    expect(useStudioStore.getState().presetId).toBe(DEFAULT_PRESET_ID);
    expect(useStudioStore.getState().params['dither.ordered.matrix']).toBe('bayer2');
    expect(useStudioStore.getState().params['color.mode']).toBe('mono');
    useStudioStore.getState().redo();
    expect(useStudioStore.getState().presetId).toBe('gameboy');
    expect(useStudioStore.getState().params['dither.ordered.matrix']).toBe('bayer4');
    s.resetParams();
    expect(useStudioStore.getState().presetId).toBe(DEFAULT_PRESET_ID);
  });
});

describe('风格页签', () => {
  beforeEach(reset);

  it('切风格只改 style.type，两边参数都留着，进撤销栈', () => {
    const s = useStudioStore.getState();
    s.setParam('pixel.size', 7);
    s.setStyle('halftone');
    let state = useStudioStore.getState();
    expect(state.params['style.type']).toBe('halftone');
    expect(state.params['pixel.size']).toBe(7);
    expect(state.presetId).toBe(HALFTONE_DEFAULT_PRESET_ID);
    state.setParam('halftone.size', 60);
    useStudioStore.getState().setStyle('dither');
    state = useStudioStore.getState();
    expect(state.params['style.type']).toBe('dither');
    expect(state.params['halftone.size']).toBe(60);
    expect(state.presetId).toBe(DEFAULT_PRESET_ID);
    state.undo();
    expect(useStudioStore.getState().params['style.type']).toBe('halftone');
    // 同一风格再点一次不产生记录
    const before = useStudioStore.getState().history.past.length;
    useStudioStore.getState().setStyle('halftone');
    expect(useStudioStore.getState().history.past.length).toBe(before);
  });

  it('每种风格记住上次用的方案；应用另一种风格的预设直接切过去', () => {
    const s = useStudioStore.getState();
    s.replaceParams(builtinPresetParams(findBuiltinPreset('gameboy')!), 'gameboy');
    s.setStyle('halftone');
    useStudioStore.getState().replaceParams(builtinPresetParams(findBuiltinPreset('ht-poster')!), 'ht-poster');
    expect(useStudioStore.getState().params['style.type']).toBe('halftone');
    useStudioStore.getState().setStyle('dither');
    expect(useStudioStore.getState().presetId).toBe('gameboy');
    useStudioStore.getState().setStyle('halftone');
    expect(useStudioStore.getState().presetId).toBe('ht-poster');
    // 应用 Dither 预设时参数里带着 style.kind，风格跟着回去
    useStudioStore.getState().replaceParams(builtinPresetParams(findBuiltinPreset('zine')!), 'zine');
    expect(useStudioStore.getState().params['style.type']).toBe('dither');
    expect(defaultPresetIdFor('halftone')).toBe(HALFTONE_DEFAULT_PRESET_ID);
  });

  it('记住的方案被删掉后退回该风格的「默认」', () => {
    const s = useStudioStore.getState();
    const user = { id: 'u-ht', name: 'x', params: builtinPresetParams(findBuiltinPreset('ht-blob')!), createdAt: 1, base: 'ht-blob' };
    useStudioStore.setState({ presets: [user] });
    s.replaceParams(user.params, 'u-ht');
    useStudioStore.getState().setStyle('dither');
    useStudioStore.setState({ presets: [] });
    useStudioStore.getState().setStyle('halftone');
    expect(useStudioStore.getState().presetId).toBe(HALFTONE_DEFAULT_PRESET_ID);
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

  it('每个内置预设覆盖的参数都在它自己露出的范围内；「默认」露出全部分组，每种风格各有自己的「默认」', () => {
    expect(BUILTIN_PRESETS[0].id).toBe(DEFAULT_PRESET_ID);
    expect(builtinPresetsOf('dither')[0].id).toBe(DEFAULT_PRESET_ID);
    expect(builtinPresetsOf('halftone')[0].id).toBe(HALFTONE_DEFAULT_PRESET_ID);
    expect(builtinPresetsOf('halftone').length).toBe(11);
    for (const def of PARAM_SCHEMA) expect(isParamExposed(def, BUILTIN_PRESETS[0].exposes), `默认预设应露出 ${def.id}`).toBe(true);
    // 网点的默认露出自己的全部分组与共用分组，不露出抖动 / 排线专属的
    const halftoneDefault = findBuiltinPreset(HALFTONE_DEFAULT_PRESET_ID)!;
    for (const id of ['halftone.shape', 'screen.pitchX', 'ink.mode', 'tone.brightness', 'canvas.width', 'effects.stack']) {
      expect(isParamExposed(getParamDef(id), halftoneDefault.exposes), `网点默认应露出 ${id}`).toBe(true);
    }
    expect(isParamExposed(getParamDef('dither.family'), halftoneDefault.exposes)).toBe(false);
    expect(isParamExposed(getParamDef('hatch.angle'), halftoneDefault.exposes)).toBe(false);
    for (const preset of BUILTIN_PRESETS) {
      expect(preset.exposes.length).toBeGreaterThan(0);
      for (const id of Object.keys(preset.params)) {
        expect(isParamExposed(getParamDef(id), preset.exposes), `${preset.id} 设置了 ${id} 却没有露出它`).toBe(true);
      }
      // 每套方案都能改自己风格的主参数与画布尺寸
      const style = presetStyle(preset.params);
      const must =
        style === 'dither'
          ? ['dither.family', 'color.mode', 'pixel.size', 'canvas.width']
          : style === 'hatch'
            ? ['hatch.angle', 'hatch.spacingX', 'canvas.width']
            : ['halftone.shape', 'screen.pitchX', 'ink.mode', 'canvas.width'];
      for (const id of must) {
        expect(isParamExposed(getParamDef(id), preset.exposes), `${preset.id} 应露出 ${id}`).toBe(true);
      }
    }
    // 风格预设不露出与它无关的分组
    expect(isParamExposed(getParamDef('effects.stack'), findBuiltinPreset('gameboy')!.exposes)).toBe(false);
    expect(isParamExposed(getParamDef('grid.dot'), findBuiltinPreset('gameboy')!.exposes)).toBe(false);
    expect(isParamExposed(getParamDef('grid.dot'), findBuiltinPreset('dot-matrix')!.exposes)).toBe(true);
    expect(isParamExposed(getParamDef('effects.stack'), findBuiltinPreset('crt')!.exposes)).toBe(true);
  });

  it('用户预设按来源解析参数范围，来源缺失或非法时退回「默认」', () => {
    const users = [
      { id: 'u1', name: 'A', params: defaultParams(), createdAt: 1, base: 'gameboy' },
      { id: 'u2', name: 'B', params: defaultParams(), createdAt: 1 },
    ];
    expect(resolveBase('u1', users).id).toBe('gameboy');
    expect(resolveBase('u2', users).id).toBe(DEFAULT_PRESET_ID);
    expect(resolveBase('nope', users).id).toBe(DEFAULT_PRESET_ID);
    expect(resolveBase('crt', users).id).toBe('crt');
    expect(summarizeParams(builtinPresetParams(findBuiltinPreset('gameboy')!))).toBe('有序 · Bayer 4×4 · Palette · 像素 4');
    // Halftone 的用户预设没写来源时退回 Halftone 的「默认」，摘要按网点写
    const ht = { id: 'u3', name: 'C', params: builtinPresetParams(findBuiltinPreset('ht-lines')!), createdAt: 1 };
    expect(resolveBase('u3', [ht]).id).toBe(HALFTONE_DEFAULT_PRESET_ID);
    expect(presetStyleById('u3', [ht])).toBe('halftone');
    expect(presetStyleById('ht-poster', [])).toBe('halftone');
    expect(presetStyleById('hatch-pencil', [])).toBe('hatch');
    expect(presetStyleById('gameboy', [])).toBe('dither');
    expect(presetStyleById('nope', [])).toBeNull();
    expect(summarizeParams(ht.params)).toBe('网点 · 线条 · 4×7px · 双色');
    expect(summarizeParams(builtinPresetParams(findBuiltinPreset('ht-cmyk')!))).toBe('网点 · 圆形 · 10px · CMYK 分色');
  });

  it('「已微调」只看当前风格看得见的参数', () => {
    const a = defaultParams();
    const b = { ...a, 'halftone.size': 50 };
    expect(paramsDiffer(a, b, 'dither')).toBe(false);
    expect(paramsDiffer(a, b, 'hatch')).toBe(false);
    expect(paramsDiffer(a, b, 'halftone')).toBe(true);
    // 风格本身不算；共用的影调两边都算
    expect(paramsDiffer(a, { ...a, 'style.type': 'halftone' }, 'halftone')).toBe(false);
    expect(paramsDiffer(a, { ...a, 'tone.brightness': 5 }, 'dither')).toBe(true);
    expect(paramsDiffer(a, { ...a, 'tone.brightness': 5 }, 'halftone')).toBe(true);
    expect(paramsDiffer(a, { ...a, 'hatch.angle': 5 }, 'halftone')).toBe(false);
  });

  it('用户预设与设置的存储校验', () => {
    const list = sanitizeUserPresets([
      { id: 'a', name: 'x'.repeat(100), params: { 'pixel.size': 3 }, createdAt: 5, base: 'gameboy', thumbnail: 'data:image/png;base64,AAAA', updatedAt: 9 },
      { id: 'b', name: 'y', params: {}, createdAt: 1, base: 'not-a-preset', thumbnail: 'javascript:alert(1)' },
      { bad: true },
      null,
      { id: 1 },
    ]);
    expect(list.length).toBe(2);
    expect(list[0].name.length).toBe(60);
    expect(list[0]).toMatchObject({ base: 'gameboy', thumbnail: 'data:image/png;base64,AAAA', updatedAt: 9 });
    expect(list[1].base).toBeUndefined();
    expect(list[1].thumbnail).toBeUndefined();
    expect(sanitizeUserPresets('nope')).toEqual([]);
    expect(sanitizeSettings({ slotCount: 4, gpu: false, theme: 'dark' })).toEqual({ slotCount: 4, gpu: false, theme: 'dark', paneWidth: null });
    expect(sanitizeSettings({ slotCount: 3, theme: 'purple' })).toEqual({ slotCount: 1, gpu: true, theme: 'light', paneWidth: null });
    expect(sanitizeSettings(null).theme).toBe('light');
    // 左栏宽度：数值夹到可拖区间，非数值回到"均分"
    expect(sanitizeSettings({ paneWidth: 500 }).paneWidth).toBe(500);
    expect(sanitizeSettings({ paneWidth: 10 }).paneWidth).toBe(320);
    expect(sanitizeSettings({ paneWidth: 99999 }).paneWidth).toBe(1200);
    expect(sanitizeSettings({ paneWidth: 'wide' }).paneWidth).toBeNull();
    expect(sanitizeSettings({ paneWidth: Number.NaN }).paneWidth).toBeNull();
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
