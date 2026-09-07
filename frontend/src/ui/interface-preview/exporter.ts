import { useStudioStore, type LoadedMedia } from '@/state';
import { frameToPngBlob } from '@/ui/export/png';
import { bitrateFor, chooseEncoder, evenSize, exportVideo, type VideoQuality } from '@/ui/export/video';
import { trimOf, usePlaybackStore } from '@/ui/media/playback';
import { editKey, editOf, useSourceEditStore } from '@/ui/media/sourceEdit';
import { useFrameStore } from '@/ui/renderer/RendererContext';
import { PREVIEW_CHANNEL, type PreviewExport, type PreviewFile, type PreviewFormat, type PreviewMedia, type PreviewProgress } from './protocol';

/** 视频质量档：与「导出视频」对话框的默认值一致 */
const VIDEO_QUALITY: VideoQuality = 'high';

/**
 * 改动之后等多久再开始导。图片编成 PNG 几乎不花时间；视频要逐帧渲染再编码，
 * 多等一会儿让连续拖动合并成一次，拖动期间在途的那次也立刻作废。
 */
const IMAGE_DEBOUNCE_MS = 80;
const VIDEO_DEBOUNCE_MS = 500;

/** 进度消息的最小间隔：240 帧每帧都报只是白发消息 */
const PROGRESS_INTERVAL_MS = 100;

/** 成品 / 进度的去处（预览窗口）；transfer 里是随消息转移的字节 */
export type PreviewSink = (message: PreviewProgress | PreviewExport, transfer?: Transferable[]) => void;

/** 对象身份 → 递增编号。参数表、渲染帧都是不可变对象，换了引用就是换了内容，用编号进键里 */
const identities = new WeakMap<object, number>();
let identitySeq = 0;
function identity(obj: object): number {
  let id = identities.get(obj);
  if (id === undefined) {
    id = ++identitySeq;
    identities.set(obj, id);
  }
  return id;
}

interface Inputs {
  /** 决定成品内容的全部输入拼成的键：键没变就不用重导 */
  key: string;
  media: LoadedMedia | null;
}

/**
 * 此刻该导什么。
 * 图片的成品就是「导出图片」会存的那张全分辨率帧的 PNG，所以只认最近一帧（参数 / 素材编辑一改，
 * 新帧一到键就变）；还没有全分辨率帧时返回 null，等下一次变化。
 * 视频 / GIF 的成品由参数、素材编辑、裁剪窗口、GPU 开关一起决定，跟播放到哪一帧无关。
 */
function currentInputs(slot: number): Inputs | null {
  const state = useStudioStore.getState();
  const media = state.slots[slot]?.media ?? null;
  if (!media) return { key: 'empty', media: null };
  if (media.kind === 'image') {
    const rendered = useFrameStore.getState().frames[slot];
    if (!rendered || rendered.scale !== 1) return null;
    return { key: `png|${media.id}|${identity(rendered)}`, media };
  }
  const trim = media.kind === 'video' ? trimOf(slot) : null;
  const key = [
    'video',
    media.id,
    editKey(editOf(slot)),
    identity(state.params),
    state.settings.gpu ? 'gpu' : 'cpu',
    trim ? `${trim.start.toFixed(3)}+${trim.length.toFixed(3)}` : '',
  ].join('|');
  return { key, media };
}

function describe(media: LoadedMedia): PreviewMedia {
  return { name: media.name, kind: media.kind, width: media.width, height: media.height };
}

/** Uint8Array → 自己独占的 ArrayBuffer，好整个转移出去 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

/**
 * 导出用的独立 <video>：与主窗口播放的那个共用同一段数据，但各自定位，
 * 导出逐帧 seek 时主窗口的预览照样播，不用像「导出视频」对话框那样先把播放停下。
 */
async function detachedVideo(source: HTMLVideoElement): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = source.currentSrc || source.src;
  await new Promise<void>((resolve, reject) => {
    video.addEventListener('loadeddata', () => resolve(), { once: true });
    video.addEventListener('error', () => reject(new Error('视频无法解码')), { once: true });
    video.load();
  });
  return video;
}

function releaseVideo(video: HTMLVideoElement) {
  video.pause();
  video.removeAttribute('src');
  video.load();
}

/**
 * 一个坑位的成品导出器（跑在主窗口里）。
 *
 * 开着预览窗口期间盯着参数、素材、素材编辑、裁剪窗口，一变就把成品重导一遍送过去：
 * 图片走「导出图片」同一条路（全分辨率帧 → PNG），视频 / GIF 走「导出视频」同一条路
 * （60 fps 逐帧全分辨率渲染 → H.264 MP4，没有编码器时 VP9 / VP8 WebM），
 * 视频用自己的 <video> 定位，主窗口的播放不受影响。
 * 导过的成品按输入键缓存，窗口关了再开、输入没变就直接给，不用再导一遍。
 */
export class SlotExporter {
  private readonly slot: number;
  private readonly sink: PreviewSink;
  private unsubscribe: Array<() => void> = [];
  private timer = 0;
  /** 当前认定要导的输入键；导完之后 delivered.key 与它相同 */
  private key: string | null = null;
  private inflight: AbortController | null = null;
  private delivered: { key: string; message: PreviewExport } | null = null;
  private progress: PreviewProgress | null = null;
  private clone: { mediaId: string; video: HTMLVideoElement } | null = null;

  constructor(slot: number, sink: PreviewSink) {
    this.slot = slot;
    this.sink = sink;
  }

