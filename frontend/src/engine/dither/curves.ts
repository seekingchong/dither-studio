/**
 * 空间填充曲线的像素访问顺序。返回长度为 width*height 的索引数组，每个像素恰好出现一次。
 * Hilbert / Peano 在覆盖图像的正方形上生成后裁剪；Gosper / FASS 用 L-system 走龟图，
 * 栅格化后按首次经过的顺序访问，漏掉的像素按扫描顺序补在末尾。
 */

export type CurveType = 'hilbert' | 'peano' | 'gosper' | 'fass';

function hilbertD2xy(n: number, d: number): [number, number] {
  let x = 0;
  let y = 0;
  let t = d;
  for (let s = 1; s < n; s *= 2) {
    const rx = 1 & (t >> 1);
    const ry = 1 & (t ^ rx);
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        y = s - 1 - y;
      }
      const tmp = x;
      x = y;
      y = tmp;
    }
    x += s * rx;
    y += s * ry;
    t >>= 2;
  }
  return [x, y];
}

export function hilbertOrder(width: number, height: number): Int32Array {
  let n = 1;
  while (n < Math.max(width, height)) n *= 2;
  const out = new Int32Array(width * height);
  let k = 0;
  const total = n * n;
  for (let d = 0; d < total; d++) {
    const [x, y] = hilbertD2xy(n, d);
    if (x < width && y < height) out[k++] = y * width + x;
  }
  return out;
}

export function peanoOrder(width: number, height: number): Int32Array {
  let n = 1;
  while (n < Math.max(width, height)) n *= 3;
  const out = new Int32Array(width * height);
  let k = 0;
  const visit = (x0: number, y0: number, size: number, fx: boolean, fy: boolean) => {
    if (x0 >= width && !fx) return;
    if (y0 >= height && !fy) return;
    if (x0 + size <= 0 || y0 + size <= 0 || x0 >= width || y0 >= height) return;
    if (size === 1) {
      out[k++] = y0 * width + x0;
      return;
    }
    const s = size / 3;
    for (let step = 0; step < 9; step++) {
      const i = Math.floor(step / 3);
      const j = i % 2 === 0 ? step % 3 : 2 - (step % 3);
      const ci = fx ? 2 - i : i;
      const cj = fy ? 2 - j : j;
      visit(x0 + ci * s, y0 + cj * s, s, fx !== (j % 2 === 1), fy !== (i % 2 === 1));
    }
  };
  visit(0, 0, n, false, false);
  return out;
}

/** 展开 L-system 字符串 */
function lsystem(axiom: string, rules: Record<string, string>, iterations: number): string {
  let s = axiom;
  for (let i = 0; i < iterations; i++) {
    let next = '';
    for (const ch of s) next += rules[ch] ?? ch;
    s = next;
  }
  return s;
}

/**
 * 走龟图并把经过的格点栅格化成像素访问顺序。
 * stepX / stepY 把龟坐标缩放到像素；先走一遍求包围盒，再走一遍记录。
 */
function turtleOrder(
  width: number,
  height: number,
  program: string,
  angleDeg: number,
  scaleX: number,
  scaleY: number,
): Int32Array {
  const rad = (angleDeg * Math.PI) / 180;
  const walk = (visit: (x: number, y: number) => void) => {
    let x = 0;
    let y = 0;
    let heading = 0;
    visit(x, y);
    for (const ch of program) {
      if (ch === '+') heading += rad;
      else if (ch === '-') heading -= rad;
      else if (ch === 'F' || ch === 'A' || ch === 'B') {
        x += Math.cos(heading);
        y += Math.sin(heading);
        visit(x, y);
      }
    }
  };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  walk((x, y) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  });
  const spanX = (maxX - minX) * scaleX;
  const spanY = (maxY - minY) * scaleY;
  const offX = (width - 1 - spanX) / 2;
  const offY = (height - 1 - spanY) / 2;

  const out = new Int32Array(width * height);
  const seen = new Uint8Array(width * height);
  let k = 0;
  walk((x, y) => {
    const px = Math.round((x - minX) * scaleX + offX);
    const py = Math.round((y - minY) * scaleY + offY);
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const i = py * width + px;
    if (seen[i]) return;
    seen[i] = 1;
    out[k++] = i;
  });
  for (let i = 0; i < seen.length; i++) if (!seen[i]) out[k++] = i;
  return out;
}

export function gosperOrder(width: number, height: number): Int32Array {
  const target = Math.max(width, height * 1.1547);
  let n = 1;
  // Gosper 岛直径约 (√7)^n，留 40% 余量覆盖矩形
  while (Math.pow(Math.SQRT2 * 1.8708, n) < target * 1.4 && n < 9) n++;
  const program = lsystem('A', { A: 'A-B--B+A++AA+B-', B: '+A-BB--B-A++A+B' }, n);
  return turtleOrder(width, height, program, 60, 1, 1 / 0.8660254);
}

export function fassOrder(width: number, height: number): Int32Array {
  let n = 1;
  while (Math.pow(3, n) < Math.max(width, height) && n < 8) n++;
  const program = lsystem('-L', { L: 'LF+RFR+FL-F-LFLFL-FRFR+', R: '-LFLF+RFRFR+F+RF-FLFL-FR' }, n);
  return turtleOrder(width, height, program, 90, 1, 1);
}

const cache = new Map<string, Int32Array>();

export function curveOrder(type: CurveType, width: number, height: number): Int32Array {
  const key = `${type}:${width}x${height}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let order: Int32Array;
  switch (type) {
    case 'peano':
      order = peanoOrder(width, height);
      break;
    case 'gosper':
      order = gosperOrder(width, height);
      break;
    case 'fass':
      order = fassOrder(width, height);
      break;
    case 'hilbert':
    default:
      order = hilbertOrder(width, height);
  }
  if (cache.size > 8) cache.clear();
  cache.set(key, order);
  return order;
}
