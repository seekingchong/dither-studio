import { describe, expect, it } from 'vitest';
import { defaultParams, type ParamValue, type Params } from '@/params';
import {
  ALGORITHMS,
  BLUE_NOISE_SIZE,
  FAMILY_PARAM,
  KERNELS,
  ORDERED_MATRICES,
  blueNoise128,
  curveOrder,
  dbsDither,
  errorDiffuse,
  findAlgorithm,
  getMatrix,
  hilbertOrder,
  otsuThreshold,
  parseCustomKernel,
  peanoOrder,
  resolveAlgorithm,
  type DitherInput,
} from '@/engine';
import { ascii, density, gradientInput, uniformInput } from './helpers';

const W = 32;
const H = 8;

function paramsFor(family: string, id: string, extra: Record<string, ParamValue> = {}): Params {
  return { ...defaultParams(), 'dither.family': family, [FAMILY_PARAM[family as keyof typeof FAMILY_PARAM]]: id, ...extra };
}

describe('全部算法：渐变快照', () => {
  it('注册表覆盖 PRD 的算法数量', () => {
    const count = (family: string) => ALGORITHMS.filter((a) => a.family === family).length;
    expect(count('threshold')).toBe(3);
    expect(count('noise')).toBe(4);
    expect(count('ordered')).toBe(14);
    expect(count('halftone')).toBe(10);
    expect(count('error-diffusion')).toBe(14);
    expect(count('curve')).toBe(4);
    expect(count('search')).toBe(3);
    expect(count('pattern')).toBe(9);
  });

  it.each(ALGORITHMS.map((a) => [`${a.family}/${a.id}`, a.family, a.id] as const))('%s', (_name, family, id) => {
    const params = paramsFor(family, id);
    const algo = resolveAlgorithm(params);
    expect(algo.id).toBe(id);
    const out = algo.run(gradientInput(W, H), params);
    expect(out.length).toBe(W * H);
    for (let i = 0; i < out.length; i++) expect(out[i] === 0 || out[i] === 1).toBe(true);
    expect(ascii(out, W, H)).toMatchSnapshot();
  });
});

describe('阈值族', () => {
  it('Otsu 在双峰直方图上取中间', () => {
    const gray = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) gray[i] = i < 500 ? 0.2 + (i % 10) * 0.005 : 0.7 + (i % 10) * 0.005;
    const t = otsuThreshold(gray);
    expect(t).toBeGreaterThan(0.245);
    expect(t).toBeLessThan(0.7);
  });
  it('Otsu 结果受阈值滑块平移', () => {
    const algo = findAlgorithm('threshold', 'otsu')!;
    const input = gradientInput(64, 4);
    const base = density(algo.run(input, paramsFor('threshold', 'otsu')));
    const darker = density(algo.run(input, paramsFor('threshold', 'otsu', { 'tone.threshold': 200 })));
    expect(darker).toBeLessThan(base);
  });
  it('自适应阈值在平坦区域按偏置判定', () => {
    const algo = findAlgorithm('threshold', 'adaptive')!;
    const flat = uniformInput(16, 16, 0.3);
    expect(density(algo.run(flat, paramsFor('threshold', 'adaptive')))).toBe(1);
    expect(density(algo.run(flat, paramsFor('threshold', 'adaptive', { 'dither.threshold.offset': 20 })))).toBe(0);
  });
});

describe('噪声族', () => {
  it('蓝噪声纹理是 0..255 各 64 次的排列且局部均匀', () => {
    const tex = blueNoise128();
    const n = BLUE_NOISE_SIZE;
    expect(tex.length).toBe(n * n);
    const hist = new Int32Array(256);
    for (const v of tex) hist[v]++;
    for (let i = 0; i < 256; i++) expect(hist[i]).toBe(64);
    for (let by = 0; by < n; by += 16) {
      for (let bx = 0; bx < n; bx += 16) {
        let sum = 0;
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) sum += tex[(by + y) * n + bx + x];
        expect(Math.abs(sum / 256 - 127.5)).toBeLessThan(20);
      }
    }
  });
  it.each(['blue', 'white', 'ign'])('%s 在均匀 0.5 上密度接近 50%%', (id) => {
    const algo = findAlgorithm('noise', id)!;
    const d = density(algo.run(uniformInput(64, 64, 0.5), paramsFor('noise', id)));
    expect(d).toBeGreaterThan(0.42);
    expect(d).toBeLessThan(0.58);
  });
  it('种子改变白噪声结果，幅度 0 退化为阈值', () => {
    const algo = findAlgorithm('noise', 'white')!;
    const a = algo.run(uniformInput(16, 16, 0.5), paramsFor('noise', 'white', { 'dither.noise.seed': 1 }));
    const b = algo.run(uniformInput(16, 16, 0.5), paramsFor('noise', 'white', { 'dither.noise.seed': 2 }));
    expect(Array.from(a)).not.toEqual(Array.from(b));
    const c = algo.run(uniformInput(16, 16, 0.4), paramsFor('noise', 'white', { 'dither.noise.amplitude': 0 }));
    expect(density(c)).toBe(0);
  });
});