  /** 预览窗口开了：开始盯着输入，第一份成品马上导 */
  start(): void {
    this.stop();
    const check = () => this.check();
    this.unsubscribe = [
      useStudioStore.subscribe(check),
      useFrameStore.subscribe(check),
      useSourceEditStore.subscribe(check),
      usePlaybackStore.subscribe(check),
    ];
    this.check();
  }

  /** 预览窗口关了：不再盯着，在途的导出作废；缓存留着，再开时输入没变就不用重导 */
  stop(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.inflight?.abort();
    this.inflight = null;
    this.progress = null;
    this.key = null;
    this.releaseClone();
  }

  /** 预览窗口来要成品：有现成的直接给；正在导就把进度再报一次；都没有就等输入变化触发 */
  resend(): void {
    if (this.delivered && this.delivered.key === this.key) {
      this.send(this.delivered.message);
      return;
    }
    if (this.progress) this.sink(this.progress);
  }

  private check(): void {
    const inputs = currentInputs(this.slot);
    if (!inputs || inputs.key === this.key) return;
    this.key = inputs.key;
    this.inflight?.abort();
    this.inflight = null;
    this.progress = null;
    window.clearTimeout(this.timer);
    if (!inputs.media) this.releaseClone();
    const delay = !inputs.media ? 0 : inputs.media.kind === 'image' ? IMAGE_DEBOUNCE_MS : VIDEO_DEBOUNCE_MS;
    this.timer = window.setTimeout(() => void this.run(inputs), delay);
  }

  private async run(inputs: Inputs): Promise<void> {
    const { key, media } = inputs;
    if (this.delivered?.key === key) {
      this.send(this.delivered.message);
      return;
    }
    const controller = new AbortController();
    this.inflight = controller;
    const base = { channel: PREVIEW_CHANNEL, type: 'export', slot: this.slot, media: media ? describe(media) : null } as const;
    let message: PreviewExport;
    try {
      const file = media ? await this.produce(media, controller.signal) : null;
      message = { ...base, file, error: null };
    } catch (err) {
      if (controller.signal.aborted) return;
      message = { ...base, file: null, error: (err as Error).message };
    }
    if (controller.signal.aborted) return;
    this.inflight = null;
    this.progress = null;
    // 失败的不进缓存：下次要的时候再试一次
    if (!message.error) this.delivered = { key, message };
    this.send(message);
  }

  /** 字节是可转移对象，过去零拷贝；缓存里留自己的一份 */
  private send(message: PreviewExport): void {
    if (!message.file) {
      this.sink(message);
      return;
    }
    const bytes = message.file.bytes.slice(0);
    this.sink({ ...message, file: { ...message.file, bytes } }, [bytes]);
  }

  private report(media: LoadedMedia, format: PreviewFormat, done: number, total: number): void {
    this.progress = { channel: PREVIEW_CHANNEL, type: 'progress', slot: this.slot, media: describe(media), format, done, total };
    this.sink(this.progress);
  }

  private async produce(media: LoadedMedia, signal: AbortSignal): Promise<PreviewFile> {
    if (media.kind === 'image') {
      const rendered = useFrameStore.getState().frames[this.slot];
      if (!rendered) throw new Error('还没有渲染结果');
      this.report(media, 'PNG', 0, 1);
      const blob = await frameToPngBlob(rendered.frame);
      return { kind: 'image', mime: 'image/png', format: 'PNG', width: rendered.frame.width, height: rendered.frame.height, bytes: await blob.arrayBuffer() };
    }

    const { params, settings } = useStudioStore.getState();
    const width = evenSize(Math.round(Number(params['canvas.width']) || 1000));
    const height = evenSize(Math.round(Number(params['canvas.height']) || 600));
    const choice = await chooseEncoder(width, height, bitrateFor(VIDEO_QUALITY, width, height));
    if (!choice) throw new Error('当前环境没有可用的视频编码器');
    const format: PreviewFormat = choice.container === 'mp4' ? 'MP4' : 'WebM';
    const trim = media.kind === 'video' ? trimOf(this.slot) : null;
    const source = media.kind === 'video' && media.video ? { ...media, video: await this.cloneOf(media, media.video, signal) } : media;
    let lastReport = 0;
    this.report(media, format, 0, 1);
    const result = await exportVideo({
      media: source,
      params,
      quality: VIDEO_QUALITY,
      gpu: settings.gpu,
      trim: trim ? { start: trim.start, length: trim.length } : undefined,
      edit: editOf(this.slot),
      signal,
      onProgress: (done, total) => {
        const now = performance.now();
        if (done !== total && now - lastReport < PROGRESS_INTERVAL_MS) return;
        lastReport = now;
        this.report(media, format, done, total);
      },
    });
    return { kind: 'video', mime: result.choice.mime, format, width, height, bytes: toArrayBuffer(result.bytes) };
  }

  /** 同一段视频只克隆一次；换了素材就换一个 */
  private async cloneOf(media: LoadedMedia, source: HTMLVideoElement, signal: AbortSignal): Promise<HTMLVideoElement> {
    if (this.clone && this.clone.mediaId === media.id) return this.clone.video;
    const video = await detachedVideo(source);
    if (signal.aborted) {
      releaseVideo(video);
      throw new Error('已取消');
    }
    this.releaseClone();
    this.clone = { mediaId: media.id, video };
    return video;
  }

  private releaseClone(): void {
    if (!this.clone) return;
    releaseVideo(this.clone.video);
    this.clone = null;
  }
}
