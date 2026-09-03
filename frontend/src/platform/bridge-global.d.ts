import type { DitherBridge } from './bridge';

declare global {
  interface Window {
    ditherStudio?: DitherBridge;
  }
}

export {};
