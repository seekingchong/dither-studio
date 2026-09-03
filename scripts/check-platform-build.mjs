// 平台构建产物自检：构建 platform 目标 → 用本地静态服务器按平台路径托管 → 无头 Chromium 打开并跑一次真实渲染。
// 验证 base 路径、Worker、字体等相对资源在 /skillforge/apps/dither-studio/static/ 下都能加载。
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const BASE = '/skillforge/apps/dither-studio/static/';
const dist = path.join(root, 'frontend', 'dist');

if (!process.argv.includes('--no-build')) {
  execSync('npm run build:frontend:platform', { cwd: root, stdio: 'inherit' });
}
const html = readFileSync(path.join(dist, 'index.html'), 'utf8');
if (!html.includes(`src="${BASE}assets/`)) throw new Error(`index.html 里的资源路径没有以 ${BASE} 开头`);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (!url.startsWith(BASE)) {
    res.writeHead(404).end('not under platform base');
    return;
  }
  let file = path.join(dist, url.slice(BASE.length) || 'index.html');
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404).end('missing');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const url = `http://127.0.0.1:${port}${BASE}`;
console.log(`静态托管：${url}`);

const { chromium } = require('playwright-core');
const browser = await chromium.launch();
const page = await browser.newPage();
const failures = [];
page.on('requestfailed', (r) => failures.push(r.url()));
page.on('response', (r) => {
  if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`);
});
page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`));
await page.goto(url);
await page.locator('[data-slot="0"]').waitFor({ timeout: 15000 });
const rendered = await page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, '#000');
  g.addColorStop(1, '#fff');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'smoke.png', { type: 'image/png' }));
  const slot = document.querySelector('[data-slot="0"]');
  slot.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  for (let i = 0; i < 100 && slot.getAttribute('data-rendered') !== 'true'; i++) await new Promise((r) => setTimeout(r, 100));
  return slot.getAttribute('data-rendered') === 'true';
});
await browser.close();
server.close();
if (failures.length) {
  console.error('资源加载失败：\n' + failures.join('\n'));
  process.exit(1);
}
if (!rendered) {
  console.error('平台构建产物没有完成渲染');
  process.exit(1);
}
console.log('平台构建自检通过：页面在平台 base 路径下可打开并完成一次渲染');
