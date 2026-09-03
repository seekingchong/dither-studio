import { blueNoise128, BLUE_NOISE_SIZE } from '../dither/bluenoise128';
import type { RGBAFrame } from '../types';
import { hash2, mulberry32 } from '../util/random';
import type { EffectDef, EffectParamValues } from './types';

const n = (p: EffectParamValues, id: string, fallback: number) => (typeof p[id] === 'number' ? (p[id] as number) : fallback);
const s = (p: EffectParamValues, id: string, fallback: string) => (typeof p[id] === 'string' ? (p[id] as string) : fallback);
const b = (p: EffectParamValues, id: string, fallback: boolean) => (typeof p[id] === 'boolean' ? (p[id] as boolean) : fallback);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const luma = (r: number, g: number, gb: number) => 0.2126 * r + 0.7152 * g + 0.0722 * gb;

function copy(frame: RGBAFrame): RGBAFrame {
  return { width: frame.width, height: frame.height, data: new Uint8ClampedArray(frame.data) };
}

/** 双线性采样（越界夹到边缘） */
function sampleBilinear(src: Uint8ClampedArray, width: number, height: number, fx: number, fy: number, out: Uint8ClampedArray, o: number) {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const xa = clamp(x0, 0, width - 1);
  const xb = clamp(x0 + 1, 0, width - 1);
  const ya = clamp(y0, 0, height - 1);
  const yb = clamp(y0 + 1, 0, height - 1);
  const p00 = (ya * width + xa) * 4;
  const p10 = (ya * width + xb) * 4;
  const p01 = (yb * width + xa) * 4;
  const p11 = (yb * width + xb) * 4;
  for (let c = 0; c < 3; c++) {
    const top = src[p00 + c] + (src[p10 + c] - src[p00 + c]) * tx;
    const bottom = src[p01 + c] + (src[p11 + c] - src[p01 + c]) * tx;
    out[o + c] = top + (bottom - top) * ty;
  }
  out[o + 3] = 255;
}

/** 按位移场重采样：mapping 返回源坐标 */
function remap(frame: RGBAFrame, mapping: (x: number, y: number) => [number, number], nearest = false): RGBAFrame {
  const { width, height, data } = frame;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [sx, sy] = mapping(x, y);
      const o = (y * width + x) * 4;
      if (nearest) {
        const xi = clamp(Math.round(sx), 0, width - 1);
        const yi = clamp(Math.round(sy), 0, height - 1);
        const p = (yi * width + xi) * 4;
        out[o] = data[p];
        out[o + 1] = data[p + 1];
        out[o + 2] = data[p + 2];
        out[o + 3] = 255;
      } else {
        sampleBilinear(data, width, height, sx, sy, out, o);
      }
    }
  }
  return { width, height, data: out };
}

// ---------- 扫描线 / CRT ----------

const scanlines: EffectDef = {
  id: 'scanlines',
  label: '扫描线 / CRT',
  hint: '横向暗线，可叠荧光三色条纹与屏幕曲率',
  params: [
    { id: 'period', label: '线间距', type: 'number', min: 2, max: 12, step: 1, default: 3, unit: 'px' },
    { id: 'darkness', label: '暗线强度', type: 'number', min: 0, max: 100, step: 1, default: 40, unit: '%' },
    { id: 'phosphor', label: '荧光点', type: 'number', min: 0, max: 100, step: 1, default: 0, unit: '%' },
    { id: 'curvature', label: '屏幕曲率', type: 'number', min: 0, max: 100, step: 1, default: 0, unit: '%' },
  ],
  apply(frame, p) {
    const period = Math.max(2, Math.round(n(p, 'period', 3)));
    const darkness = n(p, 'darkness', 40) / 100;
    const phosphor = n(p, 'phosphor', 0) / 100;
    const curvature = n(p, 'curvature', 0) / 100;
    let src = frame;
    if (curvature > 0) src = barrelDistort(frame, curvature * 0.35);
    const out = copy(src);
    const { width, height, data } = out;
    for (let y = 0; y < height; y++) {
      const line = y % period === period - 1 ? 1 - darkness : 1;
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        let r = data[o] * line;
        let g = data[o + 1] * line;
        let bl = data[o + 2] * line;
        if (phosphor > 0) {
          const k = x % 3;
          const keep = 1;
          const dim = 1 - phosphor * 0.6;
          r *= k === 0 ? keep : dim;
          g *= k === 1 ? keep : dim;
          bl *= k === 2 ? keep : dim;
        }
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = bl;
      }
    }
    return out;
  },
};

// ---------- 胶片颗粒 ----------

