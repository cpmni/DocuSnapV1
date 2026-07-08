"""Rendering primitives, decorations, and image degradations — shared by the
generator (Agent 1) and the page-drift agent (Agent 2).

Decorations (logo, stamp, signature, checkbox, barcode, QR, watermark) are drawn at
known positions so bboxes can be recorded. Degradations (blur, noise, contrast,
shadow, skew, rotate, shift, crop, resize, JPEG) operate on the finished page image.
"""
from __future__ import annotations
import io
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

FONTS = [r"C:\Windows\Fonts\arial.ttf", r"C:\Windows\Fonts\calibri.ttf",
         r"C:\Windows\Fonts\times.ttf", r"C:\Windows\Fonts\verdana.ttf",
         r"C:\Windows\Fonts\georgia.ttf", r"C:\Windows\Fonts\tahoma.ttf"]
BOLD = r"C:\Windows\Fonts\arialbd.ttf"
MONO = r"C:\Windows\Fonts\consola.ttf"
HAND = r"C:\Windows\Fonts\seguisc.ttf"   # script-ish; falls back if absent

_FONT_CACHE: dict = {}


def font(path, size):
    key = (path, size)
    f = _FONT_CACHE.get(key)
    if f is None:
        try:
            f = ImageFont.truetype(path, size)
        except Exception:
            f = ImageFont.load_default()
        _FONT_CACHE[key] = f
    return f


def text(draw, xy, s, fnt, fill=(20, 20, 20)):
    """Draw text; return its [x, y, w, h] pixel bbox."""
    draw.text(xy, s, font=fnt, fill=fill)
    l, t, r, b = draw.textbbox(xy, s, font=fnt)
    return [int(l), int(t), int(r - l), int(b - t)]


def norm(bbox, W, H):
    x, y, w, h = bbox
    return [round(x / W, 4), round(y / H, 4), round(w / W, 4), round(h / H, 4)]


