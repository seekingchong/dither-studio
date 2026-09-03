import { num } from '@/params';
import { createPerlin, hash2, interleavedGradientNoise } from '../util/random';
import { BLUE_NOISE_SIZE, blueNoise128 } from './bluenoise128';
import { mod, thresholdDither } from './quantize';
import type { AlgorithmDef, DitherInput, ThresholdField } from './types';

type NoiseField = (x: number, y: number) => number;

function makeField(type: string, scale: number, seed: number): NoiseField {
  const s = Math.max(1, scale);
  switch (type) {
    case 'white':
      return (x, y) => hash2(Math.floor(x / s), Math.floor(y / s), seed);
    case 'ign':
      return (x, y) => interleavedGradientNoise(Math.floor(x / s), Math.floor(y / s), seed);
    case 'perlin': {
      const perlin = createPerlin(seed);
      const wavelength = s * 8;
      return (x, y) => {
        const v = perlin(x / wavelength + 0.37, y / wavelength + 0.61);
        // Perlin 大致在 ±0.7 之间，拉到 0..1
        return Math.min(1, Math.max(0, v * 0.7 + 0.5));
      };
    }
    case 'blue':
    default: {
      const tex = blueNoise128();
      const n = BLUE_NOISE_SIZE;
      const ox = mod(seed * 37, n);
      const oy = mod(seed * 91, n);
      return (x, y) => (tex[mod(Math.floor(y / s) + oy, n) * n + mod(Math.floor(x / s) + ox, n)] + 0.5) / 256;
    }
  }
}

function fieldOf(type: string, params: Parameters<AlgorithmDef['run']>[1]): ThresholdField {
  return {
    field: makeField(type, num(params, 'dither.noise.scale'), Math.round(num(params, 'dither.noise.seed'))),
    amplitude: num(params, 'dither.noise.amplitude') / 100,
  };
}

function define(id: string, label: string): AlgorithmDef {
  return {
    id,
    family: 'noise',
    label,
    run: (input: DitherInput, params) => {
      const f = fieldOf(id, params);
      return thresholdDither(input, f.field, f.amplitude);
    },
    field: (params) => fieldOf(id, params),
  };
}

export const NOISE_ALGORITHMS: AlgorithmDef[] = [define('blue', '蓝噪声'), define('white', '白噪声'), define('ign', '交错梯度噪声'), define('perlin', 'Perlin')];
