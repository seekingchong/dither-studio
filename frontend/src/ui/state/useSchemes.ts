import { useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { mimeFromName, usePlatform, type MediaFile, type Platform, type PlatformMediaStore } from '@/platform';
import { sanitizeParams } from '@/params';
import {
  SCHEMES_STORAGE_KEY,
  isDefaultSchemeTrim,
  isIdentitySchemeEdit,
  mediaKey,
  newPresetId,
  orphanStoredKeys,
  presetNameById,
  schemeBaseName,
  schemeDiffers,
  schemeMediaOf,
  uniqueName,
  useStudioStore,
  type LoadedMedia,
  type SavedScheme,
  type SchemeEdit,
  type SchemeMedia,
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
 * 把素材文件存进应用（`platform.mediaStore`），返回存储键。
 * 已经在存储里的（从方案里读回来的、这次会话存过的）直接用那个键；Electron 打开的文件有路径就让主进程直接拷，
 * 不把整个视频搬过 IPC；原文件已经不在了、或是拖拽 / 粘贴进来的，就用内存里的原件字节。
 * 没有存储的平台返回 undefined——方案照存，只是只记文件信息。
 */
async function storeMedia(store: PlatformMediaStore | undefined, media: LoadedMedia): Promise<string | undefined> {
  if (!store) return undefined;
  if (media.stored) return media.stored;
  let key: string | undefined;
  if (media.path) {
    try {
      key = await store.store({ name: media.name, path: media.path });
    } catch {
      // 原文件挪走了：改用内存里的原件
    }
  }
  if (!key) {
    if (!media.source) return undefined;
    key = await store.store({ name: media.name, bytes: new Uint8Array(await media.source.arrayBuffer()) });
  }
  // 记在素材上：同一份素材再存一条方案不用重新算
  media.stored = key;
  return key;
}

/** 存方案时的素材信息：文件信息 + 存进应用后的存储键；存不进去只提示，方案照存 */
async function snapshotMedia(store: PlatformMediaStore | undefined, media: LoadedMedia, warn: (message: string) => void): Promise<SchemeMedia> {
  const out = schemeMediaOf(media);
  try {
    const stored = await storeMedia(store, media);
    if (stored) out.stored = stored;
  } catch (err) {
    warn(`素材文件没能存进应用（${(err as Error).message}），这条方案只记了文件信息`);
  }
  return out;
}

/** 坑位里正放着的素材的存储键：方案删了它们还在用，文件先留着 */
function loadedStoredKeys(): string[] {
  return useStudioStore.getState().slots.flatMap((slot) => (slot.media?.stored ? [slot.media.stored] : []));
}

type ReadBack = { file: MediaFile; fromPath: boolean } | 'nothing' | 'failed';

/** 把方案绑的素材读回来：先从应用里存的那份，没有（旧方案）或读不到再试原路径（Electron） */
async function readSchemeMedia(platform: Platform, wanted: SchemeMedia): Promise<ReadBack> {
  const mime = mimeFromName(wanted.name);
  let tried = false;
  if (wanted.stored && platform.mediaStore) {
    tried = true;
    try {
      const bytes = await platform.mediaStore.read(wanted.stored);
      return { file: { name: wanted.name, mime, bytes, path: wanted.path, stored: wanted.stored }, fromPath: false };
    } catch {
      // 存储里的那份不见了：还有路径就再试路径
    }
  }
  if (wanted.path && platform.kind === 'electron') {
    tried = true;
    try {
      const bytes = await platform.files.read(wanted.path);
      return { file: { name: wanted.name, mime, bytes, path: wanted.path }, fromPath: true };
    } catch {
      // 原文件也不在了
    }
  }
  return tried ? 'failed' : 'nothing';
}

/**
 * 方案（「历史」页）：素材 + 参数 + 素材编辑 + 视频裁剪窗口，绑着当时的素材。
 * 预览头的「保存」把当前这一套写回正在用的方案（没有就新存一条），「另存」一律新存一条（名字按「素材名 · 预设名」自动起）；
 * 保存时素材文件本身也存一份进应用，应用一条方案会把参数、来源预设一起换过去，素材不是它绑的那份就从应用里把它读回来
 * （原文件挪走、删掉都不影响），同一份素材时连编辑与裁剪也恢复。
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

  const warn = useCallback((message: string) => show(message, 'error'), [show]);

  /** 这些存储键里没被剩下的方案引用、坑位里也没在用的，把文件从应用里删掉 */
  const release = useCallback(
    async (keys: Array<string | undefined>, remaining: readonly SavedScheme[]) => {
      const store = platform.mediaStore;
      if (!store) return;
      const candidates = keys.filter((key): key is string => !!key);
      for (const key of orphanStoredKeys(remaining, candidates, loadedStoredKeys())) {
        await store.remove(key).catch(() => undefined);
      }
    },
    [platform],
  );

  /** 新存一条方案：名字按「素材名 · 预设名」起、重名排号；没素材存不了 */
  const create = useCallback(async () => {
    const state = useStudioStore.getState();
    const at = state.view.activeSlot;
    const current = state.slots[at]?.media ?? null;
    if (!current) {
      show('先放入一张图片或一段视频，再保存方案');
      return null;
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
    // 素材文件本身也存进应用，然后马上落盘，中间不留空档
    scheme.media = await snapshotMedia(platform.mediaStore, current, warn);
    await persist([...useStudioStore.getState().schemes, scheme]);
    useStudioStore.getState().setScheme(scheme.id);
    show(`已保存方案「${scheme.name}」`);
    return scheme;
  }, [client, persist, platform, show, warn]);

  /** 用当前素材与参数覆盖某条方案（刷新缩略图与时间）；换了素材时原来那份文件没人用了就删掉 */
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
        media: target.media,
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
      if (current) next.media = await snapshotMedia(platform.mediaStore, current, warn);
      const list = useStudioStore.getState().schemes.map((s) => (s.id === id ? next : s));
      await persist(list);
      useStudioStore.getState().setScheme(id);
      show(`已更新方案「${target.name}」`);
      await release([target.media?.stored], list);
    },
    [client, persist, platform, release, show, warn],
  );

  /**
   * 「保存」：正在用历史里的某条方案就把它覆盖掉（没动过时只提示，不重复存），还没有就新存一条。
   * 跟文档编辑器的 ⌘S 一个意思——有文件就写回那个文件，没有才另起一个。
   */
  const save = useCallback(async () => {
    const state = useStudioStore.getState();
    const at = state.view.activeSlot;
    const current = state.slots[at]?.media ?? null;
    if (!current) {
      show('先放入一张图片或一段视频，再保存方案');
      return null;
    }
    const using = state.schemes.find((s) => s.id === state.schemeId);
    if (!using) return create();
    if (!schemeDiffers(using, { params: state.params, media: current, edit: currentEdit(at), trim: currentTrim(at) })) {
      show(`「${using.name}」没有改动，已在历史中`);
      return using;
    }
    await update(using.id);
    return useStudioStore.getState().schemes.find((s) => s.id === using.id) ?? null;
  }, [create, update, show]);

  /** 「另存」：一律新存一条，正在用的那条不动 */
  const saveAs = useCallback(() => create(), [create]);

  /** 升级前只记了路径的旧方案：这次从原路径打开成功了，就顺手把文件存进应用，下次原文件不在也能打开 */
  const adopt = useCallback(
    async (id: string, current: LoadedMedia) => {
      try {
        const stored = await storeMedia(platform.mediaStore, current);
        if (!stored) return;
        const list = useStudioStore.getState().schemes;
        const target = list.find((s) => s.id === id);
        if (!target?.media || target.media.stored === stored) return;
        await persist(list.map((s) => (s.id === id && s.media ? { ...s, media: { ...s.media, stored } } : s)));
      } catch {
        // 补存失败不打扰：这条方案本来就还能靠原路径打开
      }
    },
    [persist, platform],
  );

  /**
   * 应用一条方案。素材不是它绑的那份时：先从应用里存的那份读回，旧方案没存过的再试原路径（Electron）；
   * 都打不开或什么都没记就只套参数，提示一句。同一份素材（或刚读回来）才恢复编辑与裁剪窗口。
   */
  const apply = useCallback(
    async (scheme: SavedScheme) => {
      const state = useStudioStore.getState();
      const at = state.view.activeSlot;
      let current = state.slots[at]?.media ?? null;
      const wanted = scheme.media;
      let adoptLoaded: LoadedMedia | null = null;
      if (wanted && mediaKey(current) !== mediaKey(wanted)) {
        const back = await readSchemeMedia(platform, wanted);
        if (back === 'failed') {
          show(`素材「${wanted.name}」打不开了（应用里没存、原文件也不在了），只应用了参数`, 'error');
        } else if (back === 'nothing') {
          if (current) show(`这条方案存的是「${wanted.name}」，已把参数套在当前素材上`);
          else show(`这条方案存的是「${wanted.name}」，放入素材后再看效果`);
        } else {
          await acceptMediaFiles([back.file], at);
          await new Promise<void>((r) => window.setTimeout(r, MEDIA_SETTLE_MS));
          current = useStudioStore.getState().slots[at]?.media ?? null;
          if (back.fromPath && current && mediaKey(current) === mediaKey(wanted)) adoptLoaded = current;
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
      if (adoptLoaded) void adopt(scheme.id, adoptLoaded);
    },
    [acceptMediaFiles, adopt, platform, show],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      await persist(useStudioStore.getState().schemes.map((s) => (s.id === id ? { ...s, name: trimmed.slice(0, 60) } : s)));
    },
    [persist],
  );

  /** 删除；正在用的方案被删掉时参数保留，只是不再指向它；它绑的素材文件没别的方案用了就从应用里删掉 */
  const remove = useCallback(
    async (id: string) => {
      const state = useStudioStore.getState();
      const gone = state.schemes.find((s) => s.id === id);
      const remaining = state.schemes.filter((s) => s.id !== id);
      await persist(remaining);
      if (state.schemeId === id) useStudioStore.getState().setScheme(null);
      await release([gone?.media?.stored], remaining);
    },
    [persist, release],
  );

  return { schemes, presets, active, dirty, media, currentMediaKey, save, saveAs, update, apply, rename, remove };
}