def make_logo(rng, company, size=120, shape=None):
    """Deterministic geometric logo: a coloured shape + the company initials."""
    img = Image.new("RGB", (size, size), "white")
    d = ImageDraw.Draw(img)
    hue = (rng.randint(20, 200), rng.randint(40, 170), rng.randint(60, 210))
    shape = shape or rng.choice(["circle", "square", "triangle", "diamond", "hex"])
    m = max(6, size // 10)
    if shape == "circle":
        d.ellipse([m, m, size - m, size - m], fill=hue)
    elif shape == "square":
        d.rounded_rectangle([m, m, size - m, size - m], radius=size // 8, fill=hue)
    elif shape == "triangle":
        d.polygon([(size // 2, m), (size - m, size - m), (m, size - m)], fill=hue)
    elif shape == "hex":
        cx, cy, r = size / 2, size / 2, size / 2 - m
        pts = [(cx + r * math.cos(math.pi / 3 * k), cy + r * math.sin(math.pi / 3 * k)) for k in range(6)]
        d.polygon(pts, fill=hue)
    else:
        d.polygon([(size // 2, m), (size - m, size // 2), (size // 2, size - m), (m, size // 2)], fill=hue)
    initials = "".join(w[0] for w in company.split()[:2]).upper()
    f = font(BOLD, int(size * 0.36))
    tb = d.textbbox((0, 0), initials, font=f)
    d.text(((size - (tb[2] - tb[0])) / 2, (size - (tb[3] - tb[1])) / 2 - size * 0.06),
           initials, font=f, fill="white")
    return img, shape


# ── Decorations ────────────────────────────────────────────────────────────────

def stamp(img, rng, xy, label="PAID", dpi=150):
    """Draw a rotated rubber-stamp box; returns its bbox in page coords."""
    s = int(dpi * 1.4)
    layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    col = rng.choice([(190, 30, 30, 180), (30, 80, 170, 180), (30, 140, 60, 180)])
    d.rounded_rectangle([6, s // 3, s - 6, 2 * s // 3], radius=10, outline=col, width=5)
    f = font(BOLD, int(dpi * 0.16))
    tb = d.textbbox((0, 0), label, font=f)
    d.text(((s - (tb[2] - tb[0])) / 2, (s - (tb[3] - tb[1])) / 2), label, font=f, fill=col)
    layer = layer.rotate(rng.randint(-25, 25), expand=True, resample=Image.BICUBIC)
    img.paste(layer, (xy[0], xy[1]), layer)
    return [xy[0], xy[1], layer.width, layer.height]


def signature(img, rng, xy, dpi=150):
    d = ImageDraw.Draw(img)
    x, y = xy
    pts = [(x, y)]
    for _ in range(rng.randint(18, 30)):
        x += rng.randint(4, int(dpi * 0.12))
        pts.append((x, y + rng.randint(-int(dpi * 0.18), int(dpi * 0.18))))
    d.line(pts, fill=(20, 20, 90), width=2, joint="curve")
    return [xy[0], xy[1] - int(dpi * 0.2), x - xy[0], int(dpi * 0.4)]


def checkbox(img, rng, xy, label, checked, dpi=150):
    d = ImageDraw.Draw(img)
    b = int(dpi * 0.13)
    d.rectangle([xy[0], xy[1], xy[0] + b, xy[1] + b], outline=(40, 40, 40), width=2)
    if checked:
        d.line([(xy[0] + 2, xy[1] + b // 2), (xy[0] + b // 2, xy[1] + b - 2)], fill=(20, 20, 20), width=3)
        d.line([(xy[0] + b // 2, xy[1] + b - 2), (xy[0] + b, xy[1])], fill=(20, 20, 20), width=3)
    text(d, (xy[0] + b + 8, xy[1] - 2), label, font(FONTS[0], int(dpi * 0.07)), fill=(40, 40, 40))
    return [xy[0], xy[1], b, b]


def barcode(img, rng, xy, value, dpi=150):
    """Code128-style vertical bars (visual, non-decodable) + human-readable value."""
    d = ImageDraw.Draw(img)
    x, y = xy
    h = int(dpi * 0.45)
    x0 = x
    rng2 = rng
    for _ in range(rng2.randint(40, 60)):
        w = rng2.choice([2, 2, 3, 4])
        if rng2.random() < 0.55:
            d.rectangle([x, y, x + w, y + h], fill=(10, 10, 10))
        x += w
    f = font(MONO, int(dpi * 0.07))
    text(d, (x0, y + h + 2), value, f, fill=(10, 10, 10))
    return [x0, y, x - x0, h + int(dpi * 0.12)]


def qr(img, rng, xy, dpi=150):
    """QR-like module grid with three finder squares (visual, non-decodable)."""
    n = 21
    cell = max(3, int(dpi * 0.45) // n)
    s = n * cell
    q = Image.new("RGB", (s, s), "white")
    d = ImageDraw.Draw(q)
    for r in range(n):
        for c in range(n):
            if rng.random() < 0.5:
                d.rectangle([c * cell, r * cell, (c + 1) * cell, (r + 1) * cell], fill=(10, 10, 10))

    def finder(cr, cc):
        d.rectangle([cc * cell, cr * cell, (cc + 7) * cell, (cr + 7) * cell], fill="white")
        d.rectangle([cc * cell, cr * cell, (cc + 7) * cell, (cr + 7) * cell], outline=(10, 10, 10), width=cell)
        d.rectangle([(cc + 2) * cell, (cr + 2) * cell, (cc + 5) * cell, (cr + 5) * cell], fill=(10, 10, 10))
    finder(0, 0); finder(0, n - 7); finder(n - 7, 0)
    img.paste(q, (xy[0], xy[1]))
    return [xy[0], xy[1], s, s]


def watermark(img, text_str, dpi=150):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    f = font(BOLD, int(dpi * 0.9))
    tb = d.textbbox((0, 0), text_str, font=f)
    d.text(((img.width - (tb[2] - tb[0])) / 2, (img.height - (tb[3] - tb[1])) / 2),
           text_str, font=f, fill=(0, 0, 0, 26))
    layer = layer.rotate(35, expand=False, resample=Image.BICUBIC)
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def handwriting(img, rng, xy, s, dpi=150):
    d = ImageDraw.Draw(img)
    f = font(HAND, int(dpi * 0.11))
    return text(d, xy, s, f, fill=(20, 30, 120))


def paper_texture(img, rng, strength=6):
    """Light, deterministic paper grain so even 'clean' scans aren't pixel-perfect."""
    arr = np.asarray(img).astype(np.int16)
    noise = np.asarray(_det_noise(arr.shape, rng, strength))
    return Image.fromarray(np.clip(arr + noise, 0, 255).astype(np.uint8))


def _det_noise(shape, rng, strength):
    g = np.random.default_rng(rng.randint(0, 2**31))
    return g.integers(-strength, strength + 1, size=shape, dtype=np.int16)


# ── Degradations (return new image; some return (image, params)) ─────────────────

def deg_blur(img, radius=1.4):
    return img.filter(ImageFilter.GaussianBlur(radius))


def deg_noise(img, rng, strength=22):
    arr = np.asarray(img).astype(np.int16) + _det_noise(np.asarray(img).shape, rng, strength)
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def deg_contrast(img, factor=0.55):
    return ImageEnhance.Contrast(img).enhance(factor)


def deg_shadow(img, rng):
    """Soft diagonal shadow gradient across the page (scanner lid / fold)."""
    w, h = img.size
    grad = Image.new("L", (w, h), 0)
    gd = ImageDraw.Draw(grad)
    edge = rng.choice(["left", "right", "top"])
    for i in range(0, (w if edge in ("left", "right") else h), 4):
        if edge == "left":
            v = max(0, 90 - int(i / w * 240)); gd.rectangle([i, 0, i + 4, h], fill=v)
        elif edge == "right":
            v = max(0, 90 - int((w - i) / w * 240)); gd.rectangle([i, 0, i + 4, h], fill=v)
        else:
            v = max(0, 90 - int(i / h * 240)); gd.rectangle([0, i, w, i + 4], fill=v)
    dark = ImageEnhance.Brightness(img).enhance(0.45)
    return Image.composite(dark, img, grad.filter(ImageFilter.GaussianBlur(40)))


def deg_jpeg(img, quality=28):
    buf = io.BytesIO(); img.save(buf, "JPEG", quality=quality)
    buf.seek(0); return Image.open(buf).convert("RGB")


def deg_resize(img, scale=0.6):
    w, h = img.size
    small = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.BILINEAR)
    return small.resize((w, h), Image.BILINEAR)


# Geometric (also transform a normalised bbox so ground truth stays measurable).

def geo_shift(img, dx, dy, fill=(250, 250, 248)):
    out = Image.new("RGB", img.size, fill)
    out.paste(img, (dx, dy))
    return out


def shift_bbox(b, dx, dy, W, H):
    x, y, w, h = b
    return [x + dx / W, y + dy / H, w, h]


def geo_rotate(img, angle, fill=(250, 250, 248)):
    return img.rotate(angle, resample=Image.BICUBIC, expand=False, fillcolor=fill)


def rotate_bbox(b, angle, W, H):
    """Rotate a normalised bbox centre about the page centre (expand=False)."""
    x, y, w, h = b
    cx, cy = (x + w / 2) * W, (y + h / 2) * H
    a = math.radians(-angle)
    ox, oy = W / 2, H / 2
    nx = ox + (cx - ox) * math.cos(a) - (cy - oy) * math.sin(a)
    ny = oy + (cx - ox) * math.sin(a) + (cy - oy) * math.cos(a)
    return [(nx - w * W / 2) / W, (ny - h * H / 2) / H, w, h]


def geo_skew(img, kx, fill=(250, 250, 248)):
    """Horizontal shear by factor kx."""
    W, H = img.size
    return img.transform((W, H), Image.AFFINE, (1, kx, -kx * H / 2, 0, 1, 0),
                         resample=Image.BICUBIC, fillcolor=fill)


def geo_crop(img, frac=0.08, side="bottom"):
    """Crop a fraction off one side, then pad back to page size (a partial scan)."""
    W, H = img.size
    if side == "bottom":
        c = img.crop((0, 0, W, int(H * (1 - frac))))
    elif side == "top":
        c = img.crop((0, int(H * frac), W, H))
    elif side == "left":
        c = img.crop((int(W * frac), 0, W, H))
    else:
        c = img.crop((0, 0, int(W * (1 - frac)), H))
    out = Image.new("RGB", (W, H), (250, 250, 248))
    out.paste(c, (0, int(H * frac) if side == "top" else 0))
    return out
