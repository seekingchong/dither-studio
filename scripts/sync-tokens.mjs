// 把 design-system/tokens.css 同步到 frontend/src/styles/tokens.css。
// design-system/ 是设计系统原件；frontend/ 需要自包含（二期单独发布），所以保留一份副本。
import { copyFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'design-system', 'tokens.css');
const dst = path.join(root, 'frontend', 'src', 'styles', 'tokens.css');

if (process.argv.includes('--check')) {
  const same = readFileSync(src, 'utf8') === readFileSync(dst, 'utf8');
  if (!same) {
    console.error('frontend/src/styles/tokens.css 与 design-system/tokens.css 不一致，请运行 npm run sync-tokens');
    process.exit(1);
  }
  console.log('tokens.css 已同步');
} else {
  copyFileSync(src, dst);
  console.log(`已复制 ${path.relative(root, src)} → ${path.relative(root, dst)}`);
}
