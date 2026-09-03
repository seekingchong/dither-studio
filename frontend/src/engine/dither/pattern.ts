import { num, str } from '@/params';
import { getMatrix } from './ordered';
import { fract, mod, rotator, thresholdDither } from './quantize';
import type { AlgorithmDef, DitherInput } from './types';

/** 与线中心的归一化距离：0 在条带中心（最先变暗），1 在条带边缘 */
const lineDist = (t: number) => Math.abs(fract(t) - 0.5) * 2;

export interface PatternOptions {
  type: string;
  /** 图案尺度（像素） */
  scale: number;
  angle: number;
}

function hexCenterDistance(x: number, y: number, s: number): number {
  const rowH = s * 0.8660254;
  const row = Math.floor(y / rowH);
  let best = Infinity;
  for (let r = row - 1; r <= row + 1; r++) {
    const cy = (r + 0.5) * rowH;
    const shift = (r & 1) === 0 ? 0 : s / 2;
    const col = Math.floor((x - shift) / s);
    for (let c = col - 1; c <= col + 1; c++) {
      const cx = (c + 0.5) * s + shift;
      const d = Math.hypot(x - cx, y - cy);
      if (d < best) best = d;
    }
  }
  return Math.min(1, best / (s / 1.7320508));
}

export function patternField(opts: PatternOptions, width: number, height: number): (x: number, y: number) => number {
  const s = Math.max(2, opts.scale);
  const rot = rotator(-opts.angle);
  const cx0 = width / 2;
  const cy0 = height / 2;
  const bayer2 = getMatrix('bayer2');

  let field: (x: number, y: number) => number;
  switch (opts.type) {
    case 'checker':
      field = (x, y) => {
        const [rx, ry] = rot(x + 0.5, y + 0.5);
        return bayer2.data[mod(Math.floor(ry / s), 2) * 2 + mod(Math.floor(rx / s), 2)];
      };
      break;
    case 'hlines':
      field = (x, y) => lineDist(rot(x + 0.5, y + 0.5)[1] / s);
      break;
    case 'vlines':
      field = (x, y) => lineDist(rot(x + 0.5, y + 0.5)[0] / s);
      break;
    case 'diagonal':
      field = (x, y) => {
        const [rx, ry] = rot(x + 0.5, y + 0.5);
        return lineDist((rx + ry) / s);
      };
      break;
    case 'cross':
      field = (x, y) => {
        const [rx, ry] = rot(x + 0.5, y + 0.5);
        return Math.min(lineDist(rx / s), lineDist(ry / s));
      };
      break;
    case 'brick':
      field = (x, y) => {
        const [rx, ry] = rot(x + 0.5, y + 0.5);
        const row = Math.floor(ry / s);
        const bx = rx / (2 * s) + ((row & 1) === 0 ? 0 : 0.5);
        // 砖缝最先变暗：到砖缝的距离小 → m 小
        const dy = Math.min(fract(ry / s), 1 - fract(ry / s)) * 2;
        const dx = Math.min(fract(bx), 1 - fract(bx)) * 2;
        return Math.min(1, Math.min(dx, dy) * 2);
      };
      break;
    case 'spiral':
      field = (x, y) => {
        const [rx, ry] = rot(x + 0.5 - cx0, y + 0.5 - cy0);
        const r = Math.hypot(rx, ry);
        const theta = Math.atan2(ry, rx) / (2 * Math.PI);
        return lineDist(r / s - theta);
      };
      break;
    case 'hexagon':
      field = (x, y) => {
        const [rx, ry] = rot(x + 0.5, y + 0.5);
        return hexCenterDistance(rx, ry, s);
      };
      break;
    case 'sine':
      field = (x, y) => {
        const [rx, ry] = rot(x + 0.5, y + 0.5);
        return lineDist(ry / s + 0.5 * Math.sin((2 * Math.PI * rx) / (s * 2)));
      };
      break;
    default:
      field = () => 0.5;
  }
  return field;
}

export function patternDither(input: DitherInput, opts: PatternOptions): Uint8Array {
  return thresholdDither(input, patternField(opts, input.width, input.height));
}

function patternOptions(params: Parameters<AlgorithmDef['run']>[1]): PatternOptions {
  return { type: str(params, 'dither.pattern.type'), scale: num(params, 'dither.pattern.scale'), angle: num(params, 'dither.pattern.angle') };
}

export const PATTERN_TYPES: Array<{ id: string; label: string }> = [
  { id: 'checker', label: '棋盘' },
  { id: 'hlines', label: '横线' },
  { id: 'vlines', label: '竖线' },
  { id: 'diagonal', label: '斜线' },
  { id: 'cross', label: '交叉线' },
  { id: 'brick', label: '砖块' },
  { id: 'spiral', label: '螺旋' },
  { id: 'hexagon', label: '六边形' },
  { id: 'sine', label: '正弦波' },
];

export const PATTERN_ALGORITHMS: AlgorithmDef[] = PATTERN_TYPES.map(({ id, label }) => ({
  id,
  family: 'pattern',
  label,
  run: (input, params) => patternDither(input, patternOptions(params)),
  field: (params, width, height) => ({ field: patternField(patternOptions(params), width, height), amplitude: 1 }),
}));
