import type { GridRenderOptions } from '../render/grid';
import type { CellFrame, RGBAFrame } from '../types';
import { GpuContext } from './gl';

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uCells;
uniform vec2 uSize;        // 画布尺寸
uniform vec2 uCellCount;   // 格子数
uniform float uCell;       // 格子边长（画布像素）
uniform vec2 uOffset;      // 网格偏移（已取模）
uniform vec3 uBg;          // 背景色 0..1
uniform float uBgLum;
uniform float uRange;
uniform int uDot;          // 0 方块 1 欧几里得 2 圆方
uniform float uDotSize;
uniform int uDotTone;
uniform int uMetaball;
uniform float uBlobRadius;
uniform int uReach;
uniform vec2 uGap;
uniform int uBackground;   // 0 无 1 连线 2 网格点
uniform int uLineDir;      // 0 行 1 列
uniform float uLineHalf;
uniform vec3 uBgColor;
uniform int uBgShape;      // 0 圆 1 方 2 菱 3 十字
uniform float uBgDotSize;
out vec4 outColor;

float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float strengthAt(ivec2 cell) {
  vec3 c = texelFetch(uCells, cell, 0).rgb;
  return min(1.0, abs(lum(c) * 255.0 - uBgLum) / uRange);
}

bool insideDot(int shape, float u, float v, float s) {
  if (s <= 0.0) return false;
  if (shape == 1) return u * u + v * v <= s * s;
  if (shape == 2) { float a = u*u*u*u + v*v*v*v; return a <= s*s*s*s; }
  return abs(u) <= s && abs(v) <= s;
}

bool insideBg(int shape, float u, float v, float s, float pxNorm) {
  if (s <= 0.0) return false;
  if (shape == 1) return abs(u) <= s && abs(v) <= s;
  if (shape == 2) return abs(u) + abs(v) <= s;
  if (shape == 3) { float arm = max(s * 0.25, pxNorm * 0.5); return (abs(u) <= arm && abs(v) <= s) || (abs(v) <= arm && abs(u) <= s); }
  return u * u + v * v <= s * s;
}

