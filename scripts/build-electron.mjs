// 用 esbuild 把 electron/main.ts 与 electron/preload.ts 打成 CJS 单文件，输出到 electron/dist/。
import { build, context } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
  absWorkingDir: root,
};

const entries = [
  { entryPoints: ['electron/main.ts'], outfile: 'electron/dist/main.cjs' },
  { entryPoints: ['electron/preload.ts'], outfile: 'electron/dist/preload.cjs' },
];

if (watch) {
  const contexts = await Promise.all(entries.map((e) => context({ ...common, ...e })));
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('[electron] 监听 main.ts / preload.ts 变更…');
} else {
  await Promise.all(entries.map((e) => build({ ...common, ...e })));
}
