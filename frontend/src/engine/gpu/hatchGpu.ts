import { hatchLayers, type HatchOptions } from '../render/hatch';
import type { LevelFrame, RGBAFrame } from '../types';
import { GpuContext } from './gl';

/** 片元里最多往外看几格；再远的笔画（极长 / 极粗）交给 CPU */
const MAX_REACH = 3;

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uLevels;   // R = 暗度档位
uniform vec2 uCellCount;
uniform vec2 uCell;          // 格子宽高
uniform vec2 uOffset;        // 网格偏移（已取模）
uniform float uStagger;      // 奇数行右移（像素）
uniform int uReachX;
uniform int uReachY;
uniform int uLayers;
uniform vec2 uDir0;
uniform vec2 uNrm0;
uniform float uHalfLen0;
uniform float uWidths0[16];
uniform vec2 uDir1;
uniform vec2 uNrm1;
uniform float uHalfLen1;
uniform float uWidths1[16];
uniform float uRoundness;
uniform int uLink;           // 0 无 1 沿斜线 2 横 3 纵 4 横纵
uniform float uLinkHalf;
uniform vec3 uLinkColor;
uniform vec3 uInk;
uniform vec3 uPaper;
out vec4 outColor;

float strokeSdf(vec2 q, vec2 d, vec2 n, float hl, float w) {
  float hw = w * 0.5;
  float r = uRoundness * min(hl, hw);
  vec2 g = vec2(abs(dot(q, d)) - (hl - r), abs(dot(q, n)) - (hw - r));
  return length(max(g, 0.0)) + min(max(g.x, g.y), 0.0) - r;
}

float cover(float c) { return clamp(c, 0.0, 1.0); }

