import { num } from '@/params';
import { createPerlin, hash2, interleavedGradientNoise } from '../util/random';
import { BLUE_NOISE_SIZE, blueNoise128 } from './bluenoise128';
import { mod, thresholdDither } from './quantize';
import type { AlgorithmDef, DitherInput } from './types';

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

function run(type: string) {
  return (input: DitherInput, params: Parameters<AlgorithmDef['run']>[1]) => {
    const amplitude = num(params, 'dither.noise.amplitude') / 100;
    const scale = num(params, 'dither.noise.scale');
    const seed = Math.round(num(params, 'dither.noise.seed'));
    return thresholdDither(input, makeField(type, scale, seed), amplitude);
  };
}

export const NOISE_ALGORITHMS: AlgorithmDef[] = [
  { id: 'blue', family: 'noise', label: '蓝噪声', run: run('blue') },
  { id: 'white', family: 'noise', label: '白噪声', run: run('white') },
  { id: 'ign', family: 'noise', label: '交错梯度噪声', run: run('ign') },
  { id: 'perlin', family: 'noise', label: 'Perlin', run: run('perlin') },
];
