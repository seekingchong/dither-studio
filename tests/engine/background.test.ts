import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FORCED_BG,
  Pipeline,
  backgroundMask,
  backgroundTarget,
  borderMedianColor,
  erodeMask,
  forceBackgroundGray,
  isLightBackground,
  pixelate,
  renderImage,
  toGray,
  type ForcedBackgroundOptions,
  type RGBAFrame,
} from '@/engine';
import { defaultParams, type Params } from '@/params';
import { makeFrame } from './helpers';

const W = 64;
const H = 36;
const CX = 24;
const CY = 18;
const R = 12;

/** 球心距离的平方（以半径为单位） */
const ballD2 = (x: number, y: number) => ((x - CX) / R) ** 2 + ((y - CY) / R) ** 2;

/** 白底（可带淡渐变）上一个有高光、中间调、暗部的球；dark 时整张反相成黑底 */
function ballScene(opts: { dark?: boolean; gradient?: number } = {}): RGBAFrame {
  const gradient = opts.gradient ?? 0.06;
  return makeFrame(W, H, (x, y) => {
    let v = 1 - gradient * (x / (W - 1));
    const dx = (x - CX) / R;
    const dy = (y - CY) / R;
    const d2 = dx * dx + dy * dy;
    if (d2 <= 1) {
      const nz = Math.sqrt(1 - d2);
      const l = [-0.5, -0.6, 0.62];
      const ln = Math.hypot(l[0], l[1], l[2]);
      const ndl = Math.max(0, (dx * l[0] + dy * l[1] + nz * l[2]) / ln);
      v = Math.min(1, 0.08 + 0.55 * ndl + 1.2 * Math.pow(ndl, 40));
    }
    if (opts.dark) v = 1 - v;
    const c = Math.round(v * 255);
    return [c, c, c];
  });
}

const opts = (o: Partial<ForcedBackgroundOptions> = {}): ForcedBackgroundOptions => ({ ...DEFAULT_FORCED_BG, enabled: true, ...o });

/** 球内亮度接近背景色的格子：高光（亮底）或暗部里最黑的一块（黑底） */
function highlightCells(frame: RGBAFrame, dark = false): number[] {
  const out: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = frame.data[(y * W + x) * 4] / 255;
      if (ballD2(x, y) <= 1 && (dark ? v <= 0.05 : v >= 0.95)) out.push(y * W + x);
    }
  }
  return out;
}