const grain: EffectDef = {
  id: 'grain',
  label: '胶片颗粒',
  params: [
    { id: 'amount', label: '强度', type: 'number', min: 0, max: 100, step: 1, default: 30, unit: '%' },
    { id: 'size', label: '颗粒大小', type: 'number', min: 1, max: 6, step: 1, default: 1, unit: 'px' },
    { id: 'color', label: '彩色颗粒', type: 'boolean', default: false },
    { id: 'seed', label: '种子', type: 'number', min: 0, max: 9999, step: 1, default: 1 },
  ],
  apply(frame, p) {
    const amount = (n(p, 'amount', 30) / 100) * 96;
    const size = Math.max(1, Math.round(n(p, 'size', 1)));
    const colored = b(p, 'color', false);
    const seed = Math.round(n(p, 'seed', 1));
    const out = copy(frame);
    const { width, height, data } = out;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const gx = Math.floor(x / size);
        const gy = Math.floor(y / size);
        const o = (y * width + x) * 4;
        // Box–Muller 高斯颗粒
        const u1 = Math.max(1e-6, hash2(gx, gy, seed));
        const u2 = hash2(gx, gy, seed + 101);
        const g0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * amount * 0.5;
        if (colored) {
          const g1 = Math.sqrt(-2 * Math.log(Math.max(1e-6, hash2(gx, gy, seed + 202)))) * Math.cos(2 * Math.PI * hash2(gx, gy, seed + 303)) * amount * 0.5;
          const g2 = Math.sqrt(-2 * Math.log(Math.max(1e-6, hash2(gx, gy, seed + 404)))) * Math.cos(2 * Math.PI * hash2(gx, gy, seed + 505)) * amount * 0.5;
          data[o] += g0;
          data[o + 1] += g1;
          data[o + 2] += g2;
        } else {
          data[o] += g0;
          data[o + 1] += g0;
          data[o + 2] += g0;
        }
      }
    }
    return out;
  },
};

// ---------- JPEG / 数据损坏 glitch ----------

const jpeg: EffectDef = {
  id: 'jpeg',
  label: 'JPEG 损坏',
  hint: '随机宏块被前一块内容覆盖并偏色，模拟压缩数据损坏',
  params: [
    { id: 'block', label: '块大小', type: 'number', min: 4, max: 32, step: 4, default: 8, unit: 'px' },
    { id: 'amount', label: '损坏比例', type: 'number', min: 0, max: 100, step: 1, default: 15, unit: '%' },
    { id: 'shift', label: '偏色', type: 'number', min: 0, max: 100, step: 1, default: 50, unit: '%' },
    { id: 'seed', label: '种子', type: 'number', min: 0, max: 9999, step: 1, default: 1 },
  ],
  apply(frame, p) {
    const block = Math.max(4, Math.round(n(p, 'block', 8)));
    const amount = n(p, 'amount', 15) / 100;
    const shift = n(p, 'shift', 50) / 100;
    const seed = Math.round(n(p, 'seed', 1));
    const out = copy(frame);
    const { width, height, data } = out;
    const src = frame.data;
    const bw = Math.ceil(width / block);
    const bh = Math.ceil(height / block);
    const rand = mulberry32(seed);
    for (let by = 0; by < bh; by++) {
      let run = 0;
      for (let bx = 0; bx < bw; bx++) {
        if (run === 0 && rand() < amount * 0.3) run = 1 + Math.floor(rand() * 6);
        if (run === 0) continue;
        run--;
        // 用左侧若干块之前的内容覆盖当前块，并加固定偏色
        const srcBx = Math.max(0, bx - 1 - Math.floor(rand() * 3));
        const dr = (rand() - 0.5) * 2 * 120 * shift;
        const dg = (rand() - 0.5) * 2 * 120 * shift;
        const db = (rand() - 0.5) * 2 * 120 * shift;
        const q = 1 + Math.floor(rand() * 3) * 16; // 色阶量化
        for (let y = by * block; y < Math.min(height, (by + 1) * block); y++) {
          for (let x = bx * block; x < Math.min(width, (bx + 1) * block); x++) {
            const sx = Math.min(width - 1, srcBx * block + (x - bx * block));
            const si = (y * width + sx) * 4;
            const o = (y * width + x) * 4;
            data[o] = Math.round((src[si] + dr) / q) * q;
            data[o + 1] = Math.round((src[si + 1] + dg) / q) * q;
            data[o + 2] = Math.round((src[si + 2] + db) / q) * q;
          }
        }
      }
    }
    return out;
  },
};

// ---------- 块位移 ----------