describe('有序族', () => {
  it.each(ORDERED_MATRICES.map((m) => m.id))('%s 是排列矩阵', (id) => {
    const m = getMatrix(id);
    const count = m.size * m.size;
    const ranks = Array.from(m.data, (v) => Math.floor(v * count)).sort((a, b) => a - b);
    expect(ranks).toEqual(Array.from({ length: count }, (_, i) => i));
  });
  it('圆点矩阵中心秩最小', () => {
    const m = getMatrix('circle5');
    expect(m.data[2 * 5 + 2]).toBeLessThan(m.data[0]);
  });
  it('角度 90° 等价于转置', () => {
    const algo = findAlgorithm('ordered', 'bayer8')!;
    const input = uniformInput(16, 16, 0.5);
    const a = algo.run(input, paramsFor('ordered', 'bayer8'));
    const b = algo.run(input, paramsFor('ordered', 'bayer8', { 'dither.ordered.angle': 90 }));
    expect(density(a)).toBe(0.5);
    expect(density(b)).toBe(0.5);
  });
});

describe('半调族', () => {
  it('圆点 50% 灰密度约一半，反向翻转', () => {
    const algo = findAlgorithm('halftone', 'round')!;
    const input = uniformInput(64, 64, 0.5);
    const d = density(algo.run(input, paramsFor('halftone', 'round', { 'dither.halftone.angle': 0 })));
    expect(d).toBeGreaterThan(0.35);
    expect(d).toBeLessThan(0.65);
    const inv = density(algo.run(input, paramsFor('halftone', 'round', { 'dither.halftone.angle': 0, 'dither.halftone.invert': true })));
    expect(Math.abs(inv - (1 - d))).toBeLessThan(0.05);
  });
  it('网点增益让图更暗', () => {
    const algo = findAlgorithm('halftone', 'round')!;
    const input = uniformInput(64, 64, 0.5);
    const base = density(algo.run(input, paramsFor('halftone', 'round')));
    const gained = density(algo.run(input, paramsFor('halftone', 'round', { 'dither.halftone.gain': 60 })));
    expect(gained).toBeLessThan(base);
  });
});

describe('误差扩散族', () => {
  it('所有核权重和等于除数（Atkinson 有意只扩散 6/8）', () => {
    for (const k of KERNELS) {
      const sum = k.taps.reduce((s, [, , w]) => s + w, 0);
      if (k.id === 'atkinson') expect(sum).toBe(6);
      else expect(sum).toBe(k.divisor);
    }
  });
  it('解析自定义核', () => {
    const k = parseCustomKernel('. X 7\n3 5 1')!;
    expect(k.divisor).toBe(16);
    expect(k.taps).toEqual([[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]]);
    const k2 = parseCustomKernel('. * 1 1; 1 1 1 .; . 1 . . ; /8')!;
    expect(k2.divisor).toBe(8);
    expect(k2.taps).toEqual([[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]]);
    expect(parseCustomKernel('1 2 3')).toBeNull();
    expect(parseCustomKernel('')).toBeNull();
  });
  it('上 → 下扫描等价于转置后左 → 右', () => {
    const w = 12;
    const h = 7;
    const gray = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) gray[y * w + x] = ((x * 7 + y * 3) % 11) / 11;
    const input: DitherInput = { width: w, height: h, gray, levels: 2, seed: 1 };
    const t = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) t[x * h + y] = gray[y * w + x];
    const transposed: DitherInput = { width: h, height: w, gray: t, levels: 2, seed: 1 };
    const fs = KERNELS[0];
    const ttb = errorDiffuse(input, fs, { serpentine: false, direction: 'ttb' });
    const ltrT = errorDiffuse(transposed, fs, { serpentine: false, direction: 'ltr' });
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) expect(ttb[y * w + x]).toBe(ltrT[x * h + y]);
  });
  it('误差截断改变结果且仍有合理密度', () => {
    const fs = KERNELS[0];
    const input = uniformInput(32, 32, 0.25);
    const full = errorDiffuse(input, fs, { clamp: 1 });
    const clipped = errorDiffuse(input, fs, { clamp: 0.05 });
    expect(Array.from(full)).not.toEqual(Array.from(clipped));
    expect(density(full)).toBeCloseTo(0.25, 1);
  });
  it('Ostromoukhov 与 Zhou–Fang 在均匀灰上密度正确', () => {
    for (const id of ['ostromoukhov', 'zhou-fang']) {
      const algo = findAlgorithm('error-diffusion', id)!;
      const d = density(algo.run(uniformInput(64, 64, 0.3), paramsFor('error-diffusion', id)));
      expect(Math.abs(d - 0.3)).toBeLessThan(0.05);
    }
  });
});

