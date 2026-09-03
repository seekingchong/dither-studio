/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 构建目标：electron | web | platform */
  readonly VITE_TARGET?: 'electron' | 'web' | 'platform';
  /** 静态资源 base，与 vite.config 的 base 一致 */
  readonly VITE_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
