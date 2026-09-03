import type { RGBAFrame } from '../types';

export type ResampleMethod = 'nearest' | 'bilinear' | 'box' | 'lanczos';

interface AxisWeights {
  /** 每个目标索引的首个源索引 */
  start: Int32Array;
  /** 每个目标索引的抽头数 */
  count: Int32Array;
  /** 拼接的权重 */
  weights: Float32Array;
  /** 每个目标索引在 weights 中的偏移 */
  offset: Int32Array;
}

function sinc(x: number): number {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

function kernel(method: ResampleMethod, t: number): number {
  const a = Math.abs(t);
  switch (method) {
    case 'box':
      return a < 0.5 ? 1 : a === 0.5 ? 0.5 : 0;
    case 'bilinear':
      return a < 1 ? 1 - a : 0;
    case 'lanczos':
      return a < 3 ? sinc(a) * sinc(a / 3) : 0;
    case 'nearest':
      return 0;
  }
}

function support(method: ResampleMethod): number {
  switch (method) {
    case 'box':
      return 0.5;
    case 'bilinear':
      return 1;
    case 'lanczos':
      return 3;
    case 'nearest':
      return 0;
  }
}

/**
 * 计算一维重采样权重。目标索引 i 的中心落在源坐标 (i + 0.5) * scale - offset。
 * 缩小时滤波器按 scale 展宽（避免混叠），放大时保持原宽度。
 * 越界抽头直接丢弃并对剩余权重归一化，因此边缘格子的颜色只由可见像素决定。
 */
export function axisWeights(srcLen: number, dstLen: number, scale: number, offset: number, method: ResampleMethod): AxisWeights {
  const start = new Int32Array(dstLen);
  const count = new Int32Array(dstLen);
  const offsetArr = new Int32Array(dstLen);
  const chunks: number[] = [];
  const filterScale = Math.max(scale, 1);
  const radius = support(method) * filterScale;

  for (let i = 0; i < dstLen; i++) {
    const center = (i + 0.5) * scale - offset;
    offsetArr[i] = chunks.length;

    if (method === 'nearest') {
      start[i] = Math.max(0, Math.min(srcLen - 1, Math.floor(center)));
      count[i] = 1;
      chunks.push(1);
      continue;
    }

    const lo = Math.max(0, Math.floor(center - radius + 0.5));
    const hi = Math.min(srcLen - 1, Math.ceil(center + radius - 0.5));
    let first = -1;
    let last = -1;
    let sum = 0;
    const local: number[] = [];
    for (let j = lo; j <= hi; j++) {
      const w = kernel(method, (j + 0.5 - center) / filterScale);
      local.push(w);
      if (w !== 0) {
        if (first < 0) first = j;
        last = j;
        sum += w;
      }
    }
    if (first < 0 || sum === 0) {
      // 整个格子都在图像外：退化为最近的边缘像素
      start[i] = Math.max(0, Math.min(srcLen - 1, Math.round(center)));
      count[i] = 1;
      chunks.push(1);
      continue;
    }
    start[i] = first;
    count[i] = last - first + 1;
    for (let j = first; j <= last; j++) chunks.push(local[j - lo] / sum);
  }
  return { start, count, weights: new Float32Array(chunks), offset: offsetArr };
}

/**
 * 可分离重采样核心：输出 dstW × dstH 的预乘 RGBA 浮点（0..255）。
 * scale 为每个目标像素覆盖的源像素数，offset 为目标网格相对源的起始偏移。
 */
export function resampleCore(
  src: RGBAFrame,
  dstW: number,
  dstH: number,
  scaleX: number,
  scaleY: number,
  offsetX: number,
  offsetY: number,
  method: ResampleMethod,
): Float32Array {
  const { width: sw, height: sh, data } = src;
  const wx = axisWeights(sw, dstW, scaleX, offsetX, method);
  const wy = axisWeights(sh, dstH, scaleY, offsetY, method);

  // 横向：源行 → dstW 列，预乘 alpha
  const tmp = new Float32Array(dstW * sh * 4);
  for (let y = 0; y < sh; y++) {
    const rowIn = y * sw * 4;
    const rowOut = y * dstW * 4;
    for (let x = 0; x < dstW; x++) {
      const s = wx.start[x];
      const c = wx.count[x];
      const o = wx.offset[x];
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < c; k++) {
        const w = wx.weights[o + k];
        const p = rowIn + (s + k) * 4;
        const alpha = data[p + 3] * w;
        r += data[p] * alpha;
        g += data[p + 1] * alpha;
        b += data[p + 2] * alpha;
        a += alpha;
      }
      const q = rowOut + x * 4;
      tmp[q] = r;
      tmp[q + 1] = g;
      tmp[q + 2] = b;
      tmp[q + 3] = a;
    }
  }

  // 纵向：tmp 列 → dstH 行
  const out = new Float32Array(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const s = wy.start[y];
    const c = wy.count[y];
    const o = wy.offset[y];
    const rowOut = y * dstW * 4;
    for (let x = 0; x < dstW; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < c; k++) {
        const w = wy.weights[o + k];
        const p = ((s + k) * dstW + x) * 4;
        r += tmp[p] * w;
        g += tmp[p + 1] * w;
        b += tmp[p + 2] * w;
        a += tmp[p + 3] * w;
      }
      const q = rowOut + x * 4;
      // 反预乘，得到直通颜色 0..255 与 alpha 0..255
      if (a > 0) {
        out[q] = r / a;
        out[q + 1] = g / a;
        out[q + 2] = b / a;
        out[q + 3] = a;
      }
    }
  }
  return out;
}

/** 把 RGBA 帧重采样到 dstW × dstH */
export function resample(src: RGBAFrame, dstW: number, dstH: number, method: ResampleMethod): RGBAFrame {
  if (dstW === src.width && dstH === src.height) {
    return { width: dstW, height: dstH, data: new Uint8ClampedArray(src.data) };
  }
  const f = resampleCore(src, dstW, dstH, src.width / dstW, src.height / dstH, 0, 0, method);
  const data = new Uint8ClampedArray(dstW * dstH * 4);
  for (let i = 0; i < data.length; i++) data[i] = f[i];
  return { width: dstW, height: dstH, data };
}