const blockShift: EffectDef = {
  id: 'blockShift',
  label: '块位移',
  params: [
    { id: 'count', label: '块数', type: 'number', min: 1, max: 40, step: 1, default: 8 },
    { id: 'maxShift', label: '最大位移', type: 'number', min: 1, max: 200, step: 1, default: 40, unit: 'px' },
    { id: 'height', label: '块高度', type: 'number', min: 2, max: 200, step: 1, default: 24, unit: 'px' },
    { id: 'seed', label: '种子', type: 'number', min: 0, max: 9999, step: 1, default: 1 },
  ],
  apply(frame, p) {
    const count = Math.round(n(p, 'count', 8));
    const maxShift = n(p, 'maxShift', 40);
    const bh = Math.max(2, Math.round(n(p, 'height', 24)));
    const rand = mulberry32(Math.round(n(p, 'seed', 1)));
    const out = copy(frame);
    const { width, height, data } = out;
    const src = frame.data;
    for (let k = 0; k < count; k++) {
      const y0 = Math.floor(rand() * height);
      const h = Math.max(1, Math.round(bh * (0.5 + rand())));
      const x0 = Math.floor(rand() * width);
      const w = Math.max(8, Math.floor(rand() * width * 0.6));
      const dx = Math.round((rand() - 0.5) * 2 * maxShift);
      for (let y = y0; y < Math.min(height, y0 + h); y++) {
        for (let x = x0; x < Math.min(width, x0 + w); x++) {
          const sx = (((x - dx) % width) + width) % width;
          const si = (y * width + sx) * 4;
          const o = (y * width + x) * 4;
          data[o] = src[si];
          data[o + 1] = src[si + 1];
          data[o + 2] = src[si + 2];
        }
      }
    }
    return out;
  },
};

// ---------- 扫描行位移 ----------

const rowShift: EffectDef = {
  id: 'rowShift',
  label: '扫描行位移',
  params: [
    { id: 'probability', label: '行比例', type: 'number', min: 0, max: 100, step: 1, default: 10, unit: '%' },
    { id: 'maxShift', label: '最大位移', type: 'number', min: 1, max: 200, step: 1, default: 30, unit: 'px' },
    { id: 'band', label: '带高度', type: 'number', min: 1, max: 40, step: 1, default: 3, unit: 'px' },
    { id: 'rgbSplit', label: 'RGB 分离', type: 'number', min: 0, max: 40, step: 1, default: 0, unit: 'px' },
    { id: 'seed', label: '种子', type: 'number', min: 0, max: 9999, step: 1, default: 1 },
  ],
  apply(frame, p) {
    const prob = n(p, 'probability', 10) / 100;
    const maxShift = n(p, 'maxShift', 30);
    const band = Math.max(1, Math.round(n(p, 'band', 3)));
    const split = Math.round(n(p, 'rgbSplit', 0));
    const rand = mulberry32(Math.round(n(p, 'seed', 1)));
    const out = copy(frame);
    const { width, height, data } = out;
    const src = frame.data;
    for (let y0 = 0; y0 < height; y0 += band) {
      if (rand() >= prob) continue;
      const dx = Math.round((rand() - 0.5) * 2 * maxShift);
      for (let y = y0; y < Math.min(height, y0 + band); y++) {
        for (let x = 0; x < width; x++) {
          const o = (y * width + x) * 4;
          const sxr = (((x - dx - split) % width) + width) % width;
          const sxg = (((x - dx) % width) + width) % width;
          const sxb = (((x - dx + split) % width) + width) % width;
          data[o] = src[(y * width + sxr) * 4];
          data[o + 1] = src[(y * width + sxg) * 4 + 1];
          data[o + 2] = src[(y * width + sxb) * 4 + 2];
        }
      }
    }
    return out;
  },
};

// ---------- 像素排序 ----------

const pixelSort: EffectDef = {
  id: 'pixelSort',
  label: '像素排序',
  hint: '亮度落在区间内的连续像素按亮度排序（Asendorf 风格）',
  params: [
    {
      id: 'direction',
      label: '方向',
      type: 'select',
      default: 'row',
      options: [
        { value: 'row', label: '横向' },
        { value: 'col', label: '纵向' },
      ],
    },
    { id: 'low', label: '亮度下限', type: 'number', min: 0, max: 100, step: 1, default: 20, unit: '%' },
    { id: 'high', label: '亮度上限', type: 'number', min: 0, max: 100, step: 1, default: 80, unit: '%' },
    { id: 'reverse', label: '降序', type: 'boolean', default: false },
  ],
  apply(frame, p) {
    const vertical = s(p, 'direction', 'row') === 'col';
    const lo = (n(p, 'low', 20) / 100) * 255;
    const hi = (n(p, 'high', 80) / 100) * 255;
    const reverse = b(p, 'reverse', false);
    const out = copy(frame);
    const { width, height, data } = out;
    const lines = vertical ? width : height;
    const len = vertical ? height : width;
    const idx = (line: number, k: number) => (vertical ? (k * width + line) * 4 : (line * width + k) * 4);
    const lum = new Float32Array(len);
    const order: number[] = [];
    const tmp = new Uint8ClampedArray(len * 4);
    for (let line = 0; line < lines; line++) {
      for (let k = 0; k < len; k++) {
        const i = idx(line, k);
        lum[k] = luma(data[i], data[i + 1], data[i + 2]);
      }
      let k = 0;
      while (k < len) {
        if (lum[k] < lo || lum[k] > hi) {
          k++;
          continue;
        }
        let end = k;
        while (end < len && lum[end] >= lo && lum[end] <= hi) end++;
        if (end - k > 1) {
          order.length = 0;
          for (let t = k; t < end; t++) order.push(t);
          order.sort((a2, b2) => (reverse ? lum[b2] - lum[a2] : lum[a2] - lum[b2]));
          for (let t = 0; t < order.length; t++) {
            const i = idx(line, order[t]);
            tmp[t * 4] = data[i];
            tmp[t * 4 + 1] = data[i + 1];
            tmp[t * 4 + 2] = data[i + 2];
          }
          for (let t = 0; t < order.length; t++) {
            const i = idx(line, k + t);
            data[i] = tmp[t * 4];
            data[i + 1] = tmp[t * 4 + 1];
            data[i + 2] = tmp[t * 4 + 2];
          }
        }
        k = end;
      }
    }
    return out;
  },
};

