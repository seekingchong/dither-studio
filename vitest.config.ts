import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// 引擎单测：纯 TypeScript，无 DOM，直接在 node 里跑。
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./frontend/src', import.meta.url)),
    },
  },
  test: {
    include: ['tests/engine/**/*.test.ts'],
    environment: 'node',
  },
});