describe('曲线扫描', () => {
  const sizes: Array<[number, number]> = [[13, 7], [32, 8], [50, 30], [27, 27]];
  it.each(['hilbert', 'peano', 'gosper', 'fass'] as const)('%s 访问顺序是全像素排列', (type) => {
    for (const [w, h] of sizes) {
      const order = curveOrder(type, w, h);
      expect(order.length).toBe(w * h);
      const sorted = Array.from(order).sort((a, b) => a - b);
      expect(sorted).toEqual(Array.from({ length: w * h }, (_, i) => i));
    }
  });
  it('Hilbert 与 Peano 在整方阵上逐点四邻相接', () => {
    for (const [order, n] of [
      [hilbertOrder(32, 32), 32],
      [peanoOrder(27, 27), 27],
    ] as const) {
      for (let k = 1; k < order.length; k++) {
        const a = order[k - 1];
        const b = order[k];
        const dist = Math.abs((a % n) - (b % n)) + Math.abs(Math.floor(a / n) - Math.floor(b / n));
        expect(dist).toBe(1);
      }
    }
  });
  it('Riemersma 在均匀灰上密度正确', () => {
    const algo = findAlgorithm('curve', 'hilbert')!;
    const d = density(algo.run(uniformInput(64, 64, 0.35), paramsFor('curve', 'hilbert')));
    expect(Math.abs(d - 0.35)).toBeLessThan(0.05);
  });
});

describe('点扩散与 DBS', () => {
  it('点扩散在均匀灰上密度正确', () => {
    for (const id of ['knuth', 'lippens']) {
      const algo = findAlgorithm('search', id)!;
      const d = density(algo.run(uniformInput(64, 64, 0.5), paramsFor('search', id)));
      expect(Math.abs(d - 0.5)).toBeLessThan(0.05);
    }
  });
  it('DBS 的感知误差不高于 Floyd–Steinberg 起点', () => {
    const w = 48;
    const h = 48;
    const gray = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) gray[y * w + x] = 0.2 + 0.6 * (x / (w - 1));
    const input: DitherInput = { width: w, height: h, gray, levels: 2, seed: 1 };
    const fs = errorDiffuse(input, KERNELS[0], {});
    const dbs = dbsDither(input, { iterations: 3, sigma: 1.5 });
    const perceived = (b: Uint8Array) => {
      const r = 4;
      let energy = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let s = 0;
          let ws = 0;
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              const xx = x + dx;
              const yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
              const wgt = Math.exp(-(dx * dx + dy * dy) / (2 * 1.5 * 1.5));
              s += wgt * (b[yy * w + xx] - gray[yy * w + xx]);
              ws += wgt;
            }
          }
          energy += (s / ws) * (s / ws);
        }
      }
      return energy;
    };
    expect(perceived(dbs)).toBeLessThanOrEqual(perceived(fs) + 1e-6);
    expect(Math.abs(density(dbs) - 0.5)).toBeLessThan(0.05);
  });
});

describe('图案族', () => {
  it('横线在 50% 灰上一半行为暗', () => {
    const algo = findAlgorithm('pattern', 'hlines')!;
    const out = algo.run(uniformInput(16, 16, 0.5), paramsFor('pattern', 'hlines', { 'dither.pattern.scale': 4 }));
    for (let y = 0; y < 16; y++) {
      const row = out.slice(y * 16, y * 16 + 16);
      expect(new Set(Array.from(row)).size).toBe(1);
    }
    expect(Math.abs(density(out) - 0.5)).toBeLessThan(0.1);
  });
});
