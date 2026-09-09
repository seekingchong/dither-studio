import { beforeEach, describe, expect, it } from 'vitest';
import { defaultParams } from '@/params';
import {
  DEFAULT_PRESET_ID,
  GLYPH_DEFAULT_PRESET_ID,
  LEGACY_SCHEME_PREFIX,
  builtinPresetParams,
  findBuiltinPreset,
  mediaKey,
  presetNameById,
  sanitizeSchemes,
  schemeBaseName,
  schemeDiffers,
  schemeMediaOf,
  schemesFromLegacyPresets,
  uniqueName,
  useStudioStore,
  type LoadedMedia,
  type SavedScheme,
  type UserPreset,
} from '@/state';

const media = (over: Partial<LoadedMedia> = {}): LoadedMedia => ({
  id: `m-${Math.random()}`,
  name: 'photo.png',
  kind: 'image',
  width: 800,
  height: 500,
  bitmap: {} as ImageBitmap,
  ...over,
});

const scheme = (over: Partial<SavedScheme> = {}): SavedScheme => ({
  id: 's1',
  name: 'photo · 默认',
  params: defaultParams(),
  presetId: DEFAULT_PRESET_ID,
  media: schemeMediaOf(media()),
  createdAt: 1,
  ...over,
});

describe('素材身份', () => {
  it('同名同尺寸就是同一份素材，跟这次载入的 id 无关；视频还要同时长', () => {
    expect(mediaKey(media())).toBe(mediaKey(media({ id: 'other' })));
    expect(mediaKey(media())).toBe(mediaKey(schemeMediaOf(media())));
    expect(mediaKey(media({ width: 801 }))).not.toBe(mediaKey(media()));
    expect(mediaKey(media({ name: 'b.png' }))).not.toBe(mediaKey(media()));
    const clip = media({ name: 'clip.mp4', kind: 'video', duration: 12.34 });
    expect(mediaKey(clip)).toBe(mediaKey(media({ name: 'clip.mp4', kind: 'video', duration: 12.341 })));
    expect(mediaKey(clip)).not.toBe(mediaKey(media({ name: 'clip.mp4', kind: 'video', duration: 20 })));
    expect(mediaKey(null)).toBeNull();
  });

  it('schemeMediaOf 只留文件信息：不带位图，路径与时长有才记', () => {
    const plain = schemeMediaOf(media());
    expect(plain).toEqual({ name: 'photo.png', kind: 'image', width: 800, height: 500 });
    const clip = schemeMediaOf(media({ name: 'clip.mov', kind: 'video', duration: 3.5, path: '/tmp/clip.mov' }));
    expect(clip).toEqual({ name: 'clip.mov', kind: 'video', width: 800, height: 500, duration: 3.5, path: '/tmp/clip.mov' });
  });
});

describe('方案命名', () => {
  it('默认名是「素材名 · 预设名」，去掉扩展名；没素材只有预设名', () => {
    expect(schemeBaseName({ name: 'my.photo.png' }, 'Game Boy')).toBe('my.photo · Game Boy');
    expect(schemeBaseName(null, 'Game Boy')).toBe('Game Boy');
  });

  it('重名往后排号', () => {
    expect(uniqueName('a', [])).toBe('a');
    expect(uniqueName('a', ['a'])).toBe('a 2');
    expect(uniqueName('a', ['a', 'a 2'])).toBe('a 3');
    expect(uniqueName('  a  ', ['a'])).toBe('a 2');
  });
});

