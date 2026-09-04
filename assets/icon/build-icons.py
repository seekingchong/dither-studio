#!/usr/bin/env python3
"""Dither Studio 图标生成器。

母版几何：1024 画布上两枚圆角方块沿对角错位，正好是 Bayer 2x2 / 棋盘图案的一个单元。
所有产物都从同一套几何参数渲染，改这里就能重出全套。

依赖：Pillow。用法：python3 assets/icon/build-icons.py
"""

import math
import struct
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent

# ---------------------------------------------------------------- 设计常量

INK = (29, 26, 22, 255)        # #1D1A16 暖黑，方块
BG = (219, 217, 213, 255)      # #DBD9D5 暖灰，底色

MARK_RATIO = 0.6875            # 图形外框占画布比例（母版）
RADIUS_RATIO = 0.295           # 单个方块圆角 / 边长
MAC_BODY_RATIO = 824 / 1024    # macOS 图标本体占画布比例
MAC_SUPERELLIPSE_N = 5.0       # 连续曲率圆角的超椭圆近似指数

# 小尺寸光学补偿：像素少的时候放大图形、收紧圆角，否则糊成一团
def optical(size):
    if size <= 32:
        return 0.84, 0.25
    if size <= 64:
        return 0.78, 0.27
    if size <= 128:
        return 0.72, 0.28
    return MARK_RATIO, RADIUS_RATIO


