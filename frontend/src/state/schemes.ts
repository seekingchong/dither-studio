import { sanitizeParams, styleOf, type Params, type StyleKind } from '@/params';
import { findBuiltinPreset, paramsDiffer, type UserPreset } from './presets';
import type { LoadedMedia } from './types';

/**
 * 方案（历史）与预设是两回事：
 * - 预设 = 一套参数，不绑素材，走左栏「保存预设」，出现在预设模块的卡片里；
 * - 方案 = 素材 + 参数（+ 素材编辑与视频裁剪窗口），走预览头的「保存」，出现在「历史」页。
 * 同一套预设可以在不同素材上存成多个方案，每个方案记着当时基于哪个预设。
 */

/**
 * 方案绑定的素材：文件信息 + 文件本身在应用里的存储键。同名、同尺寸（视频再同时长）视为同一份素材。
 * 保存方案时素材文件会存一份进应用（`platform.mediaStore`），应用方案时从那里读回，原文件挪走、删掉都不影响；
 * 路径只是备用——升级前只记了路径的旧方案靠它打开，打开后自动补存。
 */
export interface SchemeMedia {
  name: string;
  kind: 'image' | 'video' | 'gif';
  width: number;
  height: number;
  /** 视频 / GIF 时长（秒） */
  duration?: number;
  /** 本地路径，仅 Electron 打开的文件有；没有存进应用的旧方案靠它把素材重新打开 */
  path?: string;
  /** 存进应用里的那份文件的存储键；应用方案时优先从这里读回 */
  stored?: string;
}

/** 素材编辑（旋转 / 镜像 / 裁剪缩放），与 `ui/media/sourceEdit` 的 SourceEdit 同形 */
export interface SchemeEdit {
  rotate: 0 | 90 | 180 | 270;
  flipX: boolean;
  flipY: boolean;
  zoom: number;
  offsetX: number;
  offsetY: number;
}

/** 视频裁剪窗口：起点与窗长（秒）；length 为 null 走默认窗长 */
export interface SchemeTrim {
  start: number;
  length: number | null;
}

export interface SavedScheme {
  id: string;
  name: string;
  params: Params;
  /** 存方案时基于的预设（内置或我的预设 id）；预设后来被删了就退回该风格的「默认」 */
  presetId: string;
  /** 绑定的素材；预设与方案还没分开时存下的旧记录没有 */
  media: SchemeMedia | null;
  /** 素材编辑，恒等变换时缺省 */
  edit?: SchemeEdit;
  /** 视频裁剪窗口，没动过时缺省 */
  trim?: SchemeTrim;
  /** 保存时的结果缩略图（PNG data URL） */
  thumbnail?: string;
  createdAt: number;
  /** 最近一次用当前素材与参数覆盖的时间 */
  updatedAt?: number;
}

export const SCHEMES_STORAGE_KEY = 'schemes';

export const IDENTITY_SCHEME_EDIT: SchemeEdit = { rotate: 0, flipX: false, flipY: false, zoom: 1, offsetX: 0, offsetY: 0 };
export const DEFAULT_SCHEME_TRIM: SchemeTrim = { start: 0, length: null };

const NAME_MAX = 60;

/** 素材的身份键：同一个文件再打开一次 id 会变，所以按名字 + 尺寸（+ 时长）认 */
export function mediaKey(media: Pick<SchemeMedia, 'name' | 'kind' | 'width' | 'height' | 'duration'> | LoadedMedia | null | undefined): string | null {
  if (!media) return null;
  const parts = [media.kind, media.name, `${media.width}x${media.height}`];
  if (media.kind !== 'image' && typeof media.duration === 'number' && Number.isFinite(media.duration)) parts.push(String(Math.round(media.duration * 100)));
  return parts.join(':');
}

/** 已载入的素材 → 方案里记的素材信息 */
export function schemeMediaOf(media: LoadedMedia): SchemeMedia {
  const out: SchemeMedia = { name: media.name, kind: media.kind, width: media.width, height: media.height };
  if (typeof media.duration === 'number' && Number.isFinite(media.duration) && media.duration > 0) out.duration = media.duration;
  if (media.path) out.path = media.path;
  if (media.stored) out.stored = media.stored;
  return out;
}

/** 方案们引用着的全部存储键 */
export function referencedStoredKeys(schemes: readonly SavedScheme[]): Set<string> {
  const keys = new Set<string>();
  for (const scheme of schemes) if (scheme.media?.stored) keys.add(scheme.media.stored);
  return keys;
}

