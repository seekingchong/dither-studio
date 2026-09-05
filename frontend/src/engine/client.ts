import type { Params } from '@/params';
import type { RenderOptions, WorkerRequest, WorkerResponse } from './protocol';
import type { RGBAFrame } from './types';

export interface RenderedFrame {
  slot: number;
  frame: RGBAFrame;
  elapsedMs: number;
  recomputed: string[];
  /** 帧相对画布的比例，预览降分辨率时 < 1 */
  scale: number;
  canvasWidth: number;
  canvasHeight: number;
  gpu: boolean;
}

type FrameListener = (frame: RenderedFrame) => void;
type ErrorListener = (slot: number, message: string) => void;

interface PendingRender {
  params: Params;
  options?: RenderOptions;
}

/**
 * 主线程侧的渲染调度：每个坑位最多一个在途任务，期间到达的参数只保留最新一份，
 * 上一帧返回后再发。参数连续变化时自然合并，不会堆积任务。
 *
 * 渲染请求只在该坑位的源帧已经送进 Worker 之后才发出：载入媒体时源帧要先 createImageBitmap
 * 再 postMessage，而参数 effect 在同一次提交里就会请求渲染，若不拦一下，渲染消息会先于源帧
 * 到达 Worker，Worker 回一个「坑位没有源媒体」——这就是每次拖入素材都先弹一条报错、随后又渲染正常的原因。
 * 现在这类请求留在队列里，等 setSource 一到立刻跟着发出。
 */
export class RenderClient {
  private worker: Worker;
  private jobSeq = 0;
  private inflight = new Map<number, number>();
  private pending = new Map<number, PendingRender>();
  /** 已把源帧送进 Worker 的坑位 */
  private sourced = new Set<number>();
  private scheduled = false;
  /** 在途的 SVG 导出，按 jobId 等结果 */
  private svgJobs = new Map<number, { resolve: (svg: string) => void; reject: (err: Error) => void }>();
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
    this.markSourced(slot);
  }

  setSourceFrame(slot: number, id: string, frame: RGBAFrame) {
    const buffer = frame.data.buffer.slice(0) as ArrayBuffer;
    this.send({ type: 'setSourceFrame', slot, id, width: frame.width, height: frame.height, buffer }, [buffer]);
    this.markSourced(slot);
  }

  clearSource(slot: number) {
    this.pending.delete(slot);
    this.inflight.delete(slot);
    this.sourced.delete(slot);
    this.send({ type: 'clearSource', slot });
  }

  /** 该坑位的源帧是否已送进 Worker */
  hasSource(slot: number): boolean {
    return this.sourced.has(slot);
  }

  /** 源帧刚发出去：先前因为没有源帧而压着的渲染请求现在可以紧跟着发了 */
  private markSourced(slot: number) {
    this.sourced.add(slot);
    if (this.pending.has(slot)) this.flush();
  }

  /** 是否有在途渲染（视频逐帧时用来丢帧） */
  isBusy(slot: number): boolean {
    return this.inflight.has(slot);
  }

  /** 该坑位既没有排队也没有在途的渲染，最近一帧就是当前参数的结果 */
  isSettled(slot: number): boolean {
    return !this.pending.has(slot) && !this.inflight.has(slot);
  }

  render(slot: number, params: Params, options?: RenderOptions) {
    this.pending.set(slot, { params, options });
    if (!this.scheduled) {
      this.scheduled = true;
      queueMicrotask(() => {
        this.scheduled = false;
        this.flush();
      });
    }
  }

  /** 渲染一次并等待结果（导出用；调用方需保证该坑位没有别的任务竞争） */
  renderOnce(slot: number, params: Params, options?: RenderOptions): Promise<RenderedFrame> {
    return new Promise((resolve, reject) => {
      const offFrame = this.onFrame((frame) => {
        if (frame.slot !== slot) return;
        offFrame();
        offError();
        resolve(frame);
      });
      const offError = this.onError((s, message) => {
        if (s !== slot && s !== -1) return;
        offFrame();
        offError();
        reject(new Error(message));
      });
      this.render(slot, params, options);
    });
  }

  /** 当前帧的矢量版 SVG：Worker 按全分辨率参数出图，Halftone 是真网点几何，Dither 是合并后的色块 */
  exportSvg(slot: number, params: Params, options?: RenderOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      const jobId = ++this.jobSeq;
      this.svgJobs.set(jobId, { resolve, reject });
      this.send({ type: 'svg', jobId, slot, params, options });
    });
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
    this.pending.clear();
    this.inflight.clear();
    this.sourced.clear();
    for (const job of this.svgJobs.values()) job.reject(new Error('渲染器已关闭'));
    this.svgJobs.clear();
    this.frameListeners.clear();
    this.errorListeners.clear();
  }

  private flush() {
    for (const [slot, job] of this.pending) {
      if (this.inflight.has(slot)) continue;
      // 源帧还没到 Worker：留在队里，等 setSource 之后再发，别让 Worker 回「坑位没有源媒体」
      if (!this.sourced.has(slot)) continue;
      this.pending.delete(slot);
      const jobId = ++this.jobSeq;
      this.inflight.set(slot, jobId);
      this.send({ type: 'render', jobId, slot, params: job.params, options: job.options });
    }
  }

  private handle(msg: WorkerResponse) {
    switch (msg.type) {
      case 'frame': {
        if (this.inflight.get(msg.slot) === msg.jobId) this.inflight.delete(msg.slot);
        const frame: RGBAFrame = { width: msg.width, height: msg.height, data: new Uint8ClampedArray(msg.buffer) };
        const rendered: RenderedFrame = {
          slot: msg.slot,
          frame,
          elapsedMs: msg.elapsedMs,
          recomputed: msg.recomputed,
          scale: msg.scale,
          canvasWidth: msg.canvasWidth,
          canvasHeight: msg.canvasHeight,
          gpu: msg.gpu,
        };
        for (const cb of this.frameListeners) cb(rendered);
        this.flush();
        break;
      }
      case 'svg': {
        const job = this.svgJobs.get(msg.jobId);
        this.svgJobs.delete(msg.jobId);
        job?.resolve(msg.svg);
        break;
      }
      case 'error': {
        // SVG 导出的错误只回给发起它的那个 Promise，不当成渲染错误弹给界面
        const svgJob = msg.jobId !== null ? this.svgJobs.get(msg.jobId) : undefined;
        if (svgJob) {
          this.svgJobs.delete(msg.jobId!);
          svgJob.reject(new Error(msg.message));
          break;
        }
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
