// 组装 SkillForge 发布目录：release/platform/dither-studio/{manifest.yaml, frontend/}
// 只复制源码（排除 node_modules / dist / 缓存），避免 Electron 产物与文档混进 100MB 的发布包。
// 用法：node scripts/package-platform.mjs [--build]  （--build 会在发布目录里执行 npm install && npm run build:platform 做一次自检）
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'release', 'platform', 'dither-studio');
const build = process.argv.includes('--build');

const EXCLUDE = new Set(['node_modules', 'dist', '.vite', '.turbo', '.cache', 'coverage', '.DS_Store']);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(path.join(root, 'platform', 'manifest.yaml'), path.join(out, 'manifest.yaml'));
cpSync(path.join(root, 'frontend'), path.join(out, 'frontend'), {
  recursive: true,
  filter: (src) => !EXCLUDE.has(path.basename(src)),
});

function dirSize(dir) {
  let total = 0;
  for (const entry of readdir(dir)) total += entry;
  return total;
  function* readdir(d) {
    for (const name of require('node:fs').readdirSync(d)) {
      const p = path.join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) yield* readdir(p);
      else yield st.size;
    }
  }
}
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const mb = (dirSize(out) / 1024 / 1024).toFixed(2);
console.log(`已组装 ${path.relative(root, out)}（${mb} MB，不含 node_modules）`);

if (build) {
  const fe = path.join(out, 'frontend');
  console.log('在发布目录里执行 npm install && npm run build:platform …');
  execSync('npm install --no-audit --no-fund', { cwd: fe, stdio: 'inherit' });
  execSync('npm run build:platform', { cwd: fe, stdio: 'inherit' });
  if (!existsSync(path.join(fe, 'dist', 'index.html'))) throw new Error('frontend/dist/index.html 未产出');
  console.log('平台构建自检通过：frontend/dist 已产出');
}
console.log('下一步：在你的 SkillForge 发布技能里指向该目录执行发布（一期不发布）。');
