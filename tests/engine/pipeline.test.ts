import { describe, expect, it } from 'vitest';
import { defaultParams } from '@/params';
import { Pipeline, renderImage } from '@/engine';
import { asciiLevels, makeFrame } from './helpers';

function gradientSource() {
  return makeFrame(64, 40, (x) => {
    const v = Math.round((x / 63) * 255);
    return [v, v, v];
  });
}

function smallParams() {
  return { ...defaultParams(), 'canvas.width': 32, 'canvas.height': 20, 'pixel.size': 2 };
}

describe('Pipeline', () => {
  it('输出画布尺寸且全部不透明', () => {
    const out = renderImage(gradientSource(), smallParams());
    expect(out.width).toBe(32);
    expect(out.height).toBe(20);
    for (let i = 3; i < out.data.length; i += 4) expect(out.data[i]).toBe(255);
  });

  it('单色两端颜色可调，结果只出现这两种颜色', () => {
    const params = { ...smallParams(), 'color.mode': 'mono', 'color.tint.dark': '#112233', 'color.tint.light': '#FFEEDD' };
    const out = renderImage(gradientSource(), params);
    const colors = new Set<string>();
    for (let i = 0; i < out.data.length; i += 4) colors.add(`${out.data[i]},${out.data[i + 1]},${out.data[i + 2]}`);
    expect([...colors].sort()).toEqual(['17,34,51', '255,238,221']);
  });

  it('参数未变时全部命中缓存，输出仍是新副本', () => {
    const p = new Pipeline();
    const src = gradientSource();
    const first = p.run(src, 'a', smallParams());
    expect(p.lastStats.recomputed).toContain('fit');
    expect(p.lastStats.recomputed).toContain('dither:ordered/bayer2');
    expect(p.lastStats.recomputed).toContain('render');
    const second = p.run(src, 'a', smallParams());
    expect(p.lastStats.recomputed).toEqual([]);
    expect(second.data).toEqual(first.data);
    expect(second.data).not.toBe(first.data);
  });

  it('改阈值只重算抖动及下游', () => {
    const p = new Pipeline();
    const src = gradientSource();
    p.run(src, 'a', smallParams());
    p.run(src, 'a', { ...smallParams(), 'tone.threshold': 100 });
    expect(p.lastStats.recomputed).toEqual(['dither:ordered/bayer2', 'color', 'render']);
  });

  it('换源媒体时全部重算', () => {
    const p = new Pipeline();
    p.run(gradientSource(), 'a', smallParams());
    p.run(gradientSource(), 'b', smallParams());
    expect(p.lastStats.recomputed[0]).toBe('fit');
  });

  it('像素尺寸放大后的格子被最近邻铺满', () => {
    const params = { ...smallParams(), 'pixel.size': 4, 'dither.family': 'threshold' };
    const out = renderImage(gradientSource(), params);
    // 每 4×4 块内颜色一致
    for (let y = 0; y < 20; y += 4) {
      for (let x = 0; x < 32; x += 4) {
        const base = (y * 32 + x) * 4;
        for (let dy = 0; dy < 4; dy++) {
          for (let dx = 0; dx < 4; dx++) {
            const i = ((y + dy) * 32 + x + dx) * 4;
            expect(out.data[i]).toBe(out.data[base]);
          }
        }
      }
    }
  });

  it.each([
    ['threshold', {}],
    ['ordered', { 'dither.ordered.matrix': 'bayer4' }],
    ['error-diffusion', {}],
  ])('%s 端到端量化快照', (family, extra) => {
    const p = new Pipeline();
    p.run(gradientSource(), 'a', { ...smallParams(), 'dither.family': family, ...extra });
    expect(asciiLevels(p.currentLevels!)).toMatchSnapshot();
  });
});
