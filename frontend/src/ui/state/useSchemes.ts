import { useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { mimeFromName, usePlatform } from '@/platform';
import { sanitizeParams } from '@/params';
import {
  SCHEMES_STORAGE_KEY,
  isDefaultSchemeTrim,
  isIdentitySchemeEdit,
  mediaKey,
  newPresetId,
  presetNameById,
  schemeBaseName,
  schemeDiffers,
  schemeMediaOf,
  uniqueName,
  useStudioStore,
  type SavedScheme,
  type SchemeEdit,
  type SchemeTrim,
} from '@/state';
import { useOpenMedia } from '@/ui/media/useOpenMedia';
import { playbackOf, usePlaybackStore } from '@/ui/media/playback';
import { IDENTITY_EDIT, editOf, useSourceEditStore } from '@/ui/media/sourceEdit';
import { useToast } from '@/ui/primitives';
import { useRenderClient } from '@/ui/renderer/RendererContext';
import { captureThumbnail } from './captureThumbnail';

/** 重新打开素材后，等 SlotView / 播放控制器对新素材的重置跑完，再把方案里的编辑与裁剪盖上去 */
const MEDIA_SETTLE_MS = 50;

/** 当前坑位的素材编辑与视频裁剪窗口，缺省（恒等 / 没动过）时为 undefined，跟方案里存的一致 */
function currentEdit(slot: number): SchemeEdit | undefined {
  const edit = editOf(slot);
  return isIdentitySchemeEdit(edit) ? undefined : { ...edit };
}

function currentTrim(slot: number): SchemeTrim | undefined {
  const pb = playbackOf(slot);
  const trim = { start: pb.trimStart, length: pb.trimLength };
  return isDefaultSchemeTrim(trim) ? undefined : trim;
}

/**
 * 方案（「历史」页）：素材 + 参数 + 素材编辑 + 视频裁剪窗口，绑着当时的素材。
 * 预览头的「保存」把当前这一套存进来（名字按「素材名 · 预设名」自动起）；
 * 应用一条方案会把参数、来源预设一起换过去，素材还在时连编辑与裁剪也恢复，
 * Electron 上素材已经换掉但记得路径的话还会把它重新打开。
 */
export function useSchemes() {
  const platform = usePlatform();
  const client = useRenderClient();
  const show = useToast((s) => s.show);
  const { acceptMediaFiles } = useOpenMedia();
  const { schemes, presets, params, schemeId, slot, media } = useStudioStore(
    useShallow((s) => ({
      schemes: s.schemes,
      presets: s.presets,
      params: s.params,
      schemeId: s.schemeId,
      slot: s.view.activeSlot,
      media: s.slots[s.view.activeSlot]?.media ?? null,
    })),
  );
  const edit = useSourceEditStore((s) => s.slots[slot] ?? IDENTITY_EDIT);
  const trim = usePlaybackStore(useShallow((s) => ({ start: s.slots[slot]?.trimStart ?? 0, length: s.slots[slot]?.trimLength ?? null })));

  /** 正在用的方案（历史里的一条），没有就是 undefined */
  const active = useMemo(() => schemes.find((s) => s.id === schemeId), [schemes, schemeId]);
  /** 正在用的方案是否已被动过：参数、素材、编辑、裁剪任一变了都算 */
  const dirty = useMemo(() => !!active && schemeDiffers(active, { params, media, edit, trim }), [active, params, media, edit, trim]);
  /** 当前坑位素材的身份键；没有素材为 null */
  const currentMediaKey = mediaKey(media);

  const persist = useCallback(
    async (list: SavedScheme[]) => {
      useStudioStore.getState().setSchemes(list);
      try {
        await platform.storage.set(SCHEMES_STORAGE_KEY, list);
      } catch (err) {
        show(`方案保存失败：${(err as Error).message}`, 'error');
      }
    },
    [platform, show],
  );

  /** 把当前素材 + 参数存成新方案。正在用的方案没动过就不重复存 */
  const save = useCallback(async () => {
    const state = useStudioStore.getState();
    const at = state.view.activeSlot;
    const current = state.slots[at]?.media ?? null;
    if (!current) {
      show('先放入一张图片或一段视频，再保存方案');
      return null;
    }
    const using = state.schemes.find((s) => s.id === state.schemeId);
    if (using && !schemeDiffers(using, { params: state.params, media: current, edit: currentEdit(at), trim: currentTrim(at) })) {
      show(`「${using.name}」已在历史中`);
      return using;
    }
    const presetName = presetNameById(state.presetId, state.presets) ?? '默认';
    const scheme: SavedScheme = {
      id: newPresetId(),
      name: uniqueName(schemeBaseName(current, presetName), state.schemes.map((s) => s.name)),
      params: sanitizeParams(state.params),
      presetId: state.presetId,
      media: schemeMediaOf(current),
      createdAt: Date.now(),
    };
    const e = currentEdit(at);
    if (e) scheme.edit = e;
    const t = current.kind === 'video' ? currentTrim(at) : undefined;
    if (t) scheme.trim = t;
    const thumbnail = await captureThumbnail(client);
    if (thumbnail) scheme.thumbnail = thumbnail;
    await persist([...useStudioStore.getState().schemes, scheme]);
    useStudioStore.getState().setScheme(scheme.id);
    show(`已保存方案「${scheme.name}」`);
    return scheme;
  }, [client, persist, show]);

  /** 用当前素材与参数覆盖某条方案（刷新缩略图与时间） */
  const update = useCallback(
    async (id: string) => {
      const state = useStudioStore.getState();
      const target = state.schemes.find((s) => s.id === id);
      if (!target) return;
      const at = state.view.activeSlot;
      const current = state.slots[at]?.media ?? null;
      const next: SavedScheme = {
        ...target,
        params: sanitizeParams(state.params),
        presetId: state.presetId,
        media: current ? schemeMediaOf(current) : target.media,
        updatedAt: Date.now(),
      };
      delete next.edit;
      delete next.trim;
      const e = currentEdit(at);
      if (e) next.edit = e;
      const t = current?.kind === 'video' ? currentTrim(at) : undefined;
      if (t) next.trim = t;
      const thumbnail = await captureThumbnail(client);
      if (thumbnail) next.thumbnail = thumbnail;
      await persist(useStudioStore.getState().schemes.map((s) => (s.id === id ? next : s)));
      useStudioStore.getState().setScheme(id);
      show(`已更新方案「${target.name}」`);
    },
    [client, persist, show],
  );

  /**
   * 应用一条方案。素材不是它绑的那份时：Electron 上记得路径就重新打开；
   * 打不开或没有路径就只套参数，提示一句。同一份素材（或刚重新打开）才恢复编辑与裁剪窗口。
   */
  const apply = useCallback(
    async (scheme: SavedScheme) => {
      const state = useStudioStore.getState();
      const at = state.view.activeSlot;
      let current = state.slots[at]?.media ?? null;
      const wanted = scheme.media;
      if (wanted && mediaKey(current) !== mediaKey(wanted)) {
        if (wanted.path && platform.kind === 'electron') {
          try {
            const bytes = await platform.files.read(wanted.path);
            await acceptMediaFiles([{ name: wanted.name, mime: mimeFromName(wanted.name), bytes, path: wanted.path }], at);
            await new Promise<void>((r) => window.setTimeout(r, MEDIA_SETTLE_MS));
            current = useStudioStore.getState().slots[at]?.media ?? null;
          } catch (err) {
            show(`素材「${wanted.name}」打不开了（${(err as Error).message}），只应用了参数`, 'error');
          }
        } else if (current) {
          show(`这条方案存的是「${wanted.name}」，已把参数套在当前素材上`);
        } else {
          show(`这条方案存的是「${wanted.name}」，放入素材后再看效果`);
        }
      }
      if (current && wanted && mediaKey(current) === mediaKey(wanted)) {
        if (scheme.edit) useSourceEditStore.getState().update(at, scheme.edit);
        else useSourceEditStore.getState().reset(at);
        if (current.kind === 'video') {
          const start = scheme.trim?.start ?? 0;
          usePlaybackStore.getState().update(at, { trimStart: start, trimLength: scheme.trim?.length ?? null, time: start });
        }
      }
      useStudioStore.getState().applyScheme(scheme);
    },
    [acceptMediaFiles, platform, show],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      await persist(useStudioStore.getState().schemes.map((s) => (s.id === id ? { ...s, name: trimmed.slice(0, 60) } : s)));
    },
    [persist],
  );

  /** 删除；正在用的方案被删掉时参数保留，只是不再指向它 */
  const remove = useCallback(
    async (id: string) => {
      const state = useStudioStore.getState();
      await persist(state.schemes.filter((s) => s.id !== id));
      if (state.schemeId === id) useStudioStore.getState().setScheme(null);
    },
    [persist],
  );

  return { schemes, presets, active, dirty, media, currentMediaKey, save, update, apply, rename, remove };
}
