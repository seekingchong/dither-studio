import type { RGBAFrame } from '../types';

/**
 * 超过这个矩形数就不出了：抖动结果在像素尺寸 1 且用误差扩散时接近噪声，
 * 逐格出矢量会是几十上百万个图形，文件大到打不开，浏览器也会卡死。
 */
export const MAX_RECTS = 300_000;

export interface SvgRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0xRRGGBB */
  color: number;
  /**
   * 合并时的游标：这个矩形最后一次被延长到的行，用来判断下一行还接不接得上。
   * 结果里留着不清，几十万个矩形没必要为了好看再复制一遍。
   */
  endY?: number;
}

interface OpenRect extends SvgRect {
  endY: number;
}

const key = (x: number, x2: number, color: number) => `${x},${x2},${color}`;
const hex = (color: number) => `#${color.toString(16).padStart(6, '0').toUpperCase()}`;

/**
 * 把一帧位图拆成尽量少的实色矩形：先按行做游程，再把上下完全对齐且同色的游程并成一个矩形。
 * 抖动结果本来就是一格一格的实色块（像素尺寸越大块越大），合并之后图形数远少于像素数。
 * 全透明的像素不出图形，SVG 那块就是透明的。
 */
export function frameToRects(frame: RGBAFrame): SvgRect[] {
  const { width, height, data } = frame;
  const rects: SvgRect[] = [];
  let open = new Map<string, OpenRect>();

  for (let y = 0; y < height; y++) {
    const row = new Map<string, OpenRect>();
    let x = 0;
    while (x < width) {
      const i = (y * width + x) * 4;
      const a = data[i + 3];
      if (a === 0) {
        x++;
        continue;
      }
      const color = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      let x2 = x + 1;
      while (x2 < width) {
        const j = (y * width + x2) * 4;
        if (data[j + 3] === 0 || ((data[j] << 16) | (data[j + 1] << 8) | data[j + 2]) !== color) break;
        x2++;
      }
      const k = key(x, x2, color);
      const carried = open.get(k);
      if (carried && carried.endY === y) {
        carried.height++;
        carried.endY = y + 1;
        row.set(k, carried);
      } else {
        row.set(k, { x, y, width: x2 - x, height: 1, color, endY: y + 1 });
      }
      x = x2;
    }
    // 这一行没接上的，说明到头了，收进结果
    for (const [k, rect] of open) if (row.get(k) !== rect) rects.push(rect);
    open = row;
    if (rects.length > MAX_RECTS) break;
  }
  for (const rect of open.values()) rects.push(rect);
  return rects;
}

/**
 * 一帧 → SVG。同色的矩形并进一条 path（`M x y h w v h h -w z` 一个子路径一个矩形），
 * 十几种颜色就只有十几个节点，比一个矩形一个 `<rect>` 小一个数量级。
 * 面积最大的那种颜色改用一整块底色打底，其余画在上面——前提是没有透明像素。
 */
export function frameToSvg(frame: RGBAFrame): string {
  const rects = frameToRects(frame);
  if (rects.length > MAX_RECTS) {
    throw new Error(`当前设置下要画 ${rects.length} 个以上图形，SVG 会大到打不开；把「像素尺寸」调大一些再试`);
  }

  const areaByColor = new Map<number, number>();
  let covered = 0;
  for (const r of rects) {
    const area = r.width * r.height;
    covered += area;
    areaByColor.set(r.color, (areaByColor.get(r.color) ?? 0) + area);
  }

  // 有透明像素时不能拿底色铺满，否则会把透明的地方填上
  let background: number | null = null;
  if (covered === frame.width * frame.height) {
    let best = -1;
    for (const [color, area] of areaByColor) {
      if (area > best) {
        best = area;
        background = color;
      }
    }
  }

  const byColor = new Map<number, string[]>();
  for (const r of rects) {
    if (r.color === background) continue;
    const path = byColor.get(r.color);
    const d = `M${r.x} ${r.y}h${r.width}v${r.height}h${-r.width}z`;
    if (path) path.push(d);
    else byColor.set(r.color, [d]);
  }

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}" shape-rendering="crispEdges">`,
  ];
  if (background !== null) parts.push(`<rect width="${frame.width}" height="${frame.height}" fill="${hex(background)}"/>`);
  for (const [color, paths] of byColor) parts.push(`<path fill="${hex(color)}" d="${paths.join('')}"/>`);
  parts.push('</svg>');
  return parts.join('\n');
}
