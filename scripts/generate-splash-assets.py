#!/usr/bin/env python3
"""
Régénère splash + logos Android à partir du lockup blanc
`assets/images/logo_petit_coeur_48_white.png`
(source maître : LOGO_4_bulle_v2_transp → scripts/compose-brand-from-logo4.py).

Usage :
  python3 scripts/generate-splash-assets.py
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]

TL = np.array([0xFD, 0x62, 0x8D], dtype=np.float64)  # rose / fuchsia brief
TR = np.array([0xFD, 0x6F, 0x9F], dtype=np.float64)  # rose
BL = np.array([0xFA, 0x5D, 0x4E], dtype=np.float64)  # coral logo
BR = np.array([0xFB, 0x8F, 0x22], dtype=np.float64)  # orangé


def diagonal_gradient(w: int, h: int) -> Image.Image:
    yy = np.linspace(0, 1, h)[:, None, None]
    xx = np.linspace(0, 1, w)[None, :, None]
    top = TL * (1 - xx) + TR * xx
    bot = BL * (1 - xx) + BR * xx
    return Image.fromarray((top * (1 - yy) + bot * yy).astype(np.uint8), "RGB")


def logo_content() -> Image.Image:
    return Image.open(ROOT / "assets/images/logo_petit_coeur_48_white.png").convert("RGBA")


def bubble_content() -> Image.Image:
    path = ROOT / "assets/images/logo_petit_coeur_bulle_white.png"
    if path.exists():
        return Image.open(path).convert("RGBA")
    return logo_content()


def compose_splash(w: int, h: int, logo_width_frac: float = 0.58) -> Image.Image:
    bg = diagonal_gradient(w, h).convert("RGBA")
    logo = logo_content()
    target_w = int(round(w * logo_width_frac))
    target_h = int(round(target_w * (logo.height / logo.width)))
    logo_r = logo.resize((target_w, target_h), Image.Resampling.LANCZOS)
    bg.alpha_composite(logo_r, ((w - target_w) // 2, (h - target_h) // 2))
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
    master = compose_splash(1284, 2778, 0.58)
    master_path = ROOT / "assets/Splash_petitmo_gradient.png"
    master.save(master_path, optimize=True)
    print("wrote", master_path, master.size)

    diagonal_gradient(1284, 2778).save(ROOT / "assets/Splash_bg_gradient.png", optimize=True)

    legacy = ROOT / "ios/Petitmo/Images.xcassets/SplashScreenLegacy.imageset"
    for name, size in {
        "image.png": (414, 896),
        "image@2x.png": (828, 1792),
        "image@3x.png": (1242, 2688),
    }.items():
        out = aspect_fill_resize(master, *size)
        out.save(legacy / name, optimize=True)
        print("wrote", name, out.size)

    content = bubble_content()
    for folder, size in {
        "drawable-mdpi": 288,
        "drawable-hdpi": 432,
        "drawable-xhdpi": 576,
        "drawable-xxhdpi": 864,
        "drawable-xxxhdpi": 1152,
    }.items():
        sq = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        tw = int(size * 0.78)
        th = int(tw * content.height / content.width)
        r = content.resize((tw, th), Image.Resampling.LANCZOS)
        sq.alpha_composite(r, ((size - tw) // 2, (size - th) // 2))
        path = ROOT / f"android/app/src/main/res/{folder}/splashscreen_logo.png"
        sq.save(path, optimize=True)
        print("wrote", path.relative_to(ROOT))


if __name__ == "__main__":
    main()
