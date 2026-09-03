import type { AlgorithmDef, DitherInput } from './types';
import { quantize } from './quantize';

function fixed(input: DitherInput): Uint8Array {
  const { gray, levels } = input;
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = quantize(gray[i], levels);
  return out;
}

export const THRESHOLD_ALGORITHMS: AlgorithmDef[] = [
  { id: 'fixed', family: 'threshold', label: '固定阈值', run: fixed },
];