describe('强制背景蒙版', () => {
  it('亮底：背景在蒙版内，球体连同同色的高光都不在', () => {
    const scene = ballScene();
    const mask = backgroundMask(pixelate(scene, 1, 'box'), opts());
    expect(highlightCells(scene).length).toBeGreaterThan(5);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d2 = ballD2(x, y);
        if (d2 <= 0.9) expect(mask[y * W + x], `球内 ${x},${y}`).toBe(0);
        if (d2 >= 1.3) expect(mask[y * W + x], `背景 ${x},${y}`).toBe(1);
      }
    }
  });

  it('黑底一样：蒙版与亮底完全相同，极性自动判为暗底', () => {
    const light = ballScene();
    const dark = ballScene({ dark: true });
    const lightRgb = pixelate(light, 1, 'box');
    const darkRgb = pixelate(dark, 1, 'box');
    const lightMask = backgroundMask(lightRgb, opts());
    const darkMask = backgroundMask(darkRgb, opts());
    expect(darkMask).toEqual(lightMask);
    for (const i of highlightCells(dark, true)) expect(darkMask[i]).toBe(0);
    expect(isLightBackground(toGray(lightRgb, 'bt709', true).data, lightMask)).toBe(true);
    expect(isLightBackground(toGray(darkRgb, 'bt709', true).data, darkMask)).toBe(false);
  });

  it('淡渐变的背景仍连成一片', () => {
    const mask = backgroundMask(pixelate(ballScene({ gradient: 0.15 }), 1, 'box'), opts());
    let missing = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (ballD2(x, y) >= 1.3 && !mask[y * W + x]) missing++;
    expect(missing).toBe(0);
  });

  it('边缘留白把蒙版从主体四周向内收缩', () => {
    const rgb = pixelate(ballScene(), 1, 'box');
    const plain = backgroundMask(rgb, opts());
    const padded = backgroundMask(rgb, opts({ margin: 2 }));
    const beside = CY * W + CX + R + 1;
    expect(plain[beside]).toBe(1);
    expect(padded[beside]).toBe(0);
    expect(padded[0]).toBe(1);
    const count = (m: Uint8Array) => m.reduce((s, v) => s + v, 0);
    expect(count(padded)).toBeLessThan(count(plain));
  });

  it('全图同色模式不看连通性，高光也会被算成背景', () => {
    const scene = ballScene();
    const mask = backgroundMask(pixelate(scene, 1, 'box'), opts({ scope: 'all' }));
    for (const i of highlightCells(scene)) expect(mask[i]).toBe(1);
  });

  it('手动参考色偏离背景时不选中任何格子', () => {
    const mask = backgroundMask(pixelate(ballScene(), 1, 'box'), opts({ reference: 'manual', color: [1, 0, 0] }));
    expect(mask.every((v) => v === 0)).toBe(true);
  });

  it('自动参考色取画面边缘的中位色，主体碰到边缘也不受影响', () => {
    const frame = makeFrame(20, 10, (x, y) => (x < 8 && y > 5 ? [0, 0, 0] : [240, 250, 255]));
    const [r, g, b] = borderMedianColor(pixelate(frame, 1, 'box'));
    expect([r, g, b].map((v) => Math.round(v * 255))).toEqual([240, 250, 255]);
  });

  it('erodeMask 按方形窗口收缩', () => {
    const mask = new Uint8Array(25).fill(1);
    mask[12] = 0;
    const out = erodeMask(mask, 5, 5, 1);
    const rows = Array.from({ length: 5 }, (_, y) => Array.from(out.slice(y * 5, y * 5 + 5)).join(''));
    expect(rows).toEqual(['11111', '10001', '10001', '10001', '11111']);
    expect(erodeMask(mask, 5, 5, 0)).toBe(mask);
  });

  it('目标亮度：1-bit 是 1 − 密度（亮底）或密度（暗底），多级时点用相邻一级', () => {
    expect(backgroundTarget(true, 0.25, 2)).toBeCloseTo(0.75);
    expect(backgroundTarget(false, 0.25, 2)).toBeCloseTo(0.25);
    expect(backgroundTarget(true, 1, 2)).toBeCloseTo(0);
    expect(backgroundTarget(true, 0.25, 4)).toBeCloseTo(1 - 0.25 / 3);
    expect(backgroundTarget(false, 0.5, 4)).toBeCloseTo(0.5 / 3);
  });

  it('forceBackgroundGray 只动蒙版内的格子，强度按比例靠拢', () => {
    const gray = { width: 4, height: 1, data: new Float32Array([1, 1, 0.2, 0.5]) };
    const mask = new Uint8Array([1, 0, 1, 0]);
    expect(Array.from(forceBackgroundGray(gray, mask, 0.75, 1).data)).toEqual([0.75, 1, 0.75, 0.5]);
    const half = forceBackgroundGray(gray, mask, 0.6, 0.5).data;
    expect(half[0]).toBeCloseTo(0.8);
    expect(half[2]).toBeCloseTo(0.4);
    expect(half[1]).toBe(1);
  });
});

/** 与画布尺寸同宽高、像素尺寸 1，Bayer 2×2 单色 */
function sceneParams(extra: Partial<Params> = {}): Params {
  return { ...defaultParams(), 'canvas.width': W, 'canvas.height': H, 'pixel.size': 1, 'canvas.fit': 'native', 'tone.bg.enabled': true, ...extra };
}

const isDark = (out: RGBAFrame, x: number, y: number) => out.data[(y * W + x) * 4] < 128;

/** 远离球体的 2×2 块里暗格子的个数分布 */
function farBlockDarkCounts(out: RGBAFrame): Set<number> {
  const counts = new Set<number>();
  for (let y = 0; y + 1 < H; y += 2) {
    for (let x = 0; x + 1 < W; x += 2) {
      if (ballD2(x, y) < 1.6 || ballD2(x + 1, y + 1) < 1.6) continue;
      let dark = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (isDark(out, x + dx, y + dy)) dark++;
      counts.add(dark);
    }
  }
  return counts;
}

