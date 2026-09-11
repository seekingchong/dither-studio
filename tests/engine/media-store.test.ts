import { describe, expect, it } from 'vitest';
import { isMediaStoreKey, mediaStoreExtension, mediaStoreKey } from '@/platform/types';

const HEX = 'a'.repeat(64);

describe('素材存储键', () => {
  it('扩展名跟着文件名走：小写、只留字母数字、没有就不带', () => {
    expect(mediaStoreExtension('clip.MP4')).toBe('.mp4');
    expect(mediaStoreExtension('my.photo.jpeg')).toBe('.jpeg');
    expect(mediaStoreExtension('noext')).toBe('');
    expect(mediaStoreExtension('.hidden')).toBe('');
    expect(mediaStoreExtension('weird.p n-g')).toBe('.png');
    expect(mediaStoreKey(HEX, 'a.png')).toBe(`${HEX}.png`);
    expect(mediaStoreKey(HEX, 'a')).toBe(HEX);
  });

  it('键只认 64 位十六进制摘要加可选扩展名，拼不出目录外的路径', () => {
    expect(isMediaStoreKey(`${HEX}.png`)).toBe(true);
    expect(isMediaStoreKey(HEX)).toBe(true);
    expect(isMediaStoreKey(`${HEX}.mp4`)).toBe(true);
    expect(isMediaStoreKey('../storage.json')).toBe(false);
    expect(isMediaStoreKey(`${HEX}/../x.png`)).toBe(false);
    expect(isMediaStoreKey(`${HEX}.png.tmp`)).toBe(false);
    expect(isMediaStoreKey(`${'A'.repeat(64)}.png`)).toBe(false);
    expect(isMediaStoreKey('')).toBe(false);
  });
});
