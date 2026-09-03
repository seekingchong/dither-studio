# 生成测试用的 3 帧动图 GIF（16×16，每帧不同颜色块），不依赖 PIL。
# LZW 用"每 254 个码发一次 CLEAR"的方式保持码长 9 位，写法简单且合法。
import struct, sys

W, H = 16, 16
FRAMES = 3
DELAY_CS = 20  # 0.2s

def lzw_encode(indices, min_code_size=8):
    clear = 1 << min_code_size
    eoi = clear + 1
    code_size = min_code_size + 1
    out = bytearray()
    bitbuf = 0
    bitlen = 0
    def emit(code):
        nonlocal bitbuf, bitlen
        bitbuf |= code << bitlen
        bitlen += code_size
        while bitlen >= 8:
            out.append(bitbuf & 0xFF)
            bitbuf >>= 8
            bitlen -= 8
    emit(clear)
    count = 0
    for v in indices:
        emit(v)
        count += 1
        if count == 250:
            emit(clear)
            count = 0
    emit(eoi)
    if bitlen:
        out.append(bitbuf & 0xFF)
    return bytes(out)

def sub_blocks(data):
    out = bytearray()
    for i in range(0, len(data), 255):
        chunk = data[i:i+255]
        out.append(len(chunk))
        out += chunk
    out.append(0)
    return bytes(out)

palette = bytearray()
for i in range(256):
    palette += bytes([i, (i * 7) % 256, (255 - i) % 256])
palette[0:3] = b"\x00\x00\x00"
palette[3:6] = b"\xff\xff\xff"
palette[6:9] = b"\xff\x00\x00"
palette[9:12] = b"\x00\x00\xff"

gif = bytearray(b"GIF89a")
gif += struct.pack("<HHBBB", W, H, 0xF7, 0, 0)  # 全局色表 256 色
gif += palette
gif += b"\x21\xFF\x0BNETSCAPE2.0\x03\x01\x00\x00\x00"  # 循环
for f in range(FRAMES):
    gif += b"\x21\xF9\x04\x00" + struct.pack("<H", DELAY_CS) + b"\x00\x00"
    gif += b"\x2C" + struct.pack("<HHHHB", 0, 0, W, H, 0)
    gif += bytes([8])
    idx = []
    for y in range(H):
        for x in range(W):
            # 每帧一个不同位置的彩色方块，其余黑白棋盘
            in_box = (f * 5) <= x < (f * 5 + 5) and 5 <= y < 11
            idx.append(2 + f % 2 if in_box else ((x // 4 + y // 4) % 2))
    gif += sub_blocks(lzw_encode(idx))
gif += b"\x3B"
open(sys.argv[1], "wb").write(gif)
print(f"wrote {sys.argv[1]} {len(gif)} bytes")
