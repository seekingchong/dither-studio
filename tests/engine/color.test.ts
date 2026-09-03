import { describe, expect, it } from 'vitest';
import { defaultParams, type ParamValue } from '@/params';
import {
  PALETTE_PRESETS,
  Pipeline,
  applyAccent,
  buildLevelPalette,
  buildPalette,
  cmykToRgb,
  combineChannels,
  errorDiffuseColor,
  findAlgorithm,
  KERNELS,
  mapLevels,
  parseAccentColors,
  parseColorList,
  renderImage,
  resolvePalette,
  rgbToCmyk,
  sampleRamp,
  thresholdDitherColor,
  type CellFrame,
  type ColorDitherInput,
  type LevelFrame,
} from '@/engine';
import { makeFrame } from './helpers';

const HEX = /^#[0-9A-F]{6}$/;

function flatColorInput(width: number, height: number, rgb: [number, number, number], paletteHex: string[]): ColorDitherInput {
  const data = new Float32Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    data[i * 3] = rgb[0];
    data[i * 3 + 1] = rgb[1];
    data[i * 3 + 2] = rgb[2];
  }
  return { width, height, rgb: data, palette: buildPalette(paletteHex), seed: 1 };
}

function colorSet(frame: { data: Uint8ClampedArray }, stride = 4): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < frame.data.length; i += stride) set.add(`${frame.data[i]},${frame.data[i + 1]},${frame.data[i + 2]}`);
  return set;
}

describe('调色板', () => {
  it('预设覆盖 PRD 列表且颜色合法、无重复', () => {
    const ids = PALETTE_PRESETS.map((p) => p.id);
    for (const id of ['gameboy', 'gameboy-pocket', 'cga0', 'cga1', 'ega', 'c64', 'zx', 'nes', 'pico8', 'db16', 'db32', 'apple2', 'mac', 'websafe', 'gray4', 'gray8', 'gray16']) {
      expect(ids).toContain(id);
    }
    for (const p of PALETTE_PRESETS) {
      expect(new Set(p.colors).size).toBe(p.colors.length);
      for (const c of p.colors) expect(c).toMatch(HEX);
    }
    expect(PALETTE_PRESETS.find((p) => p.id === 'websafe')!.colors.length).toBe(216);
    expect(PALETTE_PRESETS.find((p) => p.id === 'db32')!.colors.length).toBe(32);
  });

  it('按亮度排序并给出最近色', () => {
    const p = buildPalette(['#FFFFFF', '#000000', '#FF0000']);
    expect(p.size).toBe(3);
    expect(p.luminance[0]).toBeLessThan(p.luminance[1]);
    expect(p.luminance[1]).toBeLessThan(p.luminance[2]);
    expect(p.nearest(0.9, 0.1, 0.1)).toBe(1);
    expect(p.nearest(0.05, 0.05, 0.05)).toBe(0);
    expect(p.nearest(0.95, 0.95, 0.95)).toBe(2);
  });

  it('Web Safe 快速路径与暴力搜索一致', () => {
    const p = resolvePalette('websafe', '');
    const brute = buildPalette(['#000000', '#FFFFFF']);
    void brute;
    const colors = p.colors;
    for (const [r, g, b] of [
      [0.13, 0.47, 0.91],
      [0.33, 0.66, 0.24],
      [0.05, 0.95, 0.52],
    ]) {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < p.size; i++) {
        const dr = r - colors[i * 3];
        const dg = g - colors[i * 3 + 1];
        const db = b - colors[i * 3 + 2];
        const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      expect(p.nearest(r, g, b)).toBe(best);
    }
  });

  it('解析颜色列表与自定义调色板', () => {
    expect(parseColorList('#fff, 000 #FF6200:2\n#abc')).toEqual(['#FFFFFF', '#000000', '#FF6200', '#AABBCC']);
    expect(resolvePalette('custom', '#111111').size).toBe(2);
    expect(resolvePalette('custom', '#111111 #eeeeee #888888').size).toBe(3);
    expect(resolvePalette('nope', '').size).toBe(4);
  });
});

