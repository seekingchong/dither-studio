import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from 'mp4-muxer';
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from 'webm-muxer';
import { RenderClient } from '@/engine';
import type { Params } from '@/params';
import type { LoadedMedia } from '@/state';
import { gifFrameAt } from '@/ui/media/playback';
import { editedBitmap, editedSizeOf, IDENTITY_EDIT, type SourceEdit } from '@/ui/media/sourceEdit';
import { canvasSizeOf, evenSize, scaleOfSize, scaleParamsForSize, type ExportSize } from './resolution';

export type VideoQuality = 'medium' | 'high' | 'ultra';

/** 可选的导出帧率 */
export type ExportFps = 30 | 60;

/** 默认帧率（PRD 的 60 fps 时间线） */
export const EXPORT_FPS = 60;

export const FPS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '60', label: '60 fps' },
  { value: '30', label: '30 fps' },
];

export function isExportFps(value: unknown): value is ExportFps {
  return value === 30 || value === 60;
}

export const QUALITY_OPTIONS: Array<{ value: VideoQuality; label: string }> = [
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'ultra', label: '超高' },
];

export { evenSize };

/** 码率：以 1000×600 / 60 fps 为基准 6 / 12 / 24 Mbps，按像素数与帧率缩放 */
export function bitrateFor(quality: VideoQuality, width: number, height: number, fps: number = EXPORT_FPS): number {
  const base = quality === 'ultra' ? 24_000_000 : quality === 'high' ? 12_000_000 : 6_000_000;
  const ratio = ((width * height) / 600_000) * (fps / EXPORT_FPS);
  return Math.round(Math.min(80_000_000, Math.max(500_000, base * ratio)));
}

/** 按导出帧率的时间线取帧数；源帧率不足时重复帧 */
export function frameCountFor(duration: number, fps: number = EXPORT_FPS): number {
  return Math.max(1, Math.ceil(duration * fps));
}

export interface EncoderChoice {
  codec: string;
  container: 'mp4' | 'webm';
  mime: string;
  ext: string;
  label: string;
}

export type H264Profile = 'high' | 'main' | 'baseline';

/** H.264 三档 profile：codec 串的前两个字节（profile_idc + 约束位），后面再接 level */
const H264_PROFILES: Record<H264Profile, { prefix: string; label: string }> = {
  high: { prefix: 'avc1.6400', label: 'H.264 High' },
  main: { prefix: 'avc1.4d00', label: 'H.264 Main' },
  baseline: { prefix: 'avc1.4200', label: 'H.264 Baseline' },
};

/** 试 H.264 的顺序：先要压得最好的 High */
const H264_ORDER: H264Profile[] = ['high', 'main', 'baseline'];

export interface H264Level {
  /** level_idc，codec 串最后一个字节 */
  idc: number;
  name: string;
  /** 一帧最多几个宏块（16×16） */
  maxFs: number;
  /** 每秒最多处理几个宏块 */
  maxMbps: number;
  /** Baseline / Main 的码率上限（kbps）；High 再乘 1.25 */
  maxKbps: number;
}

/**
 * H.264 各 level 的上限（ITU-T H.264 表 A-1 / A-2）。从 4.0 起：再低的档没有收益，4.0 是各平台都认的起步档。
 */
export const H264_LEVELS: readonly H264Level[] = [
  { idc: 0x28, name: '4.0', maxFs: 8192, maxMbps: 245_760, maxKbps: 20_000 },
  { idc: 0x29, name: '4.1', maxFs: 8192, maxMbps: 245_760, maxKbps: 50_000 },
  { idc: 0x2a, name: '4.2', maxFs: 8704, maxMbps: 522_240, maxKbps: 50_000 },
  { idc: 0x32, name: '5.0', maxFs: 22_080, maxMbps: 589_824, maxKbps: 135_000 },
  { idc: 0x33, name: '5.1', maxFs: 36_864, maxMbps: 983_040, maxKbps: 240_000 },
  { idc: 0x34, name: '5.2', maxFs: 36_864, maxMbps: 2_073_600, maxKbps: 240_000 },
  { idc: 0x3c, name: '6.0', maxFs: 139_264, maxMbps: 4_177_920, maxKbps: 240_000 },
  { idc: 0x3d, name: '6.1', maxFs: 139_264, maxMbps: 8_355_840, maxKbps: 480_000 },
  { idc: 0x3e, name: '6.2', maxFs: 139_264, maxMbps: 16_711_680, maxKbps: 800_000 },
];