/**
 * `candidates` 里没被任何方案引用、也不在 `keep` 里的存储键——删方案后的残留、存到一半崩掉的，都在这里清。
 * `keep` 是坑位里正放着的素材的键：方案删了素材还在用，文件先留着，下次启动再清。
 */
export function orphanStoredKeys(schemes: readonly SavedScheme[], candidates: readonly string[], keep: Iterable<string> = []): string[] {
  const referenced = referencedStoredKeys(schemes);
  for (const key of keep) referenced.add(key);
  return Array.from(new Set(candidates)).filter((key) => !referenced.has(key));
}

export function isIdentitySchemeEdit(edit: SchemeEdit | undefined): boolean {
  if (!edit) return true;
  return edit.rotate === 0 && !edit.flipX && !edit.flipY && edit.zoom <= 1 && edit.offsetX === 0 && edit.offsetY === 0;
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;

export function sameSchemeEdit(a: SchemeEdit | undefined, b: SchemeEdit | undefined): boolean {
  const x = a ?? IDENTITY_SCHEME_EDIT;
  const y = b ?? IDENTITY_SCHEME_EDIT;
  return x.rotate === y.rotate && x.flipX === y.flipX && x.flipY === y.flipY && near(x.zoom, y.zoom) && near(x.offsetX, y.offsetX) && near(x.offsetY, y.offsetY);
}

export function isDefaultSchemeTrim(trim: SchemeTrim | undefined): boolean {
  return !trim || (near(trim.start, 0) && trim.length == null);
}

export function sameSchemeTrim(a: SchemeTrim | undefined, b: SchemeTrim | undefined): boolean {
  const x = a ?? DEFAULT_SCHEME_TRIM;
  const y = b ?? DEFAULT_SCHEME_TRIM;
  if (!near(x.start, y.start)) return false;
  if (x.length == null || y.length == null) return x.length == null && y.length == null;
  return near(x.length, y.length);
}

/** 当前这一刻的"素材 + 参数 + 编辑 + 裁剪"，用来跟存下的方案比对 */
export interface SchemeSnapshot {
  params: Params;
  media: LoadedMedia | SchemeMedia | null;
  edit?: SchemeEdit;
  trim?: SchemeTrim;
}

/**
 * 方案是否已被动过：风格换了、当前风格看得见的参数改了、素材换了、素材编辑或视频裁剪窗口变了，都算。
 * 裁剪窗口只对视频有意义，图片 / GIF 不比。
 */
export function schemeDiffers(scheme: SavedScheme, now: SchemeSnapshot): boolean {
  const style: StyleKind = styleOf(now.params);
  if (styleOf(scheme.params) !== style) return true;
  if (paramsDiffer(scheme.params, now.params, style)) return true;
  if (mediaKey(scheme.media) !== mediaKey(now.media)) return true;
  if (!sameSchemeEdit(scheme.edit, now.edit)) return true;
  if (now.media?.kind === 'video' && !sameSchemeTrim(scheme.trim, now.trim)) return true;
  return false;
}

/** 文件名去掉扩展名 */
export function mediaStem(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** 方案的默认名字：「素材名 · 预设名」，没有素材就只有预设名 */
export function schemeBaseName(media: Pick<SchemeMedia, 'name'> | null | undefined, presetName: string): string {
  return (media ? `${mediaStem(media.name)} · ${presetName}` : presetName).slice(0, NAME_MAX);
}

/** 重名往后排号：「名字」「名字 2」「名字 3」… */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const stem = base.trim().slice(0, NAME_MAX);
  if (!used.has(stem)) return stem;
  for (let i = 2; i < 1000; i++) {
    const next = `${stem} ${i}`.slice(0, NAME_MAX);
    if (!used.has(next)) return next;
  }
  return `${stem} ${Date.now()}`.slice(0, NAME_MAX);
}

const KINDS = new Set(['image', 'video', 'gif']);
const ROTATIONS = new Set([0, 90, 180, 270]);

function sanitizeMedia(input: unknown): SchemeMedia | null {
  if (!input || typeof input !== 'object') return null;
  const rec = input as Record<string, unknown>;
  if (typeof rec.name !== 'string' || typeof rec.kind !== 'string' || !KINDS.has(rec.kind)) return null;
  if (typeof rec.width !== 'number' || typeof rec.height !== 'number' || !(rec.width > 0) || !(rec.height > 0)) return null;
  const media: SchemeMedia = { name: rec.name, kind: rec.kind as SchemeMedia['kind'], width: Math.round(rec.width), height: Math.round(rec.height) };
  if (typeof rec.duration === 'number' && Number.isFinite(rec.duration) && rec.duration > 0) media.duration = rec.duration;
  if (typeof rec.path === 'string' && rec.path) media.path = rec.path;
  if (typeof rec.stored === 'string' && rec.stored) media.stored = rec.stored.slice(0, 200);
  return media;
}

function sanitizeEdit(input: unknown): SchemeEdit | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const rec = input as Record<string, unknown>;
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  const edit: SchemeEdit = {
    rotate: (ROTATIONS.has(rec.rotate as number) ? rec.rotate : 0) as SchemeEdit['rotate'],
    flipX: rec.flipX === true,
    flipY: rec.flipY === true,
    zoom: Math.min(4, Math.max(1, num(rec.zoom, 1))),
    offsetX: Math.min(1, Math.max(-1, num(rec.offsetX, 0))),
    offsetY: Math.min(1, Math.max(-1, num(rec.offsetY, 0))),
  };
  return isIdentitySchemeEdit(edit) ? undefined : edit;
}