describe('颜色映射', () => {
  const p = resolvePalette('gameboy', '');
  const base = { linear: false, tintDark: '#000000', tintLight: '#FFFFFF', tintStops: [] as string[], palette: p, mismatch: false, channelSpace: 'rgb' as const };

  it('灰阶 N 级均匀，线性模式下显示值转回 sRGB', () => {
    const lut = buildLevelPalette({ ...base, mode: 'gray', levels: 4 });
    expect(Array.from(lut)).toEqual([0, 0, 0, 85, 85, 85, 170, 170, 170, 255, 255, 255]);
    const lin = buildLevelPalette({ ...base, mode: 'gray', levels: 3, linear: true });
    expect(lin[3]).toBeGreaterThan(170);
  });

  it('Tint 色带经过中间站点', () => {
    expect(sampleRamp([[0, 0, 0], [255, 0, 0], [255, 255, 255]], 0.5)).toEqual([255, 0, 0]);
    const lut = buildLevelPalette({ ...base, mode: 'tint', levels: 3, tintStops: ['#FF0000'] });
    expect(Array.from(lut.slice(3, 6))).toEqual([255, 0, 0]);
    const duo = buildLevelPalette({ ...base, mode: 'tint', levels: 2, tintDark: '#112233', tintLight: '#FFEEDD' });
    expect(Array.from(duo)).toEqual([17, 34, 51, 255, 238, 221]);
  });

  it('深度错配按索引回绕到调色板', () => {
    const lut = buildLevelPalette({ ...base, mode: 'palette', levels: 6, mismatch: true });
    expect(Array.from(lut.slice(0, 3))).toEqual(Array.from(lut.slice(12, 15)));
  });

  it('mapLevels 使用查找表', () => {
    const frame: LevelFrame = { width: 2, height: 1, levels: 2, data: new Uint8Array([0, 1]) };
    const out = mapLevels(frame, new Uint8ClampedArray([1, 2, 3, 4, 5, 6]));
    expect(Array.from(out.data)).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
  });

  it('CMYK 往返', () => {
    for (const [r, g, b] of [
      [0.2, 0.6, 0.9],
      [1, 1, 1],
      [0, 0, 0],
      [0.5, 0.5, 0.5],
    ]) {
      const [c, m, y, k] = rgbToCmyk(r, g, b);
      const back = cmykToRgb(c, m, y, k);
      expect(back[0]).toBeCloseTo(r, 5);
      expect(back[1]).toBeCloseTo(g, 5);
      expect(back[2]).toBeCloseTo(b, 5);
    }
  });

  it('分通道 RGB 2 级合成 8 种颜色', () => {
    const mk = (bits: number[]) => ({ width: 8, height: 1, levels: 2, data: Uint8Array.from(bits) });
    const r = mk([0, 1, 0, 1, 0, 1, 0, 1]);
    const g = mk([0, 0, 1, 1, 0, 0, 1, 1]);
    const b = mk([0, 0, 0, 0, 1, 1, 1, 1]);
    const out = combineChannels([r, g, b], 'rgb', false);
    expect(colorSet(out).size).toBe(8);
    expect(Array.from(out.data.slice(4, 8))).toEqual([255, 0, 0, 255]);
  });
});

