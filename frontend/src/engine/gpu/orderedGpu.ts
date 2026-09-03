import type { ThresholdMatrix } from '../dither/ordered';
import type { OrderedOptions } from '../dither/ordered';
import { GpuContext } from './gl';

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uGray;
uniform sampler2D uMatrix;
uniform vec2 uSize;
uniform float uMatrixSize;
uniform float uLevels;
uniform float uScale;
uniform float uAngle;
uniform vec2 uOffset;
out vec4 outColor;

float modf_(float a, float n) { return a - floor(a / n) * n; }

void main() {
  float x = gl_FragCoord.x - 0.5;
  float y = gl_FragCoord.y - 0.5;
  float g = texelFetch(uGray, ivec2(int(x), int(y)), 0).r;
  float px; float py;
  if (uAngle == 0.0) {
    px = x + uOffset.x;
    py = y + uOffset.y;
  } else {
    float c = cos(uAngle); float s = sin(uAngle);
    float ox = x + 0.5 + uOffset.x; float oy = y + 0.5 + uOffset.y;
    px = c * ox - s * oy;
    py = s * ox + c * oy;
  }
  float mx = modf_(floor(px / uScale), uMatrixSize);
  float my = modf_(floor(py / uScale), uMatrixSize);
  float m = texelFetch(uMatrix, ivec2(int(mx), int(my)), 0).r;
  float v = g + (m - 0.5) / (uLevels - 1.0);
  float q = clamp(floor(v * (uLevels - 1.0) + 0.5), 0.0, uLevels - 1.0);
  outColor = vec4(q / 255.0, 0.0, 0.0, 1.0);
}`;

/** 有序抖动的 WebGL 路径；与 orderedDither 同语义。失败返回 null 交给 CPU。 */
export function orderedDitherGpu(
  gray: Float32Array,
  width: number,
  height: number,
  levels: number,
  matrix: ThresholdMatrix,
  opts: Partial<OrderedOptions>,
): Uint8Array | null {
  const ctx = GpuContext.get();
  if (!ctx) return null;
  try {
    const program = ctx.program('ordered', FRAGMENT);
    const gl = ctx.gl;
    const rgba = ctx.run(program, width, height, () => {
      gl.activeTexture(gl.TEXTURE0);
      ctx.textureR32F('ordered:gray', width, height, gray);
      gl.uniform1i(ctx.uniform(program, 'uGray'), 0);
      gl.activeTexture(gl.TEXTURE1);
      ctx.textureR32F(`ordered:matrix`, matrix.size, matrix.size, matrix.data);
      gl.uniform1i(ctx.uniform(program, 'uMatrix'), 1);
      gl.uniform2f(ctx.uniform(program, 'uSize'), width, height);
      gl.uniform1f(ctx.uniform(program, 'uMatrixSize'), matrix.size);
      gl.uniform1f(ctx.uniform(program, 'uLevels'), levels);
      gl.uniform1f(ctx.uniform(program, 'uScale'), Math.max(1, opts.scale ?? 1));
      gl.uniform1f(ctx.uniform(program, 'uAngle'), ((opts.angle ?? 0) * Math.PI) / 180);
      gl.uniform2f(ctx.uniform(program, 'uOffset'), opts.offsetX ?? 0, opts.offsetY ?? 0);
    });
    const out = new Uint8Array(width * height);
    for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = rgba[j];
    return out;
  } catch {
    return null;
  }
}
