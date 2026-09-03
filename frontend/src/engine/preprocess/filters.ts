/**
 * 空间滤波：盒式模糊（运行和，O(n)）、三次盒式逼近的高斯模糊、Sobel 边缘、双边滤波。
 * 全部作用在 0..1 浮点缓冲上，channels 为通道数（1 或 3）。
 */

/** 一维盒式模糊（水平），半径 r，边缘夹取 */
function boxBlurH(src: Float32Array, dst: Float32Array, width: number, height: number, channels: number, r: number) {
  const norm = 1 / (2 * r + 1);
  for (let y = 0; y < height; y++) {
    const row = y * width * channels;
    for (let c = 0; c < channels; c++) {
      let sum = 0;
      // 初始窗口 [-r, r]，左侧越界取第 0 个像素
      const first = src[row + c];
      const last = src[row + (width - 1) * channels + c];
      for (let i = -r; i <= r; i++) {
        const xi = i < 0 ? 0 : i >= width ? width - 1 : i;
        sum += src[row + xi * channels + c];
      }
      for (let x = 0; x < width; x++) {
        dst[row + x * channels + c] = sum * norm;
        const xIn = x + r + 1;
        const xOut = x - r;
        sum += (xIn >= width ? last : src[row + xIn * channels + c]) - (xOut < 0 ? first : src[row + xOut * channels + c]);
      }
    }
  }
}

function boxBlurV(src: Float32Array, dst: Float32Array, width: number, height: number, channels: number, r: number) {
  const norm = 1 / (2 * r + 1);
  const stride = width * channels;
  for (let x = 0; x < width; x++) {
    for (let c = 0; c < channels; c++) {
      const col = x * channels + c;
      let sum = 0;
      const first = src[col];
      const last = src[(height - 1) * stride + col];
      for (let i = -r; i <= r; i++) {
        const yi = i < 0 ? 0 : i >= height ? height - 1 : i;
        sum += src[yi * stride + col];
      }
      for (let y = 0; y < height; y++) {
        dst[y * stride + col] = sum * norm;
        const yIn = y + r + 1;
        const yOut = y - r;
        sum += (yIn >= height ? last : src[yIn * stride + col]) - (yOut < 0 ? first : src[yOut * stride + col]);
      }
    }
  }
}

export function boxBlur(src: Float32Array, width: number, height: number, channels: number, radius: number): Float32Array {
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return new Float32Array(src);
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  boxBlurH(src, tmp, width, height, channels, r);
  boxBlurV(tmp, out, width, height, channels, r);
  return out;
}

/** 三个盒式半径逼近 σ 的高斯（Kutskir 公式） */
export function boxesForGauss(sigma: number, n = 3): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const sizes: number[] = [];
  for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
  return sizes.map((s) => (s - 1) / 2);
}

export function gaussianBlur(src: Float32Array, width: number, height: number, channels: number, sigma: number): Float32Array {
  if (sigma <= 0) return new Float32Array(src);
  const radii = boxesForGauss(sigma);
  let cur = src;
  for (const r of radii) cur = boxBlur(cur, width, height, channels, r);
  return cur === src ? new Float32Array(src) : cur;
}

/** Sobel 梯度幅值（单通道输入），边缘夹取，输出未归一化（最大约 4√2） */
export function sobelMagnitude(gray: Float32Array, width: number, height: number): Float32Array {
  const out = new Float32Array(gray.length);
  const at = (x: number, y: number) => {
    const xi = x < 0 ? 0 : x >= width ? width - 1 : x;
    const yi = y < 0 ? 0 : y >= height ? height - 1 : y;
    return gray[yi * width + xi];
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx = -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) + at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
      const gy = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      out[y * width + x] = Math.hypot(gx, gy);
    }
  }
  return out;
}

/** 双边滤波：空间高斯 × 亮度高斯，保边平滑。radius 2，σs 1.5 */
export function bilateral(src: Float32Array, width: number, height: number, channels: number, sigmaRange: number, radius = 2): Float32Array {
  const out = new Float32Array(src.length);
  const spatial: number[] = [];
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) spatial.push(Math.exp(-(dx * dx + dy * dy) / (2 * 1.5 * 1.5)));
  const inv2s = 1 / (2 * sigmaRange * sigmaRange);
  const luma = new Float32Array(width * height);
  if (channels === 3) {
    for (let i = 0, j = 0; i < luma.length; i++, j += 3) luma[i] = 0.2126 * src[j] + 0.7152 * src[j + 1] + 0.0722 * src[j + 2];
  } else {
    luma.set(src);
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const center = luma[i];
      let wsum = 0;
      const acc = [0, 0, 0];
      let k = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = Math.min(height - 1, Math.max(0, y + dy));
        for (let dx = -radius; dx <= radius; dx++, k++) {
          const xx = Math.min(width - 1, Math.max(0, x + dx));
          const j = yy * width + xx;
          const d = luma[j] - center;
          const w = spatial[k] * Math.exp(-d * d * inv2s);
          wsum += w;
          for (let c = 0; c < channels; c++) acc[c] += src[j * channels + c] * w;
        }
      }
      for (let c = 0; c < channels; c++) out[i * channels + c] = acc[c] / wsum;
    }
  }
  return out;
}
