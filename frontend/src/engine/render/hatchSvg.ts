import type { LevelFrame } from '../types';
import { hatchLayers, rowShift, type HatchOptions } from './hatch';
import { MAX_RECTS } from './svg';

const hex = (c: [number, number, number]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
const f = (n: number) => String(Math.round(n * 100) / 100);

/**
 * 排线结果的矢量版：每一笔是一个旋转过的圆角矩形。同一层同一档的笔完全一样，
 * 所以 `<defs>` 里每档只定义一个 `<rect>`，格子上用 `<use>` 摆到笔心；串线按行 / 列 / 每格的弦出成 `<path>`。
 * 抖动那边是逐格实色块，这边是真正的笔画，改粗细、圆角都还是矢量。
 */
export function hatchToSvg(levels: LevelFrame, width: number, height: number, sx: number, sy: number, offsetX: number, offsetY: number, opts: HatchOptions): string {
  const cw = levels.width;
  const ch = levels.height;
  if (cw * ch > MAX_RECTS) {
    throw new Error(`当前设置下要画 ${cw * ch} 笔以上，SVG 会大到打不开；把「横向间距 / 纵向间距」调大一些再试`);
  }
  const ox = ((offsetX % sx) + sx) % sx;
  const oy = ((offsetY % sy) + sy) % sy;
  const layers = hatchLayers(opts, sx, sy, levels.levels);
  const centerX = (i: number, j: number) => (i + 0.5) * sx - ox + rowShift(j, opts.stagger, sx);
  const centerY = (j: number) => (j + 0.5) * sy - oy;

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="${hex(opts.paper)}"/>`,
  ];

  // 串线：在笔画下面
  if (opts.link !== 'none') {
    const d: string[] = [];
    const rows = opts.link === 'row' || opts.link === 'grid';
    const cols = opts.link === 'col' || opts.link === 'grid';
    if (rows) for (let j = 0; j < ch; j++) d.push(`M0 ${f(centerY(j))}H${width}`);
    if (cols) {
      if (opts.stagger > 0) {
        for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) d.push(`M${f(centerX(i, j))} ${f(j * sy - oy)}V${f((j + 1) * sy - oy)}`);
      } else {
        for (let i = 0; i < cw; i++) d.push(`M${f(centerX(i, 0))} 0V${height}`);
      }
    }
    if (opts.link === 'stroke') {
      const { dx, dy, chord } = layers[0];
      const hx = (dx * chord) / 2;
      const hy = (dy * chord) / 2;
      for (let j = 0; j < ch; j++) {
        const cy = centerY(j);
        for (let i = 0; i < cw; i++) {
          const cx = centerX(i, j);
          d.push(`M${f(cx - hx)} ${f(cy - hy)}L${f(cx + hx)} ${f(cy + hy)}`);
        }
      }
    }
    parts.push(`<path fill="none" stroke="${hex(opts.linkColor)}" stroke-width="${f(opts.linkWidth)}" stroke-linecap="butt" d="${d.join('')}"/>`);
  }

  // 每层每档一个圆角矩形定义
  const defs: string[] = [];
  layers.forEach((layer, li) => {
    const hl = layer.length / 2;
    for (let k = 0; k < layer.widths.length; k++) {
      const w = layer.widths[k];
      if (w <= 0) continue;
      const r = opts.roundness * Math.min(hl, w / 2);
      defs.push(`<rect id="s${li}-${k}" x="${f(-hl)}" y="${f(-w / 2)}" width="${f(layer.length)}" height="${f(w)}" rx="${f(r)}" ry="${f(r)}" transform="rotate(${f(-layer.angle)})"/>`);
    }
  });
  parts.push(`<defs>${defs.join('')}</defs>`);

  const uses: string[] = [];
  layers.forEach((layer, li) => {
    for (let j = 0; j < ch; j++) {
      const cy = centerY(j);
      for (let i = 0; i < cw; i++) {
        const k = levels.data[j * cw + i];
        if (layer.widths[k] <= 0) continue;
        uses.push(`<use xlink:href="#s${li}-${k}" href="#s${li}-${k}" x="${f(centerX(i, j))}" y="${f(cy)}"/>`);
      }
    }
  });
  parts.push(`<g fill="${hex(opts.ink)}">${uses.join('')}</g>`);
  parts.push('</svg>');
  return parts.join('\n');
}