describe('方案是否被动过', () => {
  const now = () => ({ params: defaultParams(), media: media(), edit: undefined, trim: undefined });

  it('素材、参数、编辑、裁剪都没变就没动过', () => {
    expect(schemeDiffers(scheme(), now())).toBe(false);
    // 恒等编辑与默认裁剪跟缺省一样
    expect(schemeDiffers(scheme(), { ...now(), edit: { rotate: 0, flipX: false, flipY: false, zoom: 1, offsetX: 0, offsetY: 0 }, trim: { start: 0, length: null } })).toBe(false);
  });

  it('当前风格看得见的参数改了算动过，别的风格的参数改了不算', () => {
    expect(schemeDiffers(scheme(), { ...now(), params: { ...defaultParams(), 'pixel.size': 9 } })).toBe(true);
    expect(schemeDiffers(scheme(), { ...now(), params: { ...defaultParams(), 'halftone.size': 60 } })).toBe(false);
    // 风格换了也算
    expect(schemeDiffers(scheme(), { ...now(), params: { ...defaultParams(), 'style.type': 'halftone' } })).toBe(true);
  });

  it('素材换了、素材编辑变了算动过；裁剪窗口只对视频算', () => {
    expect(schemeDiffers(scheme(), { ...now(), media: media({ name: 'other.png' }) })).toBe(true);
    expect(schemeDiffers(scheme(), { ...now(), media: null })).toBe(true);
    expect(schemeDiffers(scheme({ media: null }), { ...now(), media: null })).toBe(false);
    expect(schemeDiffers(scheme(), { ...now(), edit: { rotate: 90, flipX: false, flipY: false, zoom: 1, offsetX: 0, offsetY: 0 } })).toBe(true);
    expect(schemeDiffers(scheme(), { ...now(), trim: { start: 2, length: 3 } })).toBe(false);
    const clip = media({ name: 'clip.mp4', kind: 'video', duration: 10 });
    const videoScheme = scheme({ media: schemeMediaOf(clip), trim: { start: 2, length: 3 } });
    expect(schemeDiffers(videoScheme, { ...now(), media: clip, trim: { start: 2, length: 3 } })).toBe(false);
    expect(schemeDiffers(videoScheme, { ...now(), media: clip, trim: { start: 2.5, length: 3 } })).toBe(true);
    expect(schemeDiffers(videoScheme, { ...now(), media: clip, trim: undefined })).toBe(true);
  });
});

