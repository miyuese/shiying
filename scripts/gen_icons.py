"""生成拾影品牌图标：深蓝圆角方块 + 白色镜头环（纯标准库，零依赖）"""
import struct, zlib, os

def make_icon(size: int) -> bytes:
    W = H = size
    # 每个像素: R,G,B,A
    px = bytearray()

    # 颜色
    BG = (0x2E, 0x5E, 0xA8)   # 深蓝 #2E5EA8
    RING = (0xFF, 0xFF, 0xFF) # 白色镜头环
    DOT = (0x2E, 0x5E, 0xA8)  # 环内蓝点

    radius = size * 0.22          # 圆角半径
    cx, cy = size/2, size/2
    ring_r = size * 0.30          # 镜头环半径
    ring_w = max(2, size * 0.09)  # 环宽
    dot_r = size * 0.12           # 中心点半径

    def inside_round_rect(x, y):
        # 圆角矩形内部判定
        rx = min(max(x, radius), W - radius)
        ry = min(max(y, radius), H - radius)
        dx, dy = x - rx, y - ry
        return dx*dx + dy*dy <= radius*radius

    for y in range(H):
        px.append(0)  # filter: None
        for x in range(W):
            if not inside_round_rect(x + 0.5, y + 0.5):
                px += bytes((0, 0, 0, 0))  # 透明
                continue
            d = ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) ** 0.5
            if d <= ring_r and d >= ring_r - ring_w:
                px += bytes(RING + (255,))
            elif d <= dot_r:
                px += bytes(DOT + (255,))
            else:
                px += bytes(BG + (255,))

    def chunk(tag: bytes, data: bytes) -> bytes:
        c = struct.pack(">I", len(data)) + tag + data
        c += struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)
        return c

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0)  # 8bit RGBA
    idat = zlib.compress(bytes(px), 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")
    os.makedirs(out, exist_ok=True)
    for size in (16, 32, 48, 128):
        path = os.path.join(out, f"icon{size}.png")
        with open(path, "wb") as f:
            f.write(make_icon(size))
        print(f"wrote {path} ({size}x{size})")