describe('真彩量化路径', () => {
  it('纯色输入在误差扩散下稳定落到最近色', () => {
    const input = flatColorInput(16, 8, [0.1, 0.9, 0.1], ['#000000', '#00FF00', '#FF0000', '#FFFFFF']);
    const out = errorDiffuseColor(input, KERNELS[0], { strength: 1, serpentine: true, clamp: 1, direction: 'ltr' });
    const green = input.palette.nearest(0, 1, 0);
    let count = 0;
    for (const v of out) if (v === green) count++;
    // 残余误差会让少量像素落到别的颜色上，主体仍是最近色
    expect(count / out.length).toBeGreaterThan(0.75);
  });

  it('中间色在两色之间抖动出接近正确的比例', () => {
    const input = flatColorInput(32, 32, [0.25, 0.25, 0.25], ['#000000', '#FFFFFF']);
    const out = errorDiffuseColor(input, KERNELS[0], { strength: 1, serpentine: true, clamp: 1, direction: 'ltr' });
    let light = 0;
    for (const v of out) if (v === 1) light++;
    expect(Math.abs(light / out.length - 0.25)).toBeLessThan(0.05);
    const ordered = thresholdDitherColor(input, (x, y) => ((x + y) % 2) * 0.5 + 0.25, 1);
    let light2 = 0;
    for (const v of ordered) if (v === 1) light2++;
    expect(light2).toBe(0);
  });

  it('流水线 Palette 模式只输出调色板颜色，无颜色路径的算法也能回退', () => {
    const src = makeFrame(64, 40, (x, y) => [x * 4, y * 6, 128]);
    const base = { ...defaultParams(), 'canvas.width': 32, 'canvas.height': 20, 'pixel.size': 1, 'color.mode': 'palette', 'color.palette.preset': 'pico8' };
    const allowed = new Set(PALETTE_PRESETS.find((p) => p.id === 'pico8')!.colors.map((h) => {
      const n = parseInt(h.slice(1), 16);
      return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
    }));
    for (const extra of [
      {},
      { 'dither.family': 'ordered' },
      { 'dither.family': 'halftone' },
      { 'dither.family': 'curve' },
      { 'dither.family': 'search', 'dither.search.method': 'knuth' },
      { 'dither.family': 'search', 'dither.search.method': 'dbs' },
      { 'dither.family': 'threshold', 'dither.threshold.method': 'otsu' },
    ] as Array<Record<string, ParamValue>>) {
      const out = renderImage(src, { ...base, ...extra });
      for (const c of colorSet(out)) expect(allowed.has(c)).toBe(true);
    }
  });

  it('深度错配 N=2 让 16 色调色板只用最暗两色', () => {
    const src = makeFrame(64, 40, (x) => [x * 4, x * 4, x * 4]);
    const params = { ...defaultParams(), 'canvas.width': 32, 'canvas.height': 20, 'pixel.size': 1, 'color.mode': 'palette', 'color.palette.preset': 'pico8', 'color.mismatch': true, 'color.palette.levels': 2 };
    expect(colorSet(renderImage(src, params)).size).toBe(2);
    const p = new Pipeline();
    p.run(src, 'a', params);
    expect(p.lastStats.recomputed.some((s) => s.startsWith('dither:') && !s.endsWith(':palette'))).toBe(true);
  });

  it('Channels 模式输出可分离的通道颜色', () => {
    const src = makeFrame(64, 40, (x, y) => [x * 4, 255 - y * 6, 90]);
    const rgb = renderImage(src, { ...defaultParams(), 'canvas.width': 32, 'canvas.height': 20, 'pixel.size': 1, 'color.mode': 'channels', 'tone.linear': false });
    for (const c of colorSet(rgb)) for (const v of c.split(',')) expect(v === '0' || v === '255').toBe(true);
    const cmyk = renderImage(src, { ...defaultParams(), 'canvas.width': 32, 'canvas.height': 20, 'pixel.size': 1, 'color.mode': 'channels', 'color.channels.space': 'cmyk', 'tone.linear': false });
    expect(colorSet(cmyk).size).toBeGreaterThan(2);
    expect(colorSet(cmyk).size).toBeLessThanOrEqual(16);
  });

  it('灰阶 4 级只出现 4 种灰', () => {
    const src = makeFrame(64, 40, (x) => [x * 4, x * 4, x * 4]);
    const out = renderImage(src, { ...defaultParams(), 'canvas.width': 32, 'canvas.height': 20, 'pixel.size': 1, 'color.mode': 'gray', 'color.levels': 4, 'tone.linear': false });
    expect([...colorSet(out)].sort()).toEqual(['0,0,0', '170,170,170', '255,255,255', '85,85,85']);
  });
});

