import type { CellFrame, RGBAFrame } from '../types';

/**
 * 把格子颜色按最近邻放大回画布尺寸。格子 (i, j) 覆盖画布像素
 * x ∈ [i*size - offsetX, (i+1)*size - offsetX)。
 */
export function renderCells(cells: CellFrame, width: number, height: number, size: number, offsetX = 0, offsetY = 0): RGBAFrame {
  const out = new Uint8ClampedArray(width * height * 4);
  const src32 = new Uint32Array(cells.data.buffer, cells.data.byteOffset, cells.width * cells.height);
  const dst32 = new Uint32Array(out.buffer);
  const ox = ((offsetX % size) + size) % size;
  const oy = ((offsetY % size) + size) % size;
  const colIndex = new Int32Array(width);
  for (let x = 0; x < width; x++) colIndex[x] = Math.min(cells.width - 1, Math.floor((x + ox) / size));
  for (let y = 0; y < height; y++) {
    const j = Math.min(cells.height - 1, Math.floor((y + oy) / size));
    const srcRow = j * cells.width;
    const dstRow = y * width;
    for (let x = 0; x < width; x++) dst32[dstRow + x] = src32[srcRow + colIndex[x]];
  }
  return { width, height, data: out };
}
