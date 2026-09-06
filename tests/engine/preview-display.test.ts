import { describe, expect, it } from 'vitest';
import { axisWeights, displayGeometry, resample, resampleForDisplay } from '@/engine';

describe('displayGeometry：预览画布的后备存储按屏幕物理像素开', () => {
  it('100%、DPR 1：后备存储就是画布尺寸，放大交给最近邻', () => {
    expect(displayGeometry(1000, 600, 1, 1)).toEqual({ shownWidth: 1000, shownHeight: 600, backingWidth: 1000, backingHeight: 600, mode: 'nearest' });
  });

  it('10%、DPR 1：屏幕只有 100×60 个像素，后备存储就开 100×60，帧按面积平均缩进去', () => {
    expect(displayGeometry(1000, 600, 0.1, 1)).toEqual({ shownWidth: 100, shownHeight: 60, backingWidth: 100, backingHeight: 60, mode: 'area' });
  });

  it('10%、DPR 2：CSS 仍是 100×60，后备存储是 200×120 个物理像素', () => {
    expect(displayGeometry(1000, 600, 0.1, 2)).toEqual({ shownWidth: 100, shownHeight: 60, backingWidth: 200, backingHeight: 120, mode: 'area' });
  });

  it('50%、DPR 2：物理像素正好等于画布像素，一比一贴帧', () => {
    expect(displayGeometry(1000, 600, 0.5, 2)).toEqual({ shownWidth: 500, shownHeight: 300, backingWidth: 1000, backingHeight: 600, mode: 'nearest' });
  });

  it('适应窗口的任意比例也按屏幕像素算', () => {
    const g = displayGeometry(1000, 600, 0.85, 1);
    expect(g.mode).toBe('area');
    expect([g.backingWidth, g.backingHeight]).toEqual([850, 510]);
  });

  it('DPR 1.5 下的 100% 是放大：后备存储保持画布尺寸', () => {
    expect(displayGeometry(1000, 600, 1, 1.5).mode).toBe('nearest');
  });

  it('只要有一个方向的屏幕像素少于画布像素就走面积平均', () => {
    // 1000×601 缩到 0.9995：宽取整后 1000 不缺，高 600.6 → 601 也不缺 → nearest；再小一点就 area
    expect(displayGeometry(1000, 601, 0.9995, 1).mode).toBe('nearest');
    expect(displayGeometry(1000, 601, 0.998, 1).mode).toBe('area');
  });

  it('非法 DPR 当 1，极小画布不会缩成 0', () => {
    expect(displayGeometry(1000, 600, 0.1, 0)).toEqual(displayGeometry(1000, 600, 0.1, 1));
    expect(displayGeometry(1000, 600, 0.1, Number.NaN)).toEqual(displayGeometry(1000, 600, 0.1, 1));
    const tiny = displayGeometry(16, 16, 0.05, 1);
    expect([tiny.shownWidth, tiny.shownHeight, tiny.backingWidth, tiny.backingHeight]).toEqual([1, 1, 1, 1]);
  });
});

describe('resampleForDisplay：照浏览器 / GPU 显示大图的方式缩到屏幕像素', () => {
  const checker = (width: number, height: number, period = 1) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = (Math.floor(x / period) + Math.floor(y / period)) % 2 === 0 ? 255 : 0;
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    return { width, height, data };
  };

  it('黑白棋盘缩到 10% 是均匀中灰：颗粒融成中间色，而不是被抽样成更粗的假颗粒', () => {
    const small = resampleForDisplay(checker(100, 60), 10, 6);
    expect([small.width, small.height]).toEqual([10, 6]);
    for (let i = 0; i < small.data.length; i += 4) {
      expect(small.data[i]).toBeGreaterThanOrEqual(126);
      expect(small.data[i]).toBeLessThanOrEqual(129);
      expect(small.data[i + 3]).toBe(255);
    }
  });

  it('正好 2 的幂倍数时就是逐级 2×2 平均，与一次 box 平均相同', () => {
    const src = checker(64, 32, 3);
    const mip = resampleForDisplay(src, 16, 8);
    const box = resample(src, 16, 8, 'box');
    for (let i = 0; i < mip.data.length; i++) expect(Math.abs(mip.data[i] - box.data[i])).toBeLessThanOrEqual(1);
  });

  it('目标比帧大（播放中的降分辨率帧）按最近邻铺开，不糊', () => {
    const big = resampleForDisplay(checker(4, 2), 8, 4);
    expect([big.width, big.height]).toEqual([8, 4]);
    for (let i = 0; i < big.data.length; i += 4) expect([0, 255]).toContain(big.data[i]);
    expect(big.data[0]).toBe(255);
    expect(big.data[2 * 4]).toBe(0);
  });

  it('尺寸相同时原样返回', () => {
    const src = checker(8, 8);
    expect(resampleForDisplay(src, 8, 8)).toBe(src);
  });

  it('linear 核缩小时不展宽：每个目标像素最多只看最近的两个源像素', () => {
    const w = axisWeights(250, 200, 1.25, 0, 'linear');
    for (let i = 0; i < 200; i++) expect(w.count[i]).toBeLessThanOrEqual(2);
    // bilinear 会按倍率展宽到 3 个抽头
    const wide = axisWeights(250, 200, 1.25, 0, 'bilinear');
    expect(Math.max(...Array.from(wide.count))).toBe(3);
  });
});

describe('box 面积平均：颗粒融成中间色', () => {
  it('黑白棋盘缩到 10% 是均匀中灰', () => {
    const width = 100;
    const height = 60;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = (x + y) % 2 === 0 ? 255 : 0;
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    const small = resample({ width, height, data }, 10, 6, 'box');
    for (let i = 0; i < small.data.length; i += 4) {
      expect(small.data[i]).toBeGreaterThanOrEqual(127);
      expect(small.data[i]).toBeLessThanOrEqual(128);
      expect(small.data[i + 3]).toBe(255);
    }
  });

  it('纯色区域缩小后颜色不变', () => {
    const width = 30;
    const height = 20;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 0x11;
      data[i + 1] = 0x22;
      data[i + 2] = 0x33;
      data[i + 3] = 255;
    }
    const small = resample({ width, height, data }, 7, 5, 'box');
    for (let i = 0; i < small.data.length; i += 4) expect(Array.from(small.data.subarray(i, i + 4))).toEqual([0x11, 0x22, 0x33, 255]);
  });
});
