// 用 void-and-cluster（Ulichney 1993）离线生成 128×128 蓝噪声阈值纹理，
// 量化到 8-bit 后以 base64 写入 frontend/src/engine/dither/bluenoise128.ts。
// 运行：node scripts/gen-bluenoise.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const N = 128;
const TOTAL = N * N;
const SIGMA = 1.5;
const RADIUS = 24;
const SEED = 20260903;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 环绕高斯核
const K = RADIUS * 2 + 1;
const kernel = new Float64Array(K * K);
for (let dy = -RADIUS; dy <= RADIUS; dy++) {
  for (let dx = -RADIUS; dx <= RADIUS; dx++) {
    kernel[(dy + RADIUS) * K + dx + RADIUS] = Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA));
  }
}

function makeEnergy() {
  return new Float64Array(TOTAL);
}

function addPoint(energy, i, sign) {
  const y0 = (i / N) | 0;
  const x0 = i % N;
  for (let dy = -RADIUS; dy <= RADIUS; dy++) {
    const y = (y0 + dy + N) % N;
    const row = y * N;
    const krow = (dy + RADIUS) * K + RADIUS;
    for (let dx = -RADIUS; dx <= RADIUS; dx++) {
      const x = (x0 + dx + N) % N;
      energy[row + x] += sign * kernel[krow + dx];
    }
  }
}

function argExtreme(energy, mask, wantOnes, wantMax) {
  let best = -1;
  let bestV = wantMax ? -Infinity : Infinity;
  for (let i = 0; i < TOTAL; i++) {
    if ((mask[i] === 1) !== wantOnes) continue;
    const v = energy[i];
    if (wantMax ? v > bestV : v < bestV) {
      bestV = v;
      best = i;
    }
  }
  return best;
}

const rand = mulberry32(SEED);
const pattern = new Uint8Array(TOTAL);
const energy = makeEnergy();
let ones = 0;
const initialCount = Math.floor(TOTAL * 0.1);
while (ones < initialCount) {
  const i = Math.floor(rand() * TOTAL);
  if (pattern[i]) continue;
  pattern[i] = 1;
  addPoint(energy, i, 1);
  ones++;
}

// 初始松弛：反复把最紧的簇搬到最大的空洞
for (let iter = 0; iter < TOTAL; iter++) {
  const cluster = argExtreme(energy, pattern, true, true);
  pattern[cluster] = 0;
  addPoint(energy, cluster, -1);
  const voidIdx = argExtreme(energy, pattern, false, false);
  pattern[voidIdx] = 1;
  addPoint(energy, voidIdx, 1);
  if (voidIdx === cluster) break;
}

const rank = new Int32Array(TOTAL).fill(-1);

// 阶段 1：从初始图案逐个移除最紧的簇，秩从 ones-1 递减
{
  const p = pattern.slice();
  const e = energy.slice();
  let r = ones - 1;
  while (r >= 0) {
    const i = argExtreme(e, p, true, true);
    p[i] = 0;
    addPoint(e, i, -1);
    rank[i] = r--;
  }
}

// 阶段 2：从初始图案往最大的空洞加点，直到一半
{
  const p = pattern.slice();
  const e = energy.slice();
  let r = ones;
  let count = ones;
  while (count < TOTAL / 2) {
    const i = argExtreme(e, p, false, false);
    p[i] = 1;
    addPoint(e, i, 1);
    rank[i] = r++;
    count++;
  }
  // 阶段 3：剩余的 0 视为反相图案的 1，逐个移除最紧的簇（即剩余 0 中最密处）
  const zeroEnergy = makeEnergy();
  for (let i = 0; i < TOTAL; i++) if (p[i] === 0) addPoint(zeroEnergy, i, 1);
  while (count < TOTAL) {
    const i = argExtreme(zeroEnergy, p, false, true);
    p[i] = 1;
    addPoint(zeroEnergy, i, -1);
    rank[i] = r++;
    count++;
  }
}

// 校验：秩是 0..TOTAL-1 的排列
const seen = new Uint8Array(TOTAL);
for (let i = 0; i < TOTAL; i++) {
  if (rank[i] < 0 || rank[i] >= TOTAL || seen[rank[i]]) throw new Error(`秩不是排列：index ${i} rank ${rank[i]}`);
  seen[rank[i]] = 1;
}

const bytes = new Uint8Array(TOTAL);
for (let i = 0; i < TOTAL; i++) bytes[i] = rank[i] >> 6;
const b64 = Buffer.from(bytes).toString('base64');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'frontend', 'src', 'engine', 'dither', 'bluenoise128.ts');
const lines = [];
for (let i = 0; i < b64.length; i += 120) lines.push(`  '${b64.slice(i, i + 120)}'`);
writeFileSync(
  out,
  `// 由 scripts/gen-bluenoise.mjs 生成（void-and-cluster，σ=${SIGMA}，seed=${SEED}），请勿手改。
// 128×128 蓝噪声阈值纹理，8-bit 秩，行主序。
export const BLUE_NOISE_SIZE = ${N};

const BASE64 =
${lines.join(' +\n')};

let cache: Uint8Array | null = null;

export function blueNoise128(): Uint8Array {
  if (cache) return cache;
  const bin = atob(BASE64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  cache = out;
  return out;
}
`,
  'utf8',
);
console.log(`已生成 ${path.relative(root, out)}，${bytes.length} 字节`);
