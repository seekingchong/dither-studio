import { hash2 } from '../util/random';
import { BLUE_NOISE_SIZE, blueNoise128 } from '../dither/bluenoise128';
import type { GrayFrame, RGBFrame } from '../types';
import { createGray, createRGB } from '../types';
import { bilateral, gaussianBlur, sobelMagnitude } from './filters';

export type NoiseType = 'gaussian' | 'uniform' | 'blue' | 'salt-pepper';

export interface ToneOptions {
  /** 自动调整：按直方图拉伸 + 轻微对比与锐化 */
  auto: boolean;
  /** 以下 -1..1 */
  brightness: number;
  contrast: number;
  shadows: number;
  midtones: number;
  highlights: number;
  saturation: number;
  /** 高斯模糊 σ，单位为工作分辨率像素 */
  blur: number;
  /** 0..1 */
  sharpen: number;
  denoise: number;
  noise: number;
  noiseType: NoiseType;
  noiseSeed: number;
  /** 描边强度 0..1 与阈值 0..1 */
  outline: number;
  outlineThreshold: number;
  invert: boolean;
}

export const DEFAULT_TONE: ToneOptions = {
  auto: false,
  brightness: 0,
  contrast: 0,
  shadows: 0,
  midtones: 0,
  highlights: 0,
  saturation: 0,
  blur: 0,
  sharpen: 0,
  denoise: 0,
  noise: 0,
  noiseType: 'gaussian',
  noiseSeed: 1,
  outline: 0,
  outlineThreshold: 0.2,
  invert: false,
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const LUT_SIZE = 1024;

/** 把亮度 / 对比度 / 阴影 / 中间调 / 高光合成一条 0..1 → 0..1 的曲线 */
export function buildToneCurve(o: Pick<ToneOptions, 'brightness' | 'contrast' | 'shadows' | 'midtones' | 'highlights'>): Float32Array {
  const lut = new Float32Array(LUT_SIZE + 1);
  const gamma = Math.pow(2, -o.midtones);
  const contrastK = o.contrast >= 0 ? 1 + o.contrast * 2 : 1 + o.contrast * 0.9;
  for (let i = 0; i <= LUT_SIZE; i++) {
    let v = i / LUT_SIZE;
    // 阴影：暗部权重 (1-v)²；高光：亮部权重 v²
    v = clamp01(v + o.shadows * 0.5 * (1 - v) * (1 - v));
    v = clamp01(v + o.highlights * 0.5 * v * v);
    v = clamp01(v + o.brightness * 0.5);
    v = clamp01((v - 0.5) * contrastK + 0.5);
    v = Math.pow(v, gamma);
    lut[i] = v;
  }
  return lut;
}

function applyCurve(data: Float32Array, lut: Float32Array) {
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    const t = v <= 0 ? 0 : v >= 1 ? LUT_SIZE : v * LUT_SIZE;
    const k = Math.floor(t);
    const f = t - k;
    data[i] = k >= LUT_SIZE ? lut[LUT_SIZE] : lut[k] + (lut[k + 1] - lut[k]) * f;
  }
}

/** 自动色阶：亮度 1% / 99% 分位线性拉伸 */
export function autoLevels(data: Float32Array, channels: number): void {
  const n = data.length / channels;
  const hist = new Int32Array(256);
  for (let i = 0, j = 0; i < n; i++, j += channels) {
    const l = channels === 3 ? 0.2126 * data[j] + 0.7152 * data[j + 1] + 0.0722 * data[j + 2] : data[j];
    hist[Math.round(clamp01(l) * 255)]++;
  }
  const lowCount = n * 0.01;
  const highCount = n * 0.99;
  let acc = 0;
  let lo = 0;
  let hi = 255;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= lowCount) {
      lo = i;
      break;
    }
  }
  acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= highCount) {
      hi = i;
      break;
    }
  }
  if (hi - lo < 8) return;
  const a = lo / 255;
  const b = hi / 255;
  const k = 1 / (b - a);
  for (let i = 0; i < data.length; i++) data[i] = clamp01((data[i] - a) * k);
}

function applySaturation(data: Float32Array, s: number) {
  const k = 1 + s;
  for (let j = 0; j < data.length; j += 3) {
    const l = 0.2126 * data[j] + 0.7152 * data[j + 1] + 0.0722 * data[j + 2];
    data[j] = clamp01(l + (data[j] - l) * k);
    data[j + 1] = clamp01(l + (data[j + 1] - l) * k);
    data[j + 2] = clamp01(l + (data[j + 2] - l) * k);
  }
}

