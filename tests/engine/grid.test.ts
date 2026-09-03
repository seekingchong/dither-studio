import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID, Pipeline, renderCells, renderGrid, type CellFrame } from '@/engine';
import { defaultParams } from '@/params';
import { makeFrame } from './helpers';

/** 2×2 格子：左上黑、其余白 */
function cells(): CellFrame {
  const data = new Uint8ClampedArray(2 * 2 * 4).fill(255);
  data[0] = data[1] = data[2] = 0;
  return { width: 2, height: 2, data };
}

const px = (f: { width: number; data: Uint8ClampedArray }, x: number, y: number) => {
  const i = (y * f.width + x) * 4;
  return [f.data[i], f.data[i + 1], f.data[i + 2]];
};

describe('renderGrid', () => {
  it('默认选项等价于最近邻放大', () => {
    const c = cells();
    const a = renderGrid(c, 16, 16, 8, 0, 0, DEFAULT_GRID);
    const b = renderCells(c, 16, 16, 8, 0, 0);
    expect(a.data).toEqual(b.data);
  });

  it('欧几里得网点：中心是墨色，角落是纸色', () => {
    const out = renderGrid(cells(), 16, 16, 8, 0, 0, { ...DEFAULT_GRID, dot: 'euclidean', dotSize: 1 });
    expect(px(out, 4, 4)).toEqual([0, 0, 0]);
    expect(px(out, 0, 0)).toEqual([255, 255, 255]);
    expect(px(out, 7, 7)).toEqual([255, 255, 255]);
    // 白格子不画点，仍是纸色
    expect(px(out, 12, 12)).toEqual([255, 255, 255]);
  });

  it('圆方网点比圆点更接近角落', () => {
    const round = renderGrid(cells(), 16, 16, 8, 0, 0, { ...DEFAULT_GRID, dot: 'euclidean', dotSize: 1 });
    const rs = renderGrid(cells(), 16, 16, 8, 0, 0, { ...DEFAULT_GRID, dot: 'roundsquare', dotSize: 1 });
    let roundInk = 0;
    let rsInk = 0;
    for (let i = 0; i < round.data.length; i += 4) {
      if (round.data[i] === 0) roundInk++;
      if (rs.data[i] === 0) rsInk++;
    }
    expect(rsInk).toBeGreaterThan(roundInk);
  });

  it('反向：背景为墨色，亮格子画成亮点', () => {
    const out = renderGrid(cells(), 16, 16, 8, 0, 0, { ...DEFAULT_GRID, dot: 'euclidean', invert: true });
    expect(px(out, 0, 0)).toEqual([0, 0, 0]);
    expect(px(out, 12, 12)).toEqual([255, 255, 255]);
    expect(px(out, 4, 4)).toEqual([0, 0, 0]);
  });

  it('间距在格子边缘留出背景', () => {
    const out = renderGrid(cells(), 16, 16, 8, 0, 0, { ...DEFAULT_GRID, gapX: 4, gapY: 2 });
    expect(px(out, 0, 4)).toEqual([255, 255, 255]);
    expect(px(out, 1, 4)).toEqual([255, 255, 255]);
    expect(px(out, 2, 4)).toEqual([0, 0, 0]);
    expect(px(out, 4, 0)).toEqual([255, 255, 255]);
    expect(px(out, 4, 1)).toEqual([0, 0, 0]);
  });

  it('随明暗缩放：中灰格子的点更小', () => {
    const data = new Uint8ClampedArray(1 * 1 * 4);
    data[0] = data[1] = data[2] = 128;
    data[3] = 255;
    const mid: CellFrame = { width: 1, height: 1, data };
    const full = renderGrid(mid, 16, 16, 16, 0, 0, { ...DEFAULT_GRID, dot: 'euclidean', dotSize: 1 });
    const scaled = renderGrid(mid, 16, 16, 16, 0, 0, { ...DEFAULT_GRID, dot: 'euclidean', dotSize: 1, dotTone: true });
    const count = (f: { data: Uint8ClampedArray }) => {
      let n = 0;
      for (let i = 0; i < f.data.length; i += 4) if (f.data[i] === 128) n++;
      return n;
    };
    expect(count(scaled)).toBeGreaterThan(0);
    expect(count(scaled)).toBeLessThan(count(full));
  });

  it('点融合把相邻的两个墨格连起来', () => {
    const data = new Uint8ClampedArray(3 * 1 * 4).fill(255);
    data[0] = data[1] = data[2] = 0;
    data[4] = data[5] = data[6] = 0;
    const two: CellFrame = { width: 3, height: 1, data };
    const separate = renderGrid(two, 24, 8, 8, 0, 0, { ...DEFAULT_GRID, dot: 'euclidean', dotSize: 0.7 });
    const merged = renderGrid(two, 24, 8, 8, 0, 0, { ...DEFAULT_GRID, dot: 'euclidean', dotSize: 0.7, metaball: true, metaballRadius: 1.2 });
    // 两个圆之间的像素 (8, 4)：不融合时是纸色，融合后是墨色
    expect(px(separate, 8, 1)).toEqual([255, 255, 255]);
    expect(px(merged, 8, 4)).toEqual([0, 0, 0]);
    // 远离墨格的地方仍是纸色
    expect(px(merged, 22, 4)).toEqual([255, 255, 255]);
  });

  it('连线背景在每行中心画一根线，网格点背景在每格中心画图形', () => {
    const lines = renderGrid(cells(), 16, 16, 8, 0, 0, { ...DEFAULT_GRID, dot: 'euclidean', dotSize: 0.5, background: 'lines', lineWidth: 2, bgColor: [10, 20, 30] });
    expect(px(lines, 14, 4)).toEqual([10, 20, 30]);
    expect(px(lines, 14, 1)).toEqual([255, 255, 255]);
    const cols = renderGrid(cells(), 16, 16, 8, 0, 0, { ...DEFAULT_GRID, dot: 'euclidean', dotSize: 0.5, background: 'lines', lineDirection: 'col', lineWidth: 2, bgColor: [10, 20, 30] });
    expect(px(cols, 12, 14)).toEqual([10, 20, 30]);
    expect(px(cols, 9, 14)).toEqual([255, 255, 255]);
    const dots = renderGrid(cells(), 16, 16, 8, 0, 0, { ...DEFAULT_GRID, dot: 'euclidean', dotSize: 0.5, background: 'dots', bgDotShape: 'square', bgDotSize: 0.5, bgColor: [10, 20, 30] });
    expect(px(dots, 12, 12)).toEqual([10, 20, 30]);
    expect(px(dots, 8, 8)).toEqual([255, 255, 255]);
    // 墨点盖在背景之上
    expect(px(dots, 4, 4)).toEqual([0, 0, 0]);
    // 小尺寸十字至少有 1px 的臂
    const cross = renderGrid(cells(), 20, 20, 10, 0, 0, { ...DEFAULT_GRID, dot: 'euclidean', dotSize: 0.5, background: 'dots', bgDotShape: 'cross', bgDotSize: 0.3, bgColor: [10, 20, 30] });
    let hits = 0;
    for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) if (px(cross, x, y)[0] === 10) hits++;
    expect(hits).toBeGreaterThanOrEqual(3);
  });
});