describe('方案存储', () => {
  it('sanitizeSchemes 丢掉坏条目、去重、补默认，恒等编辑与默认裁剪不落盘', () => {
    const list = sanitizeSchemes([
      null,
      { id: 'a' },
      { id: 'ok', name: 'n', params: {}, createdAt: 5 },
      { id: 'ok', name: 'dup', params: {} },
      {
        id: 'full',
        name: 'x'.repeat(80),
        params: { 'pixel.size': 3 },
        presetId: 'gameboy',
        media: { name: 'a.png', kind: 'image', width: 10.4, height: 20 },
        edit: { rotate: 90, flipX: true, zoom: 9, offsetX: -3 },
        trim: { start: 1.5, length: 2 },
        thumbnail: 'data:image/png;base64,AAAA',
        createdAt: 1,
        updatedAt: 2,
      },
      { id: 'identity', name: 'i', params: {}, media: { name: 'v.mp4', kind: 'video', width: 1, height: 1, duration: 4, path: '/v.mp4' }, edit: { rotate: 0 }, trim: { start: 0 }, thumbnail: 'nope' },
      { id: 'badmedia', name: 'b', params: {}, media: { name: 'x', kind: 'audio', width: 1, height: 1 } },
    ]);
    expect(list.map((s) => s.id)).toEqual(['ok', 'full', 'identity', 'badmedia']);
    expect(list[0]).toEqual({ id: 'ok', name: 'n', params: {}, presetId: 'default', media: null, createdAt: 5 });
    const full = list[1];
    expect(full.name).toHaveLength(60);
    expect(full.presetId).toBe('gameboy');
    expect(full.media).toEqual({ name: 'a.png', kind: 'image', width: 10, height: 20 });
    expect(full.edit).toEqual({ rotate: 90, flipX: true, flipY: false, zoom: 4, offsetX: -1, offsetY: 0 });
    expect(full.trim).toEqual({ start: 1.5, length: 2 });
    expect(full.thumbnail).toBe('data:image/png;base64,AAAA');
    expect(full.updatedAt).toBe(2);
    const identity = list[2];
    expect(identity.media).toEqual({ name: 'v.mp4', kind: 'video', width: 1, height: 1, duration: 4, path: '/v.mp4' });
    expect(identity.edit).toBeUndefined();
    expect(identity.trim).toBeUndefined();
    expect(identity.thumbnail).toBeUndefined();
    expect(list[3].media).toBeNull();
    expect(sanitizeSchemes('x')).toEqual([]);
  });

  it('旧版历史（就是用户预设）原样搬进方案：一条一条、参数缩略图时间都在、素材记空；预设本身不动', () => {
    const presets: UserPreset[] = [
      { id: 'p1', name: '我的 GB', params: builtinPresetParams(findBuiltinPreset('gameboy')!), createdAt: 10, updatedAt: 20, base: 'gameboy', thumbnail: 'data:image/png;base64,AA', starred: true },
      { id: 'p2', name: '网点', params: builtinPresetParams(findBuiltinPreset('ht-poster')!), createdAt: 30 },
    ];
    const migrated = schemesFromLegacyPresets(presets);
    expect(migrated).toHaveLength(2);
    expect(migrated[0]).toEqual({
      id: `${LEGACY_SCHEME_PREFIX}p1`,
      name: '我的 GB',
      params: presets[0].params,
      presetId: 'p1',
      media: null,
      createdAt: 10,
      updatedAt: 20,
      thumbnail: 'data:image/png;base64,AA',
    });
    expect(migrated[1].updatedAt).toBeUndefined();
    expect(migrated[1].thumbnail).toBeUndefined();
    // 搬出来的也能通过校验原样读回
    expect(sanitizeSchemes(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
    // 应用旧记录：基于的就是那条预设本身，所以相对预设没有微调
    expect(presetNameById('p1', presets)).toBe('我的 GB');
    expect(presetNameById('gameboy', presets)).toBe('Game Boy');
    expect(presetNameById('gone', presets)).toBeUndefined();
  });
});

describe('store 里的方案', () => {
  beforeEach(() => {
    useStudioStore.setState({
      params: defaultParams(),
      presetId: DEFAULT_PRESET_ID,
      schemeId: null,
      history: { past: [], future: [], lastEditId: null, lastEditAt: 0 },
      presets: [],
      schemes: [],
      lastPresetByStyle: {},
    });
  });

  it('应用方案换参数与来源预设并记住方案；微调不清、换预设清；撤销 / 重做连同方案回退', () => {
    const gb = scheme({ id: 'sg', params: builtinPresetParams(findBuiltinPreset('gameboy')!), presetId: 'gameboy' });
    const s = useStudioStore.getState();
    s.applyScheme(gb);
    let state = useStudioStore.getState();
    expect(state.schemeId).toBe('sg');
    expect(state.presetId).toBe('gameboy');
    expect(state.params['dither.ordered.matrix']).toBe('bayer4');
    state.setParam('tone.brightness', 5);
    expect(useStudioStore.getState().schemeId).toBe('sg');
    useStudioStore.getState().replaceParams(builtinPresetParams(findBuiltinPreset('zine')!), 'zine');
    state = useStudioStore.getState();
    expect(state.schemeId).toBeNull();
    expect(state.presetId).toBe('zine');
    state.undo();
    expect(useStudioStore.getState().schemeId).toBe('sg');
    expect(useStudioStore.getState().params['tone.brightness']).toBe(5);
    useStudioStore.getState().undo();
    useStudioStore.getState().undo();
    expect(useStudioStore.getState().schemeId).toBeNull();
    expect(useStudioStore.getState().presetId).toBe(DEFAULT_PRESET_ID);
    useStudioStore.getState().redo();
    expect(useStudioStore.getState().schemeId).toBe('sg');
    useStudioStore.getState().resetParams();
    expect(useStudioStore.getState().schemeId).toBeNull();
  });

  it('方案基于的预设已经删掉时退回该风格的「默认」；setScheme 不进撤销栈', () => {
    const glyph = scheme({ id: 'sy', params: builtinPresetParams(findBuiltinPreset('glyph-typewriter')!), presetId: 'u-gone' });
    useStudioStore.getState().applyScheme(glyph);
    const state = useStudioStore.getState();
    expect(state.presetId).toBe(GLYPH_DEFAULT_PRESET_ID);
    expect(state.params['style.type']).toBe('glyph');
    expect(state.schemeId).toBe('sy');
    // 我的预设还在就照它来
    const user: UserPreset = { id: 'u-ok', name: 'x', params: builtinPresetParams(findBuiltinPreset('glyph-typewriter')!), createdAt: 1, base: 'glyph-typewriter' };
    useStudioStore.setState({ presets: [user] });
    useStudioStore.getState().applyScheme(scheme({ id: 'sz', params: user.params, presetId: 'u-ok' }));
    expect(useStudioStore.getState().presetId).toBe('u-ok');
    const depth = useStudioStore.getState().history.past.length;
    useStudioStore.getState().setScheme(null);
    expect(useStudioStore.getState().schemeId).toBeNull();
    expect(useStudioStore.getState().history.past.length).toBe(depth);
  });

  it('setSchemes 走校验', () => {
    useStudioStore.getState().setSchemes([{ id: 'a', name: 'n', params: {} }, 'junk']);
    expect(useStudioStore.getState().schemes.map((s) => s.id)).toEqual(['a']);
  });
});
