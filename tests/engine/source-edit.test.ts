import { describe, expect, it } from 'vitest';
import { IDENTITY_EDIT, ZOOM_MAX, editGeometry, editKey, editedSize, isIdentityEdit, type SourceEdit } from '@/ui/media/sourceEdit';

const edit = (patch: Partial<SourceEdit>): SourceEdit => ({ ...IDENTITY_EDIT, ...patch });

describe('素材编辑的几何', () => {
  it('旋转 90 / 270 度长宽互换', () => {
    expect(editedSize(400, 250, IDENTITY_EDIT)).toEqual({ width: 400, height: 250 });
    expect(editedSize(400, 250, edit({ rotate: 90 }))).toEqual({ width: 250, height: 400 });
    expect(editedSize(400, 250, edit({ rotate: 180 }))).toEqual({ width: 400, height: 250 });
    expect(editedSize(400, 250, edit({ rotate: 270 }))).toEqual({ width: 250, height: 400 });
  });

  it('镜像不改尺寸', () => {
    expect(editedSize(400, 250, edit({ flipX: true, flipY: true }))).toEqual({ width: 400, height: 250 });
  });

  it('裁剪缩放等比：放大多少就等比裁掉多少，比例不变', () => {
    // 裁剪矩形本身是精确等比的，输出位图得取整，所以比例只能做到"差不到半个像素"
    for (const zoom of [1, 1.5, 2, 3.2, ZOOM_MAX]) {
      const g = editGeometry(400, 250, edit({ zoom }));
      expect(g.cropWidth / g.cropHeight).toBeCloseTo(400 / 250, 10);
      const size = editedSize(400, 250, edit({ zoom }));
      expect(Math.abs(size.width / size.height - 400 / 250) / (400 / 250)).toBeLessThan(0.01);
      expect(Math.abs(size.width - g.cropWidth)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(size.height - g.cropHeight)).toBeLessThanOrEqual(0.5);
    }
    expect(editedSize(400, 250, edit({ zoom: 2 }))).toEqual({ width: 200, height: 125 });
    // 先转再裁，比例跟着转后的画面走
    expect(editedSize(400, 250, edit({ rotate: 90, zoom: 2 }))).toEqual({ width: 125, height: 200 });
  });

  it('offset 在余量里插值：0 居中，±1 贴边', () => {
    const g0 = editGeometry(400, 250, edit({ zoom: 2 }));
    expect(g0.cropX).toBeCloseTo(100, 5);
    expect(g0.cropY).toBeCloseTo(62.5, 5);
    expect(editGeometry(400, 250, edit({ zoom: 2, offsetX: -1, offsetY: -1 })).cropX).toBe(0);
    expect(editGeometry(400, 250, edit({ zoom: 2, offsetX: 1, offsetY: 1 })).cropX).toBeCloseTo(200, 5);
    // 没放大就没有余量，offset 怎么给都贴 0
    expect(editGeometry(400, 250, edit({ offsetX: 1 })).cropX).toBe(0);
  });

  it('越界与非法值被钳住，不会算出负的或 NaN 尺寸', () => {
    expect(editedSize(400, 250, edit({ zoom: 99 }))).toEqual(editedSize(400, 250, edit({ zoom: ZOOM_MAX })));
    expect(editedSize(400, 250, edit({ zoom: 0.1 }))).toEqual({ width: 400, height: 250 });
    expect(editGeometry(400, 250, edit({ zoom: Number.NaN })).cropWidth).toBe(400);
    expect(editGeometry(400, 250, edit({ zoom: 2, offsetX: 9 })).cropX).toBeCloseTo(200, 5);
  });

  it('identity 判定与推帧用的键', () => {
    expect(isIdentityEdit(IDENTITY_EDIT)).toBe(true);
    expect(isIdentityEdit(edit({ rotate: 90 }))).toBe(false);
    expect(isIdentityEdit(edit({ flipY: true }))).toBe(false);
    expect(isIdentityEdit(edit({ zoom: 1.05 }))).toBe(false);
    expect(editKey(IDENTITY_EDIT)).toBe(editKey(edit({})));
    expect(editKey(edit({ rotate: 90 }))).not.toBe(editKey(edit({ rotate: 180 })));
    expect(editKey(edit({ offsetX: 0.5 }))).not.toBe(editKey(edit({ offsetX: -0.5 })));
  });
});