function applyNoise(data: Float32Array, width: number, height: number, channels: number, o: ToneOptions) {
  const amount = o.noise;
  const seed = o.noiseSeed;
  const tex = o.noiseType === 'blue' ? blueNoise128() : null;
  const n = BLUE_NOISE_SIZE;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      let delta = 0;
      switch (o.noiseType) {
        case 'uniform':
          delta = (hash2(x, y, seed) - 0.5) * amount;
          break;
        case 'blue':
          delta = ((tex![(y % n) * n + (x % n)] + 0.5) / 256 - 0.5) * amount;
          break;
        case 'salt-pepper': {
          const r = hash2(x, y, seed);
          if (r < amount * 0.15) {
            const v = r < amount * 0.075 ? 0 : 1;
            for (let c = 0; c < channels; c++) data[i + c] = v;
          }
          continue;
        }
        case 'gaussian':
        default: {
          // Box–Muller
          const u1 = Math.max(1e-6, hash2(x, y, seed));
          const u2 = hash2(x, y, seed + 7919);
          delta = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * amount * 0.25;
        }
      }
      for (let c = 0; c < channels; c++) data[i + c] = clamp01(data[i + c] + delta);
    }
  }
}

function applyOutline(data: Float32Array, width: number, height: number, channels: number, amount: number, threshold: number) {
  const luma = new Float32Array(width * height);
  for (let i = 0, j = 0; i < luma.length; i++, j += channels) {
    luma[i] = channels === 3 ? 0.2126 * data[j] + 0.7152 * data[j + 1] + 0.0722 * data[j + 2] : data[j];
  }
  const mag = sobelMagnitude(luma, width, height);
  const t0 = threshold * 2; // Sobel 幅值大致 0..4√2，阈值映射到 0..2
  const t1 = t0 + 0.6;
  for (let i = 0, j = 0; i < luma.length; i++, j += channels) {
    const m = mag[i];
    const e = m <= t0 ? 0 : m >= t1 ? 1 : (m - t0) / (t1 - t0);
    if (e === 0) continue;
    const k = 1 - e * amount;
    for (let c = 0; c < channels; c++) data[j + c] *= k;
  }
}

function isIdentity(o: ToneOptions): boolean {
  return (
    !o.auto &&
    o.brightness === 0 &&
    o.contrast === 0 &&
    o.shadows === 0 &&
    o.midtones === 0 &&
    o.highlights === 0 &&
    o.saturation === 0 &&
    o.blur === 0 &&
    o.sharpen === 0 &&
    o.denoise === 0 &&
    o.noise === 0 &&
    o.outline === 0 &&
    !o.invert
  );
}

/**
 * 影调预处理，作用在像素化后的工作分辨率 RGB 上。
 * 顺序：自动色阶 → 曲线（阴影 / 高光 / 亮度 / 对比 / 中间调）→ 饱和度 → 去噪 → 模糊 → 锐化 → 噪点 → 描边 → 反相。
 */
export function applyTone(rgb: RGBFrame, options: Partial<ToneOptions>): RGBFrame {
  const o = { ...DEFAULT_TONE, ...options };
  if (isIdentity(o)) return rgb;
  const { width, height } = rgb;
  const out = createRGB(width, height);
  let data = out.data;
  data.set(rgb.data);

  if (o.auto) autoLevels(data, 3);
  const curve = buildToneCurve({
    brightness: o.brightness,
    contrast: o.auto ? o.contrast + 0.1 : o.contrast,
    shadows: o.shadows,
    midtones: o.midtones,
    highlights: o.highlights,
  });
  applyCurve(data, curve);
  if (o.saturation !== 0) applySaturation(data, o.saturation);
  if (o.denoise > 0) {
    const filtered = bilateral(data, width, height, 3, 0.03 + o.denoise * 0.25);
    for (let i = 0; i < data.length; i++) data[i] += (filtered[i] - data[i]) * o.denoise;
  }
  if (o.blur > 0) data = gaussianBlur(data, width, height, 3, o.blur);
  const sharpen = o.sharpen + (o.auto ? 0.15 : 0);
  if (sharpen > 0) {
    const soft = gaussianBlur(data, width, height, 3, 1);
    for (let i = 0; i < data.length; i++) data[i] = clamp01(data[i] + (data[i] - soft[i]) * sharpen * 2);
  }
  if (o.noise > 0) applyNoise(data, width, height, 3, o);
  if (o.outline > 0) applyOutline(data, width, height, 3, o.outline, o.outlineThreshold);
  if (o.invert) for (let i = 0; i < data.length; i++) data[i] = 1 - data[i];
  out.data = data;
  return out;
}

/**
 * 阈值偏置：threshold 取 0..255，128 为中性（偏置恰为 0）。
 * 所有算法统一在量化输入上加 (0.5 - threshold/256)，固定阈值算法下等价于 gray >= threshold/256。
 */
export function thresholdBias(threshold: number): number {
  return 0.5 - threshold / 256;
}

export function applyThresholdBias(gray: GrayFrame, threshold: number): GrayFrame {
  const bias = thresholdBias(threshold);
  if (bias === 0) return gray;
  const out = createGray(gray.width, gray.height);
  const s = gray.data;
  const d = out.data;
  for (let i = 0; i < s.length; i++) d[i] = s[i] + bias;
  return out;
}
