import { describe, expect, it } from 'vitest';
import { RenderClient } from '@/engine/client';
import type { WorkerRequest, WorkerResponse } from '@/engine/protocol';
import { defaultParams } from '@/params';

/** 假 Worker：记录收到的消息，测试里手动回消息 */
class FakeWorker {
  sent: WorkerRequest[] = [];
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  postMessage(msg: WorkerRequest) {
    this.sent.push(msg);
  }
  terminate() {}
  reply(msg: WorkerResponse) {
    this.onmessage?.({ data: msg } as MessageEvent<WorkerResponse>);
  }
}

const flush = () => new Promise<void>((r) => queueMicrotask(r));
const fakeBitmap = () => ({ width: 1, height: 1, close() {} }) as unknown as ImageBitmap;

describe('RenderClient 调度', () => {
  it('源帧送到 Worker 之前不发渲染请求；源帧一到立刻跟着发', async () => {
    const worker = new FakeWorker();
    const client = new RenderClient(worker as unknown as Worker);
    const errors: string[] = [];
    client.onError((_slot, message) => errors.push(message));

    // 载入媒体时参数 effect 先于 setSource 请求渲染：这条请求要压着，不能先于源帧到 Worker
    client.render(0, defaultParams());
    await flush();
    expect(worker.sent.map((m) => m.type)).toEqual([]);
    expect(client.hasSource(0)).toBe(false);

    client.setSource(0, 'a', fakeBitmap());
    await flush();
    expect(worker.sent.map((m) => m.type)).toEqual(['setSource', 'render']);
    expect(client.hasSource(0)).toBe(true);
    expect(errors).toEqual([]);
  });

  it('每个坑位最多一个在途任务，期间的参数只保留最新一份', async () => {
    const worker = new FakeWorker();
    const client = new RenderClient(worker as unknown as Worker);
    client.setSource(0, 'a', fakeBitmap());
    const p1 = { ...defaultParams(), 'pixel.size': 2 };
    const p2 = { ...defaultParams(), 'pixel.size': 3 };
    const p3 = { ...defaultParams(), 'pixel.size': 4 };
    client.render(0, p1);
    await flush();
    client.render(0, p2);
    client.render(0, p3);
    await flush();
    const renders = () => worker.sent.filter((m) => m.type === 'render') as Array<Extract<WorkerRequest, { type: 'render' }>>;
    expect(renders()).toHaveLength(1);
    expect(client.isBusy(0)).toBe(true);
    expect(client.isSettled(0)).toBe(false);

    worker.reply({ type: 'frame', jobId: renders()[0].jobId, slot: 0, width: 1, height: 1, buffer: new ArrayBuffer(4), elapsedMs: 1, recomputed: [], scale: 1, canvasWidth: 1, canvasHeight: 1, gpu: false });
    expect(renders()).toHaveLength(2);
    expect(renders()[1].params['pixel.size']).toBe(4);
  });

  it('clearSource 之后压着的请求作废，再来源帧才会重新发', async () => {
    const worker = new FakeWorker();
    const client = new RenderClient(worker as unknown as Worker);
    client.render(1, defaultParams());
    client.clearSource(1);
    client.setSource(1, 'b', fakeBitmap());
    await flush();
    expect(worker.sent.map((m) => m.type)).toEqual(['clearSource', 'setSource']);
  });
});