function expectBallUnchanged(a: RGBAFrame, b: RGBAFrame) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (ballD2(x, y) > 0.85) continue;
      const i = (y * W + x) * 4;
      expect(Array.from(a.data.slice(i, i + 3)), `球内 ${x},${y}`).toEqual(Array.from(b.data.slice(i, i + 3)));
    }
  }
}

describe('强制背景（流水线）', () => {
  it('白底黑球：背景每 2×2 恰有一个暗点，球体一格不变', () => {
    const scene = ballScene();
    const off = renderImage(scene, sceneParams({ 'tone.bg.enabled': false }));
    const on = renderImage(scene, sceneParams());
    // 关闭时纯白处一个点都没有（淡渐变处会有零星的点）；打开后每块恰好一个
    expect(farBlockDarkCounts(off).has(0)).toBe(true);
    expect(farBlockDarkCounts(on)).toEqual(new Set([1]));
    expectBallUnchanged(off, on);
  });

  it('黑底白球：极性自动翻转，背景每 2×2 恰有一个亮点', () => {
    const scene = ballScene({ dark: true });
    const off = renderImage(scene, sceneParams({ 'tone.bg.enabled': false }));
    const on = renderImage(scene, sceneParams());
    expect(farBlockDarkCounts(off)).toEqual(new Set([4]));
    expect(farBlockDarkCounts(on)).toEqual(new Set([3]));
    expectBallUnchanged(off, on);
  });

  it('密度 50 是棋盘，锁定极性后深底也放暗点', () => {
    const light = renderImage(ballScene(), sceneParams({ 'tone.bg.density': 50 }));
    expect(farBlockDarkCounts(light)).toEqual(new Set([2]));
    const forcedLight = renderImage(ballScene({ dark: true }), sceneParams({ 'tone.bg.polarity': 'light' }));
    expect(farBlockDarkCounts(forcedLight)).toEqual(new Set([1]));
  });

  it('阈值滑块不改变背景点密度', () => {
    const out = renderImage(ballScene(), sceneParams({ 'tone.threshold': 80 }));
    expect(farBlockDarkCounts(out)).toEqual(new Set([1]));
  });

  it('强度 0 等于没开', () => {
    const scene = ballScene();
    const off = renderImage(scene, sceneParams({ 'tone.bg.enabled': false }));
    const zero = renderImage(scene, sceneParams({ 'tone.bg.strength': 0 }));
    expect(zero.data).toEqual(off.data);
  });

  it.each([
    ['palette', { 'color.mode': 'palette', 'color.palette.preset': 'gray4' }],
    ['channels', { 'color.mode': 'channels', 'color.levels': 2 }],
    ['cmyk', { 'color.mode': 'channels', 'color.channels.space': 'cmyk', 'color.levels': 2 }],
    ['gray4', { 'color.mode': 'gray', 'color.levels': 4 }],
  ] as const)('%s 路径同样只改背景', (_name, extra) => {
    const scene = ballScene();
    const off = renderImage(scene, sceneParams({ ...extra, 'tone.bg.enabled': false }));
    const on = renderImage(scene, sceneParams(extra));
    expectBallUnchanged(off, on);
    let changed = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (ballD2(x, y) >= 1.6 && off.data[(y * W + x) * 4] !== on.data[(y * W + x) * 4]) changed++;
    expect(changed).toBeGreaterThan(50);
  });

  it('缓存：开关只重算蒙版与抖动及下游，改密度不重算蒙版', () => {
    const p = new Pipeline();
    const scene = ballScene();
    p.run(scene, 'a', sceneParams({ 'tone.bg.enabled': false }));
    p.run(scene, 'a', sceneParams());
    expect(p.lastStats.recomputed).toEqual(['background', 'dither:ordered/bayer2', 'color', 'render']);
    p.run(scene, 'a', sceneParams({ 'tone.bg.density': 50 }));
    expect(p.lastStats.recomputed).toEqual(['dither:ordered/bayer2', 'color', 'render']);
    p.run(scene, 'a', sceneParams({ 'tone.bg.density': 50, 'tone.contrast': 20 }));
    expect(p.lastStats.recomputed).toEqual(['tone', 'gray', 'dither:ordered/bayer2', 'color', 'render']);
  });
});