def supersample(size):
    return max(2, min(8, 4096 // max(size, 1)))


# ---------------------------------------------------------------- 绘制

def _draw_pair(draw, origin, box, radius, fill=INK):
    """在 origin 起、边长 box 的正方区域内画对角错位的两枚圆角方块。"""
    side = box / 2
    ox, oy = origin
    for x, y in ((ox, oy), (ox + side, oy + side)):
        draw.rounded_rectangle(
            [x, y, x + side - 1, y + side - 1], radius=side * radius, fill=fill
        )


def render_flat(size, mark_ratio=None, radius_ratio=None, bg=BG):
    """满版方形图标（web / favicon / Windows / Linux）。"""
    if mark_ratio is None:
        mark_ratio, radius_ratio = optical(size)
    ss = supersample(size)
    c = size * ss
    img = Image.new("RGBA", (c, c), bg)
    box = c * mark_ratio
    _draw_pair(ImageDraw.Draw(img), ((c - box) / 2,) * 2, box, radius_ratio)
    return img.resize((size, size), Image.LANCZOS)


def superellipse_points(cx, cy, half, n, steps=2048):
    e = 2.0 / n
    pts = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        ct, st = math.cos(t), math.sin(t)
        pts.append(
            (
                cx + half * math.copysign(abs(ct) ** e, ct),
                cy + half * math.copysign(abs(st) ** e, st),
            )
        )
    return pts


def render_mac(size):
    """macOS 应用图标：超椭圆本体 + 四周留白，透明背景。系统不会替我们裁形状。"""
    ss = supersample(size)
    c = size * ss
    img = Image.new("RGBA", (c, c), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    body = c * MAC_BODY_RATIO
    draw.polygon(
        superellipse_points(c / 2, c / 2, body / 2, MAC_SUPERELLIPSE_N), fill=BG
    )
    box = body * MARK_RATIO
    _draw_pair(draw, ((c - box) / 2,) * 2, box, RADIUS_RATIO)
    return img.resize((size, size), Image.LANCZOS)


def render_maskable(size):
    """PWA maskable：图形收进中心 80% 安全圆内，任何裁切形状都不会切到。"""
    return render_flat(size, mark_ratio=0.55, radius_ratio=RADIUS_RATIO)


# ---------------------------------------------------------------- 容器封装

ICNS_TYPES = [
    (b"icp4", 16), (b"icp5", 32), (b"ic11", 32), (b"ic12", 64),
    (b"ic07", 128), (b"ic13", 256), (b"ic08", 256),
    (b"ic14", 512), (b"ic09", 512), (b"ic10", 1024),
]


def write_icns(path, png_by_size):
    entries = b"".join(
        t + struct.pack(">I", len(png_by_size[s]) + 8) + png_by_size[s]
        for t, s in ICNS_TYPES
    )
    path.write_bytes(b"icns" + struct.pack(">I", len(entries) + 8) + entries)


# ---------------------------------------------------------------- 矢量母版

def hexcolor(rgba):
    return "#%02X%02X%02X" % rgba[:3]


def svg_pair(canvas, mark_ratio, radius_ratio, origin=None, indent="  "):
    box = canvas * mark_ratio
    side = box / 2
    ox, oy = origin if origin else ((canvas - box) / 2,) * 2
    r = side * radius_ratio
    fmt = (
        '{i}<rect x="{x:g}" y="{y:g}" width="{s:g}" height="{s:g}" '
        'rx="{r:g}" ry="{r:g}" fill="{f}"/>'
    )
    return "\n".join(
        fmt.format(i=indent, x=round(x, 2), y=round(y, 2), s=round(side, 2),
                   r=round(r, 2), f="{fill}")
        for x, y in ((ox, oy), (ox + side, oy + side))
    )


def write_svgs():
    ink, bg = hexcolor(INK), hexcolor(BG)

    (OUT / "icon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" '
        'viewBox="0 0 1024 1024" role="img" aria-label="Dither Studio">\n'
        '  <title>Dither Studio</title>\n'
        f'  <rect width="1024" height="1024" fill="{bg}"/>\n'
        + svg_pair(1024, MARK_RATIO, RADIUS_RATIO).format(fill=ink)
        + "\n</svg>\n"
    )

    body = 1024 * MAC_BODY_RATIO
    pts = superellipse_points(512, 512, body / 2, MAC_SUPERELLIPSE_N, steps=256)
    path = "M " + " L ".join(f"{x:.2f} {y:.2f}" for x, y in pts) + " Z"
    box = body * MARK_RATIO
    (OUT / "icon-mac.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" '
        'viewBox="0 0 1024 1024" role="img" aria-label="Dither Studio">\n'
        '  <title>Dither Studio</title>\n'
        f'  <path d="{path}" fill="{bg}"/>\n'
        + svg_pair(1024, MARK_RATIO * MAC_BODY_RATIO, RADIUS_RATIO,
                   origin=((1024 - box) / 2,) * 2).format(fill=ink)
        + "\n</svg>\n"
    )

    (OUT / "favicon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" '
        'viewBox="0 0 32 32" role="img" aria-label="Dither Studio">\n'
        '  <title>Dither Studio</title>\n'
        f'  <rect width="32" height="32" fill="{bg}"/>\n'
        + svg_pair(32, 0.84, 0.25).format(fill=ink)
        + "\n</svg>\n"
    )

    # 界面内用的纯图形：透明底、currentColor，跟随 --tda-* 文字色
    (OUT / "mark.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" '
        'viewBox="0 0 24 24" fill="none" aria-hidden="true">\n'
        + svg_pair(24, 23 / 24, RADIUS_RATIO).format(fill="currentColor")
        + "\n</svg>\n"
    )


# ---------------------------------------------------------------- 产物清单

FLAT_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024]
MAC_SIZES = [16, 32, 64, 128, 256, 512, 1024]
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]


def main():
    (OUT / "png").mkdir(exist_ok=True)
    (OUT / "mac").mkdir(exist_ok=True)
    write_svgs()

    flat = {s: render_flat(s) for s in FLAT_SIZES + ICO_SIZES}
    for s in FLAT_SIZES:
        flat[s].save(OUT / "png" / f"icon-{s}.png")

    mac = {}
    for s in MAC_SIZES:
        img = render_mac(s)
        mac[s] = img
        img.save(OUT / "mac" / f"icon-{s}.png")
    write_icns(
        OUT / "icon.icns",
        {s: (OUT / "mac" / f"icon-{s}.png").read_bytes() for s in MAC_SIZES},
    )

    # Windows / Linux / 浏览器旧式 favicon 都吃这一个 ico
    flat[256].save(OUT / "icon.ico", sizes=[(s, s) for s in ICO_SIZES])

    flat[1024].resize((180, 180), Image.LANCZOS).save(OUT / "png" / "apple-touch-icon-180.png")
    for s in (192, 512):
        render_flat(s, MARK_RATIO, RADIUS_RATIO).save(OUT / "png" / f"pwa-{s}.png")
        render_maskable(s).save(OUT / "png" / f"pwa-maskable-{s}.png")

    print("icon.svg icon-mac.svg favicon.svg mark.svg icon.icns icon.ico")
    print("png/:", *sorted(p.name for p in (OUT / "png").iterdir()))
    print("mac/:", *sorted(p.name for p in (OUT / "mac").iterdir()))


if __name__ == "__main__":
    main()