void main() {
  float x = gl_FragCoord.x - 0.5;
  float y = gl_FragCoord.y - 0.5;
  float gx = x + uOffset.x;
  float gy = y + uOffset.y;
  int i = int(min(uCellCount.x - 1.0, floor(gx / uCell)));
  int j = int(min(uCellCount.y - 1.0, floor(gy / uCell)));
  float lx = gx - floor(gx / uCell) * uCell + 0.5;
  float ly = gy - floor(gy / uCell) * uCell + 0.5;
  float innerW = max(1.0, uCell - uGap.x);
  float innerH = max(1.0, uCell - uGap.y);
  float halfW = innerW / 2.0;
  float halfH = innerH / 2.0;
  float cx0 = uGap.x / 2.0 + halfW;
  float cy0 = uGap.y / 2.0 + halfH;
  float u = (lx - cx0) / halfW;
  float v = (ly - cy0) / halfH;

  vec3 color = uBg;
  if (uBackground == 1) {
    float along = uLineDir == 0 ? abs(ly - uCell / 2.0) : abs(lx - uCell / 2.0);
    if (along <= uLineHalf) color = uBgColor;
  } else if (uBackground == 2) {
    if (insideBg(uBgShape, (lx - uCell / 2.0) / (uCell / 2.0), (ly - uCell / 2.0) / (uCell / 2.0), uBgDotSize, 2.0 / uCell)) color = uBgColor;
  }

  bool hit = false;
  ivec2 cellIdx = ivec2(i, j);
  if (uMetaball == 1) {
    float field = 0.0;
    float bestContrib = 0.0;
    ivec2 best = ivec2(-1, -1);
    float px = x + uOffset.x + 0.5;
    float py = y + uOffset.y + 0.5;
    for (int dj = -3; dj <= 3; dj++) {
      if (dj < -uReach || dj > uReach) continue;
      int cj = j + dj;
      if (cj < 0 || cj >= int(uCellCount.y)) continue;
      for (int di = -3; di <= 3; di++) {
        if (di < -uReach || di > uReach) continue;
        int ci = i + di;
        if (ci < 0 || ci >= int(uCellCount.x)) continue;
        float s = strengthAt(ivec2(ci, cj));
        if (s <= 0.0) continue;
        float cxc = float(ci) * uCell + cx0;
        float cyc = float(cj) * uCell + cy0;
        float dx = px - cxc;
        float dy = py - cyc;
        float t = sqrt(dx * dx + dy * dy) / uBlobRadius;
        if (t >= 1.0) continue;
        float k = (1.0 - t * t) * (1.0 - t * t);
        float contrib = k * s * uDotSize;
        field += contrib;
        if (contrib > bestContrib) { bestContrib = contrib; best = ivec2(ci, cj); }
      }
    }
    if (field >= 0.5 * uDotSize && best.x >= 0) { hit = true; cellIdx = best; }
  } else {
    float s = strengthAt(cellIdx);
    if (s > 0.0) {
      float diameter = uDotTone == 1 ? uDotSize * s : uDotSize;
      if (abs(u) <= 1.0 && abs(v) <= 1.0 && insideDot(uDot, u, v, diameter)) hit = true;
    }
  }
  if (hit) color = texelFetch(uCells, cellIdx, 0).rgb;
  outColor = vec4(color, 1.0);
}`;

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** 网格渲染的 WebGL 路径；与 renderGrid 同语义。失败返回 null 交给 CPU。 */
export function renderGridGpu(
  cells: CellFrame,
  width: number,
  height: number,
  size: number,
  offsetX: number,
  offsetY: number,
  opts: GridRenderOptions,
): RGBAFrame | null {
  const ctx = GpuContext.get();
  if (!ctx) return null;
  try {
    const program = ctx.program('grid', FRAGMENT);
    const gl = ctx.gl;
    const bg = opts.invert ? opts.ink : opts.paper;
    const range = Math.max(1, Math.abs(luma(opts.paper[0], opts.paper[1], opts.paper[2]) - luma(opts.ink[0], opts.ink[1], opts.ink[2])));
    const ox = ((offsetX % size) + size) % size;
    const oy = ((offsetY % size) + size) % size;
    const dotIndex = opts.dot === 'euclidean' ? 1 : opts.dot === 'roundsquare' ? 2 : 0;
    const bgIndex = opts.background === 'lines' ? 1 : opts.background === 'dots' ? 2 : 0;
    const shapeIndex = opts.bgDotShape === 'square' ? 1 : opts.bgDotShape === 'diamond' ? 2 : opts.bgDotShape === 'cross' ? 3 : 0;
    const data = ctx.run(program, width, height, () => {
      gl.activeTexture(gl.TEXTURE0);
      ctx.textureRgba('grid:cells', cells.width, cells.height, cells.data);
      gl.uniform1i(ctx.uniform(program, 'uCells'), 0);
      gl.uniform2f(ctx.uniform(program, 'uSize'), width, height);
      gl.uniform2f(ctx.uniform(program, 'uCellCount'), cells.width, cells.height);
      gl.uniform1f(ctx.uniform(program, 'uCell'), size);
      gl.uniform2f(ctx.uniform(program, 'uOffset'), ox, oy);
      gl.uniform3f(ctx.uniform(program, 'uBg'), bg[0] / 255, bg[1] / 255, bg[2] / 255);
      gl.uniform1f(ctx.uniform(program, 'uBgLum'), luma(bg[0], bg[1], bg[2]));
      gl.uniform1f(ctx.uniform(program, 'uRange'), range);
      gl.uniform1i(ctx.uniform(program, 'uDot'), dotIndex);
      gl.uniform1f(ctx.uniform(program, 'uDotSize'), opts.dotSize);
      gl.uniform1i(ctx.uniform(program, 'uDotTone'), opts.dotTone ? 1 : 0);
      gl.uniform1i(ctx.uniform(program, 'uMetaball'), opts.metaball ? 1 : 0);
      gl.uniform1f(ctx.uniform(program, 'uBlobRadius'), size * opts.metaballRadius);
      gl.uniform1i(ctx.uniform(program, 'uReach'), Math.min(3, Math.ceil(opts.metaballRadius) + 1));
      gl.uniform2f(ctx.uniform(program, 'uGap'), opts.gapX, opts.gapY);
      gl.uniform1i(ctx.uniform(program, 'uBackground'), bgIndex);
      gl.uniform1i(ctx.uniform(program, 'uLineDir'), opts.lineDirection === 'col' ? 1 : 0);
      gl.uniform1f(ctx.uniform(program, 'uLineHalf'), opts.lineWidth / 2);
      gl.uniform3f(ctx.uniform(program, 'uBgColor'), opts.bgColor[0] / 255, opts.bgColor[1] / 255, opts.bgColor[2] / 255);
      gl.uniform1i(ctx.uniform(program, 'uBgShape'), shapeIndex);
      gl.uniform1f(ctx.uniform(program, 'uBgDotSize'), opts.bgDotSize);
    });
    return { width, height, data };
  } catch {
    return null;
  }
}
