import type { Params } from '@/params';

/** 主线程 → Worker */
export type WorkerRequest =
  | { type: 'setSource'; slot: number; id: string; bitmap: ImageBitmap }
  | { type: 'setSourceFrame'; slot: number; id: string; width: number; height: number; buffer: ArrayBuffer }
  | { type: 'clearSource'; slot: number }
  | { type: 'render'; jobId: number; slot: number; params: Params };

/** Worker → 主线程 */
export type WorkerResponse =
  | { type: 'sourceReady'; slot: number; id: string; width: number; height: number }
  | { type: 'frame'; jobId: number; slot: number; width: number; height: number; buffer: ArrayBuffer; elapsedMs: number; recomputed: string[] }
  | { type: 'error'; jobId: number | null; slot: number; message: string };
