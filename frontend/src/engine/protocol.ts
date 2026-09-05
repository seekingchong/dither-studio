import type { Params } from '@/params';

export interface RenderOptions {
  /** 预览降分辨率倍率（1 = 全分辨率；0.5 / 0.25 用于慢算法的视频预览） */
  previewScale?: number;
  /** 允许走 WebGL 路径 */
  gpu?: boolean;
}

/** 主线程 → Worker */
export type WorkerRequest =
  | { type: 'setSource'; slot: number; id: string; bitmap: ImageBitmap }
  | { type: 'setSourceFrame'; slot: number; id: string; width: number; height: number; buffer: ArrayBuffer }
  | { type: 'clearSource'; slot: number }
  | { type: 'render'; jobId: number; slot: number; params: Params; options?: RenderOptions }
  /** 当前帧的矢量版：抖动出实色块合并的 path，排线出真正的笔画 */
  | { type: 'svg'; jobId: number; slot: number; params: Params; options?: RenderOptions };

/** Worker → 主线程 */
export type WorkerResponse =
  | { type: 'sourceReady'; slot: number; id: string; width: number; height: number }
  | {
      type: 'frame';
      jobId: number;
      slot: number;
      width: number;
      height: number;
      buffer: ArrayBuffer;
      elapsedMs: number;
      recomputed: string[];
      /** 本帧相对画布尺寸的比例（预览降分辨率时 < 1） */
      scale: number;
      /** 画布逻辑尺寸 */
      canvasWidth: number;
      canvasHeight: number;
      gpu: boolean;
    }
  | { type: 'svg'; jobId: number; slot: number; svg: string }
  | { type: 'error'; jobId: number | null; slot: number; message: string };
