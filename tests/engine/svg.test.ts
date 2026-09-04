import { describe, expect, it } from 'vitest';
import type { RGBAFrame } from '@/engine';
import { frameToRects, frameToSvg } from '@/ui/export/svg';

/** 按 `pick(x, y)` 生成一帧；返回 [r,g,b,a]，a 省略为 255 */
function frameOf(width: number, height: number, pick: (x: number, y: number) => number[]): RGBAFrame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = pick(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { width, height, data };
}

describe('当前帧 → SVG', () => {
  it('整块实色合并成一个矩形', () => {
    const rects = frameToRects(frameOf(8, 6, () => [0x11, 0x22, 0x33]));
    expect(rects).toHaveLength(1);
    expect(rects[0]).toMatchObject({ x: 0, y: 0, width: 8, height: 6, color: 0x112233 });
  });

  it('横竖都对齐的同色块并成一个矩形，不是一像素一个', () => {
    // 左半黑右半白，4×4
    const rects = frameToRects(frameOf(4, 4, (x) => (x < 2 ? [0, 0, 0] : [255, 255, 255])));
    expect(rects).toHaveLength(2);
    expect(rects.map((r) => [r.x, r.y, r.width, r.height])).toEqual(
      expect.arrayContaining([
        [0, 0, 2, 4],
        [2, 0, 2, 4],
      ]),
    );
  });

  it('上下游程对不齐时各自成矩形', () => {
    // 第 0 行整行黑，第 1 行只有左边一格黑
    const rects = frameToRects(frameOf(2, 2, (x, y) => (y === 0 || x === 0 ? [0, 0, 0] : [255, 255, 255])));
    expect(rects).toHaveLength(3);
    expect(rects.every((r) => r.height === 1)).toBe(true);
  });

  it('2×2 棋盘：4 个 1×1 矩形，一格都不会漏', () => {
    const rects = frameToRects(frameOf(2, 2, (x, y) => ((x + y) % 2 === 0 ? [0, 0, 0] : [255, 255, 255])));
    expect(rects).toHaveLength(4);
    expect(rects.reduce((s, r) => s + r.width * r.height, 0)).toBe(4);
  });

  it('全透明的像素不出图形', () => {
    const rects = frameToRects(frameOf(4, 1, (x) => (x < 2 ? [0, 0, 0, 0] : [255, 0, 0])));
    expect(rects).toHaveLength(1);
    expect(rects[0]).toMatchObject({ x: 2, y: 0, width: 2, height: 1, color: 0xff0000 });
  });

  it('SVG 带正确的画布尺寸，同色并进一条 path，面积最大的那色铺成底色', () => {
    // 8×8 白底，中间 2×2 一块黑
    const svg = frameToSvg(frameOf(8, 8, (x, y) => (x >= 3 && x < 5 && y >= 3 && y < 5 ? [0, 0, 0] : [255, 255, 255])));
    expect(svg).toContain('width="8" height="8" viewBox="0 0 8 8"');
    expect(svg).toContain('<rect width="8" height="8" fill="#FFFFFF"/>');
    expect(svg).toContain('<path fill="#000000" d="M3 3h2v2h-2z"/>');
    // 白色已经是底色，不再单独出 path
    expect(svg.match(/<path/g)).toHaveLength(1);
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('有透明像素时不铺底色，免得把透明处填上', () => {
    const svg = frameToSvg(frameOf(4, 4, (x) => (x < 2 ? [255, 255, 255, 0] : [0, 0, 0])));
    expect(svg).not.toContain('<rect');
    expect(svg).toContain('<path fill="#000000"');
  });

  it('同一种颜色的多个矩形并进同一条 path', () => {
    // 四角红、其余绿
    const corner = (x: number, y: number) => (x === 0 || x === 3) && (y === 0 || y === 3);
    const svg = frameToSvg(frameOf(4, 4, (x, y) => (corner(x, y) ? [255, 0, 0] : [0, 255, 0])));
    const paths = svg.match(/<path/g) ?? [];
    expect(paths).toHaveLength(1);
    expect(svg).toContain('fill="#FF0000"');
    expect((svg.match(/M\d+ \d+h/g) ?? []).length).toBe(4);
  });
});
