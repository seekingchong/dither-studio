/// <reference lib="webworker" />
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

function bitmapToFrame(bitmap: ImageBitmap): RGBAFrame {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const c2d = canvas.getContext('2d', { willReadFrequently: true });
  if (!c2d) throw new Error('OffscreenCanvas 2D 上下文不可用');
  c2d.drawImage(bitmap, 0, 0);
  const image = c2d.getImageData(0, 0, bitmap.width, bitmap.height);
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
  }
};