/**
 * 这个尺寸 / 帧率 / 码率至少要 H.264 的哪个 level。
 * Chromium 的 `VideoEncoder.isConfigSupported` 会拿 codec 串里的 level 去核对帧面积：level 写死 4.0（8192 个宏块，1080p 那一档）
 * 的话，2000×1200 一帧 9375 个宏块就直接被拒，再大更是，于是整条 H.264 都过不了、掉到 VP9 / WebM——所以 level 得按实际尺寸算。
 * 帧率与码率同样按表核对，免得平台的编码器比 Chromium 更较真。连 6.2 都装不下（8192×4352 以上）返回 null。
 */
export function h264LevelFor(width: number, height: number, fps: number, bitrate: number, profile: H264Profile = 'high'): H264Level | null {
  const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  const bitrateFactor = profile === 'high' ? 1.25 : 1;
  return H264_LEVELS.find((l) => macroblocks <= l.maxFs && macroblocks * fps <= l.maxMbps && bitrate <= l.maxKbps * 1000 * bitrateFactor) ?? null;
}

const WEBM_CANDIDATES: EncoderChoice[] = [
  { codec: 'vp09.00.10.08', container: 'webm', mime: 'video/webm', ext: 'webm', label: 'VP9' },
  { codec: 'vp8', container: 'webm', mime: 'video/webm', ext: 'webm', label: 'VP8' },
];

/** 候选编码器按优先级排：H.264（High → Main → Baseline，level 按尺寸 / 帧率 / 码率算出来）进 MP4，后面才是 VP9 / VP8 进 WebM */
export function encoderCandidates(width: number, height: number, bitrate: number, fps: number = EXPORT_FPS): EncoderChoice[] {
  const h264: EncoderChoice[] = [];
  for (const profile of H264_ORDER) {
    const level = h264LevelFor(width, height, fps, bitrate, profile);
    if (!level) continue;
    const { prefix, label } = H264_PROFILES[profile];
    h264.push({
      codec: `${prefix}${level.idc.toString(16).padStart(2, '0')}`,
      container: 'mp4',
      mime: 'video/mp4',
      ext: 'mp4',
      label: `${label} ${level.name}`,
    });
  }
  return [...h264, ...WEBM_CANDIDATES];
}

/** 优先 H.264 进 MP4；平台没有 H.264 编码器（或尺寸大到 H.264 也装不下）时降级为 VP9 / VP8 进 WebM */
export async function chooseEncoder(width: number, height: number, bitrate: number, fps: number = EXPORT_FPS): Promise<EncoderChoice | null> {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const c of encoderCandidates(width, height, bitrate, fps)) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec: c.codec, width, height, bitrate, framerate: fps });
      if (r.supported) return c;
    } catch {
      // 该 codec 字符串不被识别，试下一个
    }
  }
  return null;
}

