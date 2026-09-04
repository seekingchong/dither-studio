"""复现预览缩放摩尔纹，验证 docs/PREVIEW_SCALING.md 的判定规则。

用法：python3 tests/fixtures/moire_repro.py [输出目录]
依赖：pillow
"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

W, H = 1000, 600          # 画布
PREV_W, PREV_H = 100, 60  # 10% 预览
ZOOM = 4                  # 对照图放大倍数，仅为便于肉眼观察


def bayer(n):
    m, size = [[0]], 1
    while size < n:
        new = [[0] * (size * 2) for _ in range(size * 2)]
        for y in range(size):
            for x in range(size):
                v = m[y][x]
                new[y][x] = 4 * v
                new[y][x + size] = 4 * v + 2
                new[y + size][x] = 4 * v + 3
                new[y + size][x + size] = 4 * v + 1
        m, size = new, size * 2
    return m


B8 = bayer(8)


def source():
    """径向渐变，中间调占比大，是抖动最容易暴露问题的输入。"""
    img = Image.new("L", (W, H))
    px = img.load()
    for y in range(H):
        for x in range(W):
            d = math.hypot((x - W / 2) / (W / 2), (y - H / 2) / (H / 2))
            px[x, y] = max(0, min(255, int(200 - 120 * d)))
    return img


def render(src, p):
    """正确路径：降采样到颗粒网格 -> 在颗粒网格上抖动 -> 最近邻整数放大。"""
    cw, ch = W // p, H // p
    small = src.resize((cw, ch), Image.BOX)
    sp = small.load()
    out = Image.new("L", (cw, ch))
    op = out.load()
    for y in range(ch):
        for x in range(cw):
            t = (B8[y % 8][x % 8] + 0.5) / 64.0 * 255.0
            op[x, y] = 255 if sp[x, y] > t else 0
    return out.resize((W, H), Image.NEAREST), cw


def main():
    out_dir = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    out_dir.mkdir(parents=True, exist_ok=True)
    src = source()

    tiles = []
    for p in (4, 5, 8, 10):
        full, cw = render(src, p)
        e = PREV_W / cw  # 有效颗粒尺寸 E
        verdict = "干净" if abs(e - round(e)) < 1e-9 and e >= 1 else "有伪影"
        label = f"P={p:<3} cells={cw:<4} E={e:.2f} px/cell  {verdict}"
        print(label)
        # 错误路径：把已渲染的大图缩到预览尺寸
        tiles.append(
            (
                label,
                full.resize((PREV_W, PREV_H), Image.NEAREST).resize(
                    (PREV_W * ZOOM, PREV_H * ZOOM), Image.NEAREST
                ),
            )
        )

    tw, th, pad, lab = PREV_W * ZOOM, PREV_H * ZOOM, 12, 20
    sheet = Image.new("RGB", (tw * 2 + pad * 3, (th + lab) * 2 + pad * 3), (24, 24, 24))
    draw = ImageDraw.Draw(sheet)
    for i, (label, tile) in enumerate(tiles):
        x = pad + (i % 2) * (tw + pad)
        y = pad + (i // 2) * (th + lab + pad)
        draw.text((x, y + 4), label, fill=(230, 230, 230))
        sheet.paste(tile.convert("RGB"), (x, y + lab))
    path = out_dir / "moire_compare.png"
    sheet.save(path)
    print(f"\n-> {path}")


if __name__ == "__main__":
    main()
