"""
Generate Workshop's PNG icons (apple-touch-icon, favicon-32x32) from the
same geometry as public/favicon.svg. Run when you change the icon design.

Usage:
    python scripts/gen-icons.py

Outputs:
    public/apple-touch-icon.png  (180x180, square bg — iOS masks the corners)
    public/favicon-32x32.png     (32x32, rounded bg — browsers display as-is)
"""
from pathlib import Path
from PIL import Image, ImageDraw

INK   = (0x3D, 0x28, 0x17, 255)  # --color-ink-soft
CREAM = (0xF5, 0xF0, 0xEA, 255)  # --color-cream

ROOT = Path(__file__).resolve().parent.parent
OUT  = ROOT / "public"
SS   = 4  # super-sample factor for clean rotated edges


def _hammer_layer(canvas: int, inner: int) -> Image.Image:
    """Draw the upright hammer (head on top, handle below), centered on canvas."""
    layer = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx, cy = canvas // 2, canvas // 2

    head_w = int(inner * 0.52)
    head_h = int(inner * 0.28)
    handle_w = int(inner * 0.16)
    handle_h = int(inner * 0.74)
    head_r = int(min(head_w, head_h) * 0.20)
    handle_r = int(min(handle_w, handle_h) * 0.40)

    head_x = cx - head_w // 2
    head_y = cy - inner // 2
    handle_x = cx - handle_w // 2
    handle_y = head_y + head_h - max(1, int(inner * 0.02))

    d.rounded_rectangle(
        [(head_x, head_y), (head_x + head_w, head_y + head_h)],
        radius=head_r, fill=CREAM,
    )
    d.rounded_rectangle(
        [(handle_x, handle_y), (handle_x + handle_w, handle_y + handle_h)],
        radius=handle_r, fill=CREAM,
    )
    return layer


def render(size: int, rounded_bg: bool, padding_ratio: float) -> Image.Image:
    s = size * SS
    pad = int(s * padding_ratio)
    inner = s - 2 * pad

    bg = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bg)
    if rounded_bg:
        bd.rounded_rectangle([(0, 0), (s - 1, s - 1)], radius=int(s * 0.175), fill=INK)
    else:
        bd.rectangle([(0, 0), (s - 1, s - 1)], fill=INK)

    hammer = _hammer_layer(s, inner)
    # Rotate -20° (PIL angle is CCW) → head tilts to upper-right, handle to lower-left.
    hammer = hammer.rotate(-20, resample=Image.BICUBIC, center=(s // 2, s // 2))

    composed = Image.alpha_composite(bg, hammer)
    return composed.resize((size, size), resample=Image.LANCZOS)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)

    # iOS home screen: square PNG, iOS adds its own rounded mask. Pad the artwork
    # so the rounded mask doesn't clip the hammer.
    apple = render(180, rounded_bg=False, padding_ratio=0.18)
    apple_path = OUT / "apple-touch-icon.png"
    apple.save(apple_path, optimize=True)
    print(f"wrote {apple_path}")

    # 32x32 PNG fallback for browsers that don't read the SVG favicon. Rounded bg
    # matches the SVG.
    fav32 = render(32, rounded_bg=True, padding_ratio=0.13)
    fav32_path = OUT / "favicon-32x32.png"
    fav32.save(fav32_path, optimize=True)
    print(f"wrote {fav32_path}")