void main() {
  float x = gl_FragCoord.x - 0.5;
  float y = gl_FragCoord.y - 0.5;
  vec2 p = vec2(x + 0.5, y + 0.5);
  float gy = y + uOffset.y;
  int j0 = int(floor(gy / uCell.y));
  float best = 1e9;
  for (int dj = -3; dj <= 3; dj++) {
    if (dj < -uReachY || dj > uReachY) continue;
    int cj = j0 + dj;
    if (cj < 0 || cj >= int(uCellCount.y)) continue;
    float shift = ((cj & 1) == 1) ? uStagger : 0.0;
    float gx = x + uOffset.x - shift;
    int i0 = int(floor(gx / uCell.x));
    float cy = (float(cj) + 0.5) * uCell.y - uOffset.y;
    for (int di = -3; di <= 3; di++) {
      if (di < -uReachX || di > uReachX) continue;
      int ci = i0 + di;
      if (ci < 0 || ci >= int(uCellCount.x)) continue;
      int k = int(texelFetch(uLevels, ivec2(ci, cj), 0).r + 0.5);
      vec2 q = p - vec2((float(ci) + 0.5) * uCell.x - uOffset.x + shift, cy);
      float w0 = uWidths0[k];
      if (w0 > 0.0) best = min(best, strokeSdf(q, uDir0, uNrm0, uHalfLen0, w0));
      if (uLayers > 1) {
        float w1 = uWidths1[k];
        if (w1 > 0.0) best = min(best, strokeSdf(q, uDir1, uNrm1, uHalfLen1, w1));
      }
    }
  }

  vec3 color = uPaper;
  if (uLink != 0) {
    float shift = ((j0 & 1) == 1) ? uStagger : 0.0;
    float ly = gy - floor(gy / uCell.y) * uCell.y + 0.5;
    float gx = x + uOffset.x - shift;
    float lx = gx - floor(gx / uCell.x) * uCell.x + 0.5;
    float lc = 0.0;
    if (uLink == 2 || uLink == 4) lc = max(lc, cover(uLinkHalf + 0.5 - abs(ly - uCell.y * 0.5)));
    if (uLink == 3 || uLink == 4) lc = max(lc, cover(uLinkHalf + 0.5 - abs(lx - uCell.x * 0.5)));
    if (uLink == 1) lc = max(lc, cover(uLinkHalf + 0.5 - abs((lx - uCell.x * 0.5) * uNrm0.x + (ly - uCell.y * 0.5) * uNrm0.y)));
    color = mix(color, uLinkColor, lc);
  }
  color = mix(color, uInk, cover(0.5 - best));
  outColor = vec4(color, 1.0);
}`;

const LINK_INDEX = { none: 0, stroke: 1, row: 2, col: 3, grid: 4 } as const;

/** 排线渲染的 WebGL 路径；与 renderHatch 同语义。失败或超出片元的搜索范围时返回 null 交给 CPU。 */
export function renderHatchGpu(
  levels: LevelFrame,
  width: number,
  height: number,
  sx: number,
  sy: number,
  offsetX: number,
  offsetY: number,
  opts: HatchOptions,
): RGBAFrame | null {
  const ctx = GpuContext.get();
  if (!ctx) return null;
  const layers = hatchLayers(opts, sx, sy, levels.levels);
  let extX = 0;
  let extY = 0;
  for (const layer of layers) {
    let wmax = 0;
    for (const w of layer.widths) if (w > wmax) wmax = w;
    extX = Math.max(extX, (layer.length / 2) * Math.abs(layer.dx) + (wmax / 2) * Math.abs(layer.nx) + 1);
    extY = Math.max(extY, (layer.length / 2) * Math.abs(layer.dy) + (wmax / 2) * Math.abs(layer.ny) + 1);
  }
  const reachX = Math.ceil(extX / sx);
  const reachY = Math.ceil(extY / sy);
  if (reachX > MAX_REACH || reachY > MAX_REACH) return null;

  try {
    const program = ctx.program('hatch', FRAGMENT);
    const gl = ctx.gl;
    const ox = ((offsetX % sx) + sx) % sx;
    const oy = ((offsetY % sy) + sy) % sy;
    const levelTex = new Float32Array(levels.data.length);
    for (let i = 0; i < levelTex.length; i++) levelTex[i] = levels.data[i];
    const widths = (layer: { widths: Float32Array } | undefined) => {
      const arr = new Float32Array(16);
      if (layer) arr.set(layer.widths.subarray(0, 16));
      return arr;
    };
    const rgb = (c: [number, number, number]) => [c[0] / 255, c[1] / 255, c[2] / 255] as const;
    const data = ctx.run(program, width, height, () => {
      gl.activeTexture(gl.TEXTURE0);
      ctx.textureR32F('hatch:levels', levels.width, levels.height, levelTex);
      gl.uniform1i(ctx.uniform(program, 'uLevels'), 0);
      gl.uniform2f(ctx.uniform(program, 'uCellCount'), levels.width, levels.height);
      gl.uniform2f(ctx.uniform(program, 'uCell'), sx, sy);
      gl.uniform2f(ctx.uniform(program, 'uOffset'), ox, oy);
      gl.uniform1f(ctx.uniform(program, 'uStagger'), opts.stagger * sx);
      gl.uniform1i(ctx.uniform(program, 'uReachX'), reachX);
      gl.uniform1i(ctx.uniform(program, 'uReachY'), reachY);
      gl.uniform1i(ctx.uniform(program, 'uLayers'), layers.length);
      const [a, b] = layers;
      gl.uniform2f(ctx.uniform(program, 'uDir0'), a.dx, a.dy);
      gl.uniform2f(ctx.uniform(program, 'uNrm0'), a.nx, a.ny);
      gl.uniform1f(ctx.uniform(program, 'uHalfLen0'), a.length / 2);
      gl.uniform1fv(ctx.uniform(program, 'uWidths0'), widths(a));
      gl.uniform2f(ctx.uniform(program, 'uDir1'), b?.dx ?? 0, b?.dy ?? 0);
      gl.uniform2f(ctx.uniform(program, 'uNrm1'), b?.nx ?? 0, b?.ny ?? 0);
      gl.uniform1f(ctx.uniform(program, 'uHalfLen1'), b ? b.length / 2 : 0);
      gl.uniform1fv(ctx.uniform(program, 'uWidths1'), widths(b));
      gl.uniform1f(ctx.uniform(program, 'uRoundness'), opts.roundness);
      gl.uniform1i(ctx.uniform(program, 'uLink'), LINK_INDEX[opts.link] ?? 0);
      gl.uniform1f(ctx.uniform(program, 'uLinkHalf'), opts.linkWidth / 2);
      gl.uniform3f(ctx.uniform(program, 'uLinkColor'), ...rgb(opts.linkColor));
      gl.uniform3f(ctx.uniform(program, 'uInk'), ...rgb(opts.ink));
      gl.uniform3f(ctx.uniform(program, 'uPaper'), ...rgb(opts.paper));
    });
    return { width, height, data };
  } catch {
    return null;
  }
}