describe('Accent 层', () => {
  const width = 40;
  const height = 40;
  const levels = new Uint8Array(width * height);
  const gray = new Float32Array(width * height);
  for (let i = 0; i < levels.length; i++) {
    levels[i] = i % width < 20 ? 0 : 1;
    gray[i] = i % width < 20 ? 0.2 : 0.8;
  }
  const cells: CellFrame = { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) };
  const ctx = { width, height, levels, levelCount: 2, gray };
  const base = { enabled: true, colors: parseAccentColors('#FF6200'), density: 0.2, placement: 'random' as const, level: 0, target: 'all' as const, spacing: 0, chain: 0, seed: 1 };
  const accentCount = (frame: CellFrame) => {
    let n = 0;
    for (let i = 0; i < frame.data.length; i += 4) if (frame.data[i] === 255 && frame.data[i + 1] === 98 && frame.data[i + 2] === 0) n++;
    return n;
  };

  it('解析权重颜色', () => {
    const colors = parseAccentColors('#FF6200:2 #004AB8 nope #abc:0');
    expect(colors.length).toBe(3);
    expect(colors[0].weight).toBe(2);
    expect(colors[1].weight).toBe(1);
    expect(colors[2].rgb).toEqual([170, 187, 204]);
  });

  it('密度约等于替换比例，且按种子确定', () => {
    const a = applyAccent(cells, ctx, base);
    const b = applyAccent(cells, ctx, base);
    expect(a.data).toEqual(b.data);
    const ratio = accentCount(a) / (width * height);
    expect(ratio).toBeGreaterThan(0.12);
    expect(ratio).toBeLessThan(0.28);
    expect(applyAccent(cells, ctx, { ...base, enabled: false })).toBe(cells);
  });

  it('目标范围只落在前景或背景', () => {
    const fg = applyAccent(cells, ctx, { ...base, target: 'foreground', density: 1 });
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const j = (y * width + x) * 4;
        const isAccent = fg.data[j + 1] === 98;
        expect(isAccent).toBe(x < 20);
      }
    }
  });

  it('最小间距生效', () => {
    const out = applyAccent(cells, ctx, { ...base, density: 1, spacing: 2 });
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (out.data[(y * width + x) * 4 + 1] !== 98) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (dx === 0 && dy === 0) continue;
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
            expect(out.data[(yy * width + xx) * 4 + 1]).not.toBe(98);
          }
        }
      }
    }
  });

  it('连锁把点延成短线，灰阶档与溢出规则可用', () => {
    const chained = applyAccent(cells, ctx, { ...base, density: 0.05, chain: 0.9 });
    const single = applyAccent(cells, ctx, { ...base, density: 0.05, chain: 0 });
    expect(accentCount(chained)).toBeGreaterThan(accentCount(single));
    const lvl = applyAccent(cells, ctx, { ...base, placement: 'level', level: 1, density: 1 });
    expect(accentCount(lvl)).toBe(width * height / 2);
    const overflow = applyAccent(cells, ctx, { ...base, placement: 'overflow', density: 1 });
    expect(accentCount(overflow)).toBe(0);
    const edge = applyAccent(cells, ctx, { ...base, placement: 'edge', density: 1 });
    expect(accentCount(edge)).toBeGreaterThan(0);
    expect(accentCount(edge)).toBeLessThan(width * height / 4);
  });

  it('流水线里开启 Accent 后出现强调色', () => {
    const src = makeFrame(64, 40, (x) => [x * 4, x * 4, x * 4]);
    const params = { ...defaultParams(), 'canvas.width': 32, 'canvas.height': 20, 'pixel.size': 1, 'color.accent.enabled': true, 'color.accent.density': 30, 'color.accent.target': 'all' };
    const out = renderImage(src, params);
    expect(colorSet(out).has('255,98,0')).toBe(true);
    expect(findAlgorithm('threshold', 'fixed')).toBeDefined();
  });
});
