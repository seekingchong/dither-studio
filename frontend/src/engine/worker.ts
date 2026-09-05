/// <reference lib="webworker" />
import { frameToSvg } from './export/svg';
import { halftoneToSvg } from './halftone/svg';
import { Pipeline } from './pipeline';
import { scaleParamsForPreview } from './preview';
import type { WorkerRequest, WorkerResponse } from './protocol';
import type { RGBAFrame } from './types';

interface SourceEntry {
  id: string;
  frame: RGBAFrame;
  pipeline: Pipeline;
}

const sources = new Map<number, SourceEntry>();
const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: WorkerResponse, transfer: Transferable[] = []) {
  ctx.postMessage(msg, transfer);
}

/** 取像素用的暂存画布：视频逐帧时每帧都要用，按尺寸复用，不每帧新建 */
let scratch: OffscreenCanvas | null = null;
let scratchCtx: OffscreenCanvasRenderingContext2D | null = null;

function bitmapToFrame(bitmap: ImageBitmap): RGBAFrame {
  if (!scratch || !scratchCtx || scratch.width !== bitmap.width || scratch.height !== bitmap.height) {
    scratch = new OffscreenCanvas(bitmap.width, bitmap.height);
    scratchCtx = scratch.getContext('2d', { willReadFrequently: true });
  }
  if (!scratchCtx) throw new Error('OffscreenCanvas 2D 上下文不可用');
  // 复用画布要先清干净，否则带透明通道的源会和上一帧混在一起
  scratchCtx.clearRect(0, 0, bitmap.width, bitmap.height);
  scratchCtx.drawImage(bitmap, 0, 0);
  const image = scratchCtx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return { width: image.width, height: image.height, data: image.data };
}

/** 替换坑位的源帧；已有流水线时复用（视频逐帧时其余阶段的缓存仍有效） */
function setSource(slot: number, id: string, frame: RGBAFrame) {
  const existing = sources.get(slot);
  if (existing) {
    existing.id = id;
    existing.frame = frame;
  } else {
    sources.set(slot, { id, frame, pipeline: new Pipeline() });
  }
  post({ type: 'sourceReady', slot, id, width: frame.width, height: frame.height });
}

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'setSource': {
      try {
        setSource(msg.slot, msg.id, bitmapToFrame(msg.bitmap));
      } catch (err) {
        post({ type: 'error', jobId: null, slot: msg.slot, message: (err as Error).message });
      }
      break;
    }
    case 'setSourceFrame':
      setSource(msg.slot, msg.id, { width: msg.width, height: msg.height, data: new Uint8ClampedArray(msg.buffer) });
      break;
    case 'clearSource':
      sources.delete(msg.slot);
      break;
    case 'render': {
      const entry = sources.get(msg.slot);
      if (!entry) {
        post({ type: 'error', jobId: msg.jobId, slot: msg.slot, message: '坑位没有源媒体' });
        return;
      }
      try {
        const { params, scale } = scaleParamsForPreview(msg.params, msg.options?.previewScale ?? 1);
        entry.pipeline.gpu = msg.options?.gpu ?? true;
        const out = entry.pipeline.run(entry.frame, entry.id, params);
        const stats = entry.pipeline.lastStats;
        post(
          {
            type: 'frame',
            jobId: msg.jobId,
            slot: msg.slot,
            width: out.width,
            height: out.height,
            buffer: out.data.buffer as ArrayBuffer,
            elapsedMs: stats.elapsedMs,
            recomputed: stats.recomputed,
            scale,
            canvasWidth: Math.round(Number(msg.params['canvas.width']) || out.width),
            canvasHeight: Math.round(Number(msg.params['canvas.height']) || out.height),
            gpu: stats.gpu,
          },
          [out.data.buffer as ArrayBuffer],
        );
      } catch (err) {
        post({ type: 'error', jobId: msg.jobId, slot: msg.slot, message: (err as Error).message });
      }
      break;
    }
    case 'svg': {
      const entry = sources.get(msg.slot);
      if (!entry) {
        post({ type: 'error', jobId: msg.jobId, slot: msg.slot, message: '坑位没有源媒体' });
        return;
      }
      try {
        // 导出用全分辨率参数跑一遍（缓存命中就几乎不花时间），Halftone 直接拿几何出矢量，Dither 把色块并成矩形
        entry.pipeline.gpu = msg.options?.gpu ?? true;
        const out = entry.pipeline.run(entry.frame, entry.id, msg.params);
        const geometry = entry.pipeline.currentHalftone;
        const svg = String(msg.params['style.kind']) === 'halftone' && geometry ? halftoneToSvg(geometry) : frameToSvg(out);
        post({ type: 'svg', jobId: msg.jobId, slot: msg.slot, svg });
      } catch (err) {
        post({ type: 'error', jobId: msg.jobId, slot: msg.slot, message: (err as Error).message });
      }
      break;
    }
  }
};