// ---------- 波形 ----------

const wave: EffectDef = {
  id: 'wave',
  label: '波形',
  params: [
    { id: 'amplitude', label: '振幅', type: 'number', min: 0, max: 100, step: 1, default: 12, unit: 'px' },
    { id: 'wavelength', label: '波长', type: 'number', min: 8, max: 600, step: 1, default: 120, unit: 'px' },
    { id: 'phase', label: '相位', type: 'number', min: 0, max: 360, step: 1, default: 0, unit: '°' },
    {
      id: 'axis',
      label: '方向',
      type: 'select',
      default: 'x',
      options: [
        { value: 'x', label: '横向摆动' },
        { value: 'y', label: '纵向摆动' },
      ],
    },
  ],
  apply(frame, p) {
    const amp = n(p, 'amplitude', 12);
    const wl = Math.max(1, n(p, 'wavelength', 120));
    const phase = (n(p, 'phase', 0) * Math.PI) / 180;
    const axisX = s(p, 'axis', 'x') === 'x';
    return remap(frame, (x, y) =>
      axisX ? [x + Math.sin((y / wl) * 2 * Math.PI + phase) * amp, y] : [x, y + Math.sin((x / wl) * 2 * Math.PI + phase) * amp],
    );
  },
};

// ---------- 桶形畸变 ----------

/**
 * k > 0 桶形（边缘外凸，采样半径比输出半径小），k < 0 枕形；基于归一化半径的二次畸变。
 * 桶形时四角采样落在图内，不会拉出边缘条纹。
 */
export function barrelDistort(frame: RGBAFrame, k: number): RGBAFrame {
  const { width, height } = frame;
  const cx = width / 2;
  const cy = height / 2;
  const rmax = Math.hypot(cx, cy);
  return remap(frame, (x, y) => {
    const dx = (x + 0.5 - cx) / rmax;
    const dy = (y + 0.5 - cy) / rmax;
    const r2 = dx * dx + dy * dy;
    const f = 1 - k * r2;
    return [cx + dx * f * rmax - 0.5, cy + dy * f * rmax - 0.5];
  });
}

const barrel: EffectDef = {
  id: 'barrel',
  label: '桶形畸变',
  params: [{ id: 'amount', label: '强度', type: 'number', min: -100, max: 100, step: 1, default: 30, unit: '%' }],
  apply(frame, p) {
    return barrelDistort(frame, (n(p, 'amount', 30) / 100) * 0.5);
  },
};

// ---------- 像素散射 ----------

const scatter: EffectDef = {
  id: 'scatter',
  label: '像素散射',
  params: [
    { id: 'radius', label: '散射半径', type: 'number', min: 1, max: 40, step: 1, default: 6, unit: 'px' },
    { id: 'seed', label: '种子', type: 'number', min: 0, max: 9999, step: 1, default: 1 },
  ],
  apply(frame, p) {
    const radius = n(p, 'radius', 6);
    const seed = Math.round(n(p, 'seed', 1));
    return remap(
      frame,
      (x, y) => [x + (hash2(x, y, seed) - 0.5) * 2 * radius, y + (hash2(x, y, seed + 77) - 0.5) * 2 * radius],
      true,
    );
  },
};

export const EFFECT_DEFS: EffectDef[] = [scanlines, grain, jpeg, blockShift, rowShift, pixelSort, wave, barrel, scatter];

export function getEffectDef(id: string): EffectDef | undefined {
  return EFFECT_DEFS.find((d) => d.id === id);
}

// 供噪声类工具复用蓝噪声（保留导出，避免树摇掉）
export const _blueNoiseSize = BLUE_NOISE_SIZE;
export const _blueNoise = blueNoise128;
