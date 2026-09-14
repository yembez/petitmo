#!/usr/bin/env python3
"""
Régénère le splash full-bleed + assets iOS SplashScreenLegacy.
Jamais de stretch : crop aspect-fill uniquement.

Usage (venv avec pillow+numpy) :
  python3 scripts/generate-splash-assets.py
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
C0 = np.array([0xFD, 0x62, 0x8D], dtype=np.float64)
C1 = np.array([0xFD, 0x67, 0x64], dtype=np.float64)


def vertical_gradient(w: int, h: int) -> Image.Image:
    t = np.linspace(0, 1, h, dtype=np.float64)[:, None, None]
    rgb = C0 * (1 - t) + C1 * t
    return Image.fromarray(np.repeat(rgb.astype(np.uint8), w, axis=1), "RGB")


def logo_content() -> Image.Image:
    logo = Image.open(ROOT / "assets/images/logo_petit_coeur_48_white.png").convert("RGBA")
    a = np.asarray(logo)
    mask = (a[:, :, 3] > 20) & (a[:, :, :3].max(axis=2) > 20)
    ys, xs = np.where(mask)
    pad = 8
    x0 = max(0, int(xs.min()) - pad)
    y0 = max(0, int(ys.min()) - pad)
    x1 = min(logo.width - 1, int(xs.max()) + pad)
    y1 = min(logo.height - 1, int(ys.max()) + pad)
    return logo.crop((x0, y0, x1 + 1, y1 + 1))


def compose_splash(w: int, h: int, logo_width_frac: float = 0.52) -> Image.Image:
    bg = vertical_gradient(w, h).convert("RGBA")
    logo = logo_content()
    target_w = int(round(w * logo_width_frac))
    target_h = int(round(target_w * (logo.height / logo.width)))
    logo_r = logo.resize((target_w, target_h), Image.Resampling.LANCZOS)
    x = (w - target_w) // 2
    y = (h - target_h) // 2
    bg.paste(logo_r, (x, y), logo_r)
    return bg.convert("RGB")


def aspect_fill_resize(im: Image.Image, tw: int, th: int) -> Image.Image:
    sw, sh = im.size
    scale = max(tw / sw, th / sh)
    nw, nh = int(round(sw * scale)), int(round(sh * scale))
    scaled = im.resize((nw, nh), Image.Resampling.LANCZOS)
    left = (nw - tw) // 2
    top = (nh - th) // 2
    return scaled.crop((left, top, left + tw, top + th))


def main() -> None:
    master = compose_splash(1284, 2778, 0.52)
    master_path = ROOT / "assets/Splash_petitmo_gradient.png"
    master.save(master_path, optimize=True)
    print("wrote", master_path, master.size)

    legacy = ROOT / "ios/Petitmo/Images.xcassets/SplashScreenLegacy.imageset"
    for name, size in {
        "image.png": (414, 896),
        "image@2x.png": (828, 1792),
        "image@3x.png": (1242, 2688),
    }.items():
        out = aspect_fill_resize(master, *size)
        out.save(legacy / name, optimize=True)
        print("wrote", name, out.size)

    content = logo_content()
    for folder, size in {
        "drawable-mdpi": 288,
        "drawable-hdpi": 432,
        "drawable-xhdpi": 576,
        "drawable-xxhdpi": 864,
        "drawable-xxxhdpi": 1152,
    }.items():
        sq = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        tw = int(size * 0.72)
        th = int(tw * content.height / content.width)
        r = content.resize((tw, th), Image.Resampling.LANCZOS)
        sq.paste(r, ((size - tw) // 2, (size - th) // 2), r)
        path = ROOT / f"android/app/src/main/res/{folder}/splashscreen_logo.png"
        sq.save(path, optimize=True)
        print("wrote", path.relative_to(ROOT))


if __name__ == "__main__":
    main()
