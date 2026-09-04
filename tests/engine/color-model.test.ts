import { describe, expect, it } from 'vitest';
import { clampHsb, hexToHsb, hexToRgb, hsbToHex, rgbToHex, rgbToHsb } from '@/ui/primitives/color';

describe('取色层的 HSB ⇄ HEX', () => {
  it('三原色与黑白的 HSB 值', () => {
    expect(hexToHsb('#FF0000')).toEqual({ h: 0, s: 100, b: 100 });
    expect(hexToHsb('#00FF00')).toEqual({ h: 120, s: 100, b: 100 });
    expect(hexToHsb('#0000FF')).toEqual({ h: 240, s: 100, b: 100 });
    expect(hexToHsb('#FFFFFF')).toEqual({ h: 0, s: 0, b: 100 });
    expect(hexToHsb('#000000')).toEqual({ h: 0, s: 0, b: 0 });
    // 灰：色相没有意义，取 0
    expect(hexToHsb('#808080')).toEqual({ h: 0, s: 0, b: 50 });
  });

  it('HSB 回到 HEX', () => {
    expect(hsbToHex({ h: 0, s: 100, b: 100 })).toBe('#FF0000');
    expect(hsbToHex({ h: 180, s: 100, b: 100 })).toBe('#00FFFF');
    expect(hsbToHex({ h: 300, s: 50, b: 80 })).toBe('#CC66CC');
    // 360 与 0 是同一个色相
    expect(hsbToHex({ h: 360, s: 100, b: 100 })).toBe('#FF0000');
  });

  // H / S / B 都取整（1° / 1%），1% 明度就是 2.55/255，所以往返必然有零点几个色阶的误差。
  // 实测全 RGB 空间随机采样的最坏情况是 3/255，肉眼看不出来；面板里以 HSB 状态为准，
  // 只有真正改了某个通道才会写回 hex，所以不会因为反复开合而一路漂移。
  it('hex → HSB → hex 往返误差不超过 3/255', () => {
    for (const hex of ['#11192D', '#FF6200', '#7C889C', '#004AB8', '#53CD72', '#123456', '#3CFE6B']) {
      const [r1, g1, b1] = hexToRgb(hex);
      const [r2, g2, b2] = hexToRgb(hsbToHex(hexToHsb(hex)));
      expect(Math.max(Math.abs(r1 - r2), Math.abs(g1 - g2), Math.abs(b1 - b2))).toBeLessThanOrEqual(3);
    }
    // 纯色与灰阶这些能被 HSB 精确表示的，往返完全无损
    for (const hex of ['#FF0000', '#00FF00', '#0000FF', '#FFFFFF', '#000000', '#00FFFF']) {
      expect(hsbToHex(hexToHsb(hex))).toBe(hex);
    }
  });

  it('通道钳位在各自量程里，非法输入退回 0', () => {
    expect(clampHsb('h', 400)).toBe(360);
    expect(clampHsb('s', -20)).toBe(0);
    expect(clampHsb('b', 130)).toBe(100);
    expect(clampHsb('h', Number.NaN)).toBe(0);
    expect(clampHsb('s', 33.6)).toBe(34);
  });

  it('RGB 辅助函数', () => {
    expect(hexToRgb('#123456')).toEqual([0x12, 0x34, 0x56]);
    expect(rgbToHex(18, 52, 86)).toBe('#123456');
    // 超范围先钳位再取整
    expect(rgbToHex(-5, 300, 127.6)).toBe('#00FF80');
    expect(rgbToHsb(0, 0, 0)).toEqual({ h: 0, s: 0, b: 0 });
  });
});