function sanitizeTrim(input: unknown): SchemeTrim | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const rec = input as Record<string, unknown>;
  const start = typeof rec.start === 'number' && Number.isFinite(rec.start) ? Math.max(0, rec.start) : 0;
  const length = typeof rec.length === 'number' && Number.isFinite(rec.length) && rec.length > 0 ? rec.length : null;
  const trim = { start, length };
  return isDefaultSchemeTrim(trim) ? undefined : trim;
}

/** 从存储读出的方案做基本校验；坏掉的条目跳过 */
export function sanitizeSchemes(input: unknown): SavedScheme[] {
  if (!Array.isArray(input)) return [];
  const out: SavedScheme[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.id !== 'string' || typeof rec.name !== 'string' || !rec.params || typeof rec.params !== 'object') continue;
    if (seen.has(rec.id)) continue;
    seen.add(rec.id);
    const scheme: SavedScheme = {
      id: rec.id,
      name: rec.name.slice(0, NAME_MAX),
      params: rec.params as Params,
      presetId: typeof rec.presetId === 'string' && rec.presetId ? rec.presetId : 'default',
      media: sanitizeMedia(rec.media),
      createdAt: typeof rec.createdAt === 'number' ? rec.createdAt : 0,
    };
    if (typeof rec.updatedAt === 'number') scheme.updatedAt = rec.updatedAt;
    const edit = sanitizeEdit(rec.edit);
    if (edit) scheme.edit = edit;
    const trim = sanitizeTrim(rec.trim);
    if (trim) scheme.trim = trim;
    if (typeof rec.thumbnail === 'string' && rec.thumbnail.startsWith('data:image/')) scheme.thumbnail = rec.thumbnail;
    out.push(scheme);
  }
  return out;
}

/** 旧版历史记录迁移出来的方案 id 前缀：迁移是幂等的，同一条预设不会迁出两份 */
export const LEGACY_SCHEME_PREFIX = 'legacy:';

/**
 * 预设与方案分开之前，「历史」页列的就是全部用户预设（左栏「保存预设」与预览头「保存」存的是同一种东西）。
 * 升级后把它们照样搬进「历史」：一条预设一条方案，参数、缩略图、时间原样保留，素材记为空（当时没记）。
 * 预设本身留在预设列表里不动，所以两边看到的都跟以前一样，一条不少。
 */
export function schemesFromLegacyPresets(presets: readonly UserPreset[]): SavedScheme[] {
  return presets.map((preset) => {
    const scheme: SavedScheme = {
      id: `${LEGACY_SCHEME_PREFIX}${preset.id}`,
      name: preset.name,
      params: sanitizeParams(preset.params),
      presetId: preset.id,
      media: null,
      createdAt: preset.createdAt,
    };
    if (typeof preset.updatedAt === 'number') scheme.updatedAt = preset.updatedAt;
    if (preset.thumbnail) scheme.thumbnail = preset.thumbnail;
    return scheme;
  });
}

/** 预设（内置或我的）的名字；找不到返回 undefined */
export function presetNameById(id: string, userPresets: readonly UserPreset[]): string | undefined {
  return userPresets.find((p) => p.id === id)?.name ?? findBuiltinPreset(id)?.name;
}
