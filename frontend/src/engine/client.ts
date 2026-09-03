import type { Params } from '@/params';
import type { WorkerRequest, WorkerResponse } from './protocol';
import type { RGBAFrame } from './types';

export interface RenderedFrame {
  slot: number;
  frame: RGBAFrame;
  elapsedMs: number;
  recomputed: string[];
}

type FrameListener = (frame: RenderedFrame) => void;
type ErrorListener = (slot: number, message: string) => void;

/**
 * 主线程侧的渲染调度：每个坑位最多一个在途任务，期间到达的参数只保留最新一份，
 * 上一帧返回后再发。参数连续变化时自然合并，不会堆积任务。
 */
export class RenderClient {
  private worker: Worker;
  private jobSeq = 0;
  private inflight = new Map<number, number>();
  private pending = new Map<number, Params>();
  private scheduled = false;
  private frameListeners = new Set<FrameListener>();
  private errorListeners = new Set<ErrorListener>();

  constructor(worker?: Worker) {
    this.worker = worker ?? new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'dither-engine' });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.handle(event.data);
    this.worker.onerror = (event) => {
      for (const cb of this.errorListeners) cb(-1, event.message);
    };
  }

  setSource(slot: number, id: string, bitmap: ImageBitmap) {
    this.send({ type: 'setSource', slot, id, bitmap }, [bitmap]);
  }

  setSourceFrame(slot: number, id: string, frame: RGBAFrame) {
    const buffer = frame.data.buffer.slice(0) as ArrayBuffer;
    this.send({ type: 'setSourceFrame', slot, id, width: frame.width, height: frame.height, buffer }, [buffer]);
  }

  clearSource(slot: number) {
    this.pending.delete(slot);
    this.inflight.delete(slot);
    this.send({ type: 'clearSource', slot });
  }

  render(slot: number, params: Params) {
    this.pending.set(slot, params);
    if (!this.scheduled) {
      this.scheduled = true;
      queueMicrotask(() => {
        this.scheduled = false;
        this.flush();
      });
    }
  }

  onFrame(cb: FrameListener): () => void {
    this.frameListeners.add(cb);
    return () => this.frameListeners.delete(cb);
  }

  onError(cb: ErrorListener): () => void {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }

  dispose() {
    this.worker.terminate();
    this.frameListeners.clear();
    this.errorListeners.clear();
  }

  private flush() {
    for (const [slot, params] of this.pending) {
      if (this.inflight.has(slot)) continue;
      this.pending.delete(slot);
      const jobId = ++this.jobSeq;
      this.inflight.set(slot, jobId);
      this.send({ type: 'render', jobId, slot, params });
    }
  }

  private handle(msg: WorkerResponse) {
    switch (msg.type) {
      case 'frame': {
        if (this.inflight.get(msg.slot) === msg.jobId) this.inflight.delete(msg.slot);
        const frame: RGBAFrame = { width: msg.width, height: msg.height, data: new Uint8ClampedArray(msg.buffer) };
        for (const cb of this.frameListeners) cb({ slot: msg.slot, frame, elapsedMs: msg.elapsedMs, recomputed: msg.recomputed });
        this.flush();
        break;
      }
      case 'error': {
        if (msg.jobId !== null && this.inflight.get(msg.slot) === msg.jobId) this.inflight.delete(msg.slot);
        for (const cb of this.errorListeners) cb(msg.slot, msg.message);
        this.flush();
        break;
      }
      case 'sourceReady':
        break;
    }
  }

  private send(msg: WorkerRequest, transfer: Transferable[] = []) {
    this.worker.postMessage(msg, transfer);
  }
}