describe('流水线网格阶段', () => {
  it('改网格参数只重算渲染', () => {
    const p = new Pipeline();
    const src = makeFrame(64, 40, (x) => [x * 4, x * 4, x * 4]);
    const params = { ...defaultParams(), 'canvas.width': 32, 'canvas.height': 20, 'pixel.size': 4 };
    p.run(src, 'a', params);
    p.run(src, 'a', { ...params, 'grid.dot': 'euclidean' });
    expect(p.lastStats.recomputed).toEqual(['render']);
    p.run(src, 'a', { ...params, 'grid.dot': 'euclidean', 'grid.background': 'lines' });
    expect(p.lastStats.recomputed).toEqual(['render']);
  });

  it('Tint 下反向网点背景用暗色', () => {
    const src = makeFrame(64, 40, () => [255, 255, 255]);
    const params = { ...defaultParams(), 'canvas.width': 32, 'canvas.height': 20, 'pixel.size': 4, 'color.tint.dark': '#112233', 'grid.dot': 'euclidean', 'grid.invert': true, 'grid.dotSize': 50 };
    const out = new Pipeline().run(src, 'a', params);
    expect(px(out, 0, 0)).toEqual([17, 34, 51]);
    expect(px(out, 2, 2)).toEqual([255, 255, 255]);
  });
});
