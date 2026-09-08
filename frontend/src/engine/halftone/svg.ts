import { baseRadius, cellCenter, countDots, dotOffset, glyphHalfStroke, glyphSpan, lineHalfWidth, type HalftoneGeometry, type HalftoneScreen } from './geometry';
import { glyphSvg } from './glyphs';
import { ribbonPaths } from './ribbon';
import { ROUND_SQUARE_CORNER, shapeVertices } from './shapes';

/**
 * Halftone 的矢量导出：每个网点就是一个 <circle> / <rect> / <polygon>（平滑线条一行一条 <path>），网格的旋转交给 <g transform>，
 * 所以文件里的数字就是格坐标，肉眼可读、也方便拿去别的软件继续编辑。
 * 点融合在 SVG 里用经典的"高斯模糊 + 提高 alpha 对比"滤镜近似，再把原形状叠回去，小点不会被模糊吃掉。
 * CMYK 四层各成一组，正片叠底。特效栈不进 SVG。
 */

/** 网点多于这个数就不出了：几十万个图形的 SVG 打不开 */
export const MAX_SVG_DOTS = 300_000;

const hex = ([r, g, b]: [number, number, number] | Uint8ClampedArray | number[]) =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

/** 两位小数，去掉 -0 与多余的 0 */
const f = (n: number) => {
  const s = (Math.round(n * 100) / 100).toString();
  return s === '-0' ? '0' : s;
};

function dotElement(g: HalftoneGeometry, screen: HalftoneScreen, cx: number, cy: number, r: number, fill: string): string {
  switch (g.shape) {
    case 'circle':
      return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}"${fill}/>`;
    case 'square':
      return `<rect x="${f(cx - r)}" y="${f(cy - r)}" width="${f(2 * r)}" height="${f(2 * r)}"${fill}/>`;
    case 'roundsquare':
      return `<rect x="${f(cx - r)}" y="${f(cy - r)}" width="${f(2 * r)}" height="${f(2 * r)}" rx="${f(r * ROUND_SQUARE_CORNER)}"${fill}/>`;
    case 'line': {
      const hw = lineHalfWidth(screen, 0.25);
      return `<rect x="${f(cx - hw)}" y="${f(cy - r)}" width="${f(2 * hw)}" height="${f(2 * r)}"${fill}/>`;
    }
    default: {
      const pts = shapeVertices(g.shape, r, lineHalfWidth(screen, 0.25));
      if (!pts) return '';
      const points = pts.map(([x, y]) => `${f(cx + x)},${f(cy + y)}`).join(' ');
      return `<polygon points="${points}"${fill}/>`;
    }
  }
}

export function halftoneToSvg(g: HalftoneGeometry): string {
  const count = countDots(g);
  if (count > MAX_SVG_DOTS) {
    throw new Error(`当前设置下要画 ${count} 个网点，SVG 会大到打不开；把「横向间距 / 纵向间距」调大一些再试`);
  }
  const { width, height } = g;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`];
  const minPitch = Math.min(...g.screens.map((s) => Math.min(s.pitchX, s.pitchY)));
  const goo = g.merge > 0;
  if (goo) {
    // 光栅里融合度 100% 能接上相距四分之一格距的两个边；模糊 + 阈值要接上同样的缝，σ 约是缝宽的七成
    const sigma = f(g.merge * minPitch * 0.18);
    parts.push(
      '<defs>',
      `<filter id="goo" x="-10%" y="-10%" width="120%" height="120%">`,
      `<feGaussianBlur in="SourceGraphic" stdDeviation="${sigma}" result="blur"/>`,
      '<feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9" result="goo"/>',
      '<feComposite in="SourceGraphic" in2="goo" operator="over"/>',
      '</filter>',
      '</defs>',
    );
  }
  parts.push(`<rect width="${width}" height="${height}" fill="${hex(g.paper)}"/>`);

  for (const screen of g.screens) {
    const r0 = baseRadius(g.shape, screen);
    // 符号网点：线粗与圆头写在 <g> 上，描边图元各自带 stroke（填充图元继承 <g> 的 fill，不描边）
    const glyphs = g.shape === 'glyph' ? screen.glyph : undefined;
    const hw = glyphHalfStroke(g.glyphStroke, screen);
    const [spanX, spanY] = glyphSpan(screen, 0.25);
    const attrs = [`transform="translate(${f(width / 2)} ${f(height / 2)}) rotate(${f(screen.angle)})"`];
    if (!screen.color) attrs.push(`fill="${hex(screen.ink)}"`);
    if (glyphs) attrs.push(`stroke-width="${f(hw * 2)}" stroke-linecap="round" stroke-linejoin="round"`);
    if (goo) attrs.push('filter="url(#goo)"');
    if (g.mode === 'cmyk') attrs.push('style="mix-blend-mode:multiply"');
    parts.push(`<g ${attrs.join(' ')}>`);
    const inkStroke = ` stroke="${hex(screen.ink)}"`;
    if (g.shape === 'smoothline') {
      // 平滑线条：一行一条闭合 <path>（上下沿各一串三次贝塞尔），原图色模式按格切开各填各的颜色
      for (let jj = 0; jj < screen.rows; jj++) {
        const [x0, y0] = cellCenter(screen, screen.i0, screen.j0 + jj);
        for (const { d, idx } of ribbonPaths(screen, jj, r0, x0, y0, !!screen.color, f)) {
          const fill = screen.color ? ` fill="${hex(screen.color.subarray(idx * 3, idx * 3 + 3))}"` : '';
          parts.push(`<path d="${d}"${fill}/>`);
        }
      }
      parts.push('</g>');
      continue;
    }
    for (let jj = 0; jj < screen.rows; jj++) {
      const j = screen.j0 + jj;
      for (let ii = 0; ii < screen.cols; ii++) {
        const idx = jj * screen.cols + ii;
        const sz = screen.size[idx];
        if (sz <= 0) continue;
        const [cx0, cy0] = cellCenter(screen, screen.i0 + ii, j);
        const [ox, oy] = dotOffset(screen, idx);
        const cx = cx0 + ox;
        const cy = cy0 + oy;
        const color = screen.color ? hex(screen.color.subarray(idx * 3, idx * 3 + 3)) : '';
        const fill = color ? ` fill="${color}"` : '';
        if (glyphs) {
          const code = glyphs[idx];
          if (code === 0) continue;
          parts.push(...glyphSvg(code, cx, cy, sz * r0, hw, spanX, spanY, fill, color ? ` stroke="${color}"` : inkStroke));
        } else {
          parts.push(dotElement(g, screen, cx, cy, sz * r0, fill));
        }
      }
    }
    parts.push('</g>');
  }
  parts.push('</svg>');
  return parts.join('\n');
}
