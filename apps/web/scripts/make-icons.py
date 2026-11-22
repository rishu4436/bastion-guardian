"""Generates the PWA icons (shield mark) deterministically. Run: python3 scripts/make-icons.py"""
from PIL import Image, ImageDraw

BG = (11, 18, 32, 255)
ACCENT = (59, 130, 246, 255)
INNER = (230, 237, 247, 255)

def shield(size: int, pad: float) -> Image.Image:
    img = Image.new("RGBA", (size, size), BG)
    d = ImageDraw.Draw(img)
    s = size * (1 - 2 * pad)
    ox = oy = size * pad
    pts = [(0.5, 0.0), (0.92, 0.14), (0.92, 0.46), (0.5, 1.0), (0.08, 0.46), (0.08, 0.14)]
    poly = [(ox + x * s, oy + y * s) for x, y in pts]
    d.polygon(poly, fill=ACCENT)
    # inner check mark
    w = max(2, int(size * 0.06))
    d.line([(ox + 0.3 * s, oy + 0.45 * s), (ox + 0.45 * s, oy + 0.6 * s), (ox + 0.72 * s, oy + 0.3 * s)], fill=INNER, width=w, joint="curve")
    return img

for name, size, pad in [("icon-192.png", 192, 0.12), ("icon-512.png", 512, 0.12), ("maskable-512.png", 512, 0.22), ("apple-touch-icon.png", 180, 0.14), ("badge-72.png", 72, 0.08)]:
    shield(size, pad).save(f"public/icons/{name}", optimize=True)
print("icons written")
