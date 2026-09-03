// 把 build/icon.svg 渲染成 build/icon.png（1024×1024，透明背景）。
// electron-builder 在 macOS 上打包时会自动把 icon.png 转成 .icns。
// 用法：node scripts/gen-icon.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const svg = readFileSync(path.join(root, 'build', 'icon.svg'), 'utf8');
const size = 1024;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`);
const out = path.join(root, 'build', 'icon.png');
await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
await browser.close();
console.log(`已生成 ${path.relative(root, out)}`);
