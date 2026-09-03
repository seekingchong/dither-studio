// 开发模式：起 Vite dev server（electron 目标）→ 构建 main/preload → 启动 Electron 指向 dev server。
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const electronBinary = require('electron');
const PORT = 5173;
const DEV_URL = `http://127.0.0.1:${PORT}/`;

const children = [];
function run(cmd, args, extraEnv = {}) {
  const child = spawn(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  for (const child of children) if (!child.killed) child.kill();
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function waitFor(url, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // 尚未就绪
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`等待 ${url} 超时`);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
run(npm, ['run', 'dev:electron', '--workspace', 'frontend']);
await waitFor(DEV_URL);

const esbuild = run(process.execPath, ['scripts/build-electron.mjs']);
await new Promise((resolve, reject) => {
  esbuild.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`build-electron 退出码 ${code}`))));
});

const electron = run(electronBinary, ['.'], { VITE_DEV_SERVER_URL: DEV_URL });
electron.on('exit', (code) => shutdown(code ?? 0));