export interface ExportVideoOptions {
  media: LoadedMedia;
  params: Params;
  quality: VideoQuality;
  gpu: boolean;
  /** 导出分辨率（等比）；不给就是画布尺寸 */
  size?: ExportSize;
  /** 导出帧率；不给就是 60 */
  fps?: ExportFps;
  /** 只导出这一段（视频的裁剪窗口）；不给就是整段 */
  trim?: { start: number; length: number };
  /** 素材编辑（旋转 / 镜像 / 裁剪缩放）；不给就是原样 */
  edit?: SourceEdit;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export interface ExportVideoResult {
  bytes: Uint8Array;
  choice: EncoderChoice;
  frames: number;
  width: number;
  height: number;
  fps: number;
}

async function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 1e-4 && video.readyState >= 2) return;
  await new Promise<void>((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener('error', onError);
      resolve();
    };
    const onError = () => {
      video.removeEventListener('seeked', onSeeked);
      reject(new Error('视频定位失败'));
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.currentTime = time;
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 导出视频：按选定帧率的时间线逐帧取源帧 → 独立 Worker 按导出分辨率渲染 → WebCodecs 编码 → 封装。
 * 分辨率不是 1× 时，画布与画布上的尺寸（格子、间距、粗细）一起缩，见 `scaleParamsForSize`。
 */
export async function exportVideo(opts: ExportVideoOptions): Promise<ExportVideoResult> {
  const { media, params, quality, signal } = opts;
  const fps = opts.fps ?? EXPORT_FPS;
  const canvas = canvasSizeOf(params);
  const out = opts.size ? { width: evenSize(opts.size.width), height: evenSize(opts.size.height) } : { width: evenSize(canvas.width), height: evenSize(canvas.height) };
  const bitrate = bitrateFor(quality, out.width, out.height, fps);
  const choice = await chooseEncoder(out.width, out.height, bitrate, fps);
  if (!choice) throw new Error('当前环境没有可用的视频编码器');

  const duration = media.duration ?? 0;
  if (duration <= 0) throw new Error('媒体没有时长信息');
  // 裁剪窗口：起点钳进素材里，长度不超过剩下的时长
  const offset = Math.min(Math.max(0, opts.trim?.start ?? 0), duration);
  const span = Math.max(1 / fps, Math.min(opts.trim?.length ?? duration, duration - offset));
  const total = frameCountFor(span, fps);
  const renderParams = scaleParamsForSize(params, out);
  // 「原始尺寸」适配不看画布尺寸，源帧多大就摆多大——画布放大了源帧却没跟着放大，构图就变了，
  // 所以这一档把源帧也按同一比例缩到位，别的适配方式交给流水线自己缩。
  const sourceScale = String(params['canvas.fit']) === 'native' ? scaleOfSize(canvas, out) : 1;

  let muxer: Mp4Muxer<Mp4Target> | WebmMuxer<WebmTarget>;
  let target: Mp4Target | WebmTarget;
  if (choice.container === 'mp4') {
    target = new Mp4Target();
    muxer = new Mp4Muxer({ target, video: { codec: 'avc', width: out.width, height: out.height, frameRate: fps }, fastStart: 'in-memory' });
  } else {
    target = new WebmTarget();
    muxer = new WebmMuxer({ target, video: { codec: choice.codec.startsWith('vp09') ? 'V_VP9' : 'V_VP8', width: out.width, height: out.height, frameRate: fps } });
  }

  let encodeError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => (muxer as Mp4Muxer<Mp4Target>).addVideoChunk(chunk, meta as EncodedVideoChunkMetadata),
    error: (e) => {
      encodeError = e;
    },
  });
  encoder.configure({ codec: choice.codec, width: out.width, height: out.height, bitrate, framerate: fps, latencyMode: 'quality' });

  const client = new RenderClient();
  const video = media.kind === 'video' ? media.video : undefined;
  const wasTime = video?.currentTime ?? 0;
  video?.pause();

  /** 源帧要不要先缩一手：只有「原始尺寸」适配需要，别的返回 null 让流水线去缩 */
  const sourceTarget = (source: CanvasImageSource, edit: SourceEdit): ExportSize | null => {
    if (sourceScale === 1) return null;
    const size = editedSizeOf(source, edit);
    return { width: Math.max(1, Math.round(size.width * sourceScale)), height: Math.max(1, Math.round(size.height * sourceScale)) };
  };

  try {
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw new Error('已取消');
      if (encodeError) throw encodeError;
      const t = offset + i / fps;
      const edit = opts.edit ?? IDENTITY_EDIT;
      let bitmap: ImageBitmap;
      if (video) {
        await seekVideo(video, Math.min(t, Math.max(0, duration - 1 / fps)));
        bitmap = await editedBitmap(video, edit, sourceTarget(video, edit));
      } else if (media.frames && media.delays) {
        const source = media.frames[gifFrameAt(media.delays, t)];
        bitmap = await editedBitmap(source, edit, sourceTarget(source, edit));
      } else {
        bitmap = await editedBitmap(media.bitmap, edit, sourceTarget(media.bitmap, edit));
      }
      client.setSource(0, `export#${i}`, bitmap);
      const rendered = await client.renderOnce(0, renderParams, { previewScale: 1, gpu: opts.gpu });
      const frame = new VideoFrame(rendered.frame.data as Uint8ClampedArray<ArrayBuffer>, {
        format: 'RGBA',
        codedWidth: rendered.frame.width,
        codedHeight: rendered.frame.height,
        timestamp: Math.round((i * 1_000_000) / fps),
        duration: Math.round(1_000_000 / fps),
      });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 8) await sleep(4);
      opts.onProgress?.(i + 1, total);
    }
    await encoder.flush();
    if (encodeError) throw encodeError;
    muxer.finalize();
    return { bytes: new Uint8Array(target.buffer), choice, frames: total, width: out.width, height: out.height, fps };
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    client.dispose();
    if (video) {
      try {
        video.currentTime = wasTime;
      } catch {
        // 忽略
      }
    }
  }
}
