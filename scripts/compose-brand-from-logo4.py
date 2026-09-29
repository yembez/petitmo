#!/usr/bin/env python3
"""
Compose brand assets from LOGO_4_bulle_v2_transp.png :
  - lockup blanc / noir / coral
  - bulle blanche
  - icône app 1024 (fond coral source, bulle blanche, cœur en trou)
  - splash (optionnel si --splash)

Usage :
  python3 scripts/compose-brand-from-logo4.py \\
    --src /Users/yem/SWEETOO_PROJECT/LOGO/PETIT_COEUR/LOGO_4_bulle_v2_transp.png
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SRC = Path(
    "/Users/yem/SWEETOO_PROJECT/LOGO/PETIT_COEUR/LOGO_4_bulle_v2_transp.png"
)


def content_bbox(mask: np.ndarray, pad: int = 8) -> tuple[int, int, int, int]:
    ys, xs = np.where(mask)
    h, w = mask.shape
    return (
        max(0, int(xs.min()) - pad),
        max(0, int(ys.min()) - pad),
        min(w, int(xs.max()) + pad + 1),
        min(h, int(ys.max()) + pad + 1),
    )


def coral_mask(a: np.ndarray) -> np.ndarray:
    alpha = a[:, :, 3]
    r, g, b = a[:, :, 0].astype(np.float32), a[:, :, 1].astype(np.float32), a[:, :, 2].astype(
        np.float32
    )
    return (alpha > 20) & (r > 180) & (r > g + 30) & (r > b + 30)


def to_white_rgba(a: np.ndarray, coral: np.ndarray) -> Image.Image:
    out = np.zeros_like(a)
    out[coral, 0:3] = 255
    out[coral, 3] = a[coral, 3]
    fringe = (a[:, :, 3] > 5) & ~coral
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    pinkish = fringe & (r > g) & (r > b)
    out[pinkish, 0:3] = 255
    out[pinkish, 3] = a[pinkish, 3]
    return Image.fromarray(out, "RGBA")


def icon_mask(coral: np.ndarray) -> np.ndarray:
    ys, xs = np.where(coral)
    hist = np.bincount(xs, minlength=coral.shape[1])
    cols = np.where(hist > 30)[0]
    split = coral.shape[1] // 2
    for i in range(len(cols) - 1):
        if cols[i + 1] - cols[i] > 40:
            split = int((cols[i] + cols[i + 1]) // 2)
            break
    return coral & (np.arange(coral.shape[1])[None, :] < split)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--src", type=Path, default=DEFAULT_SRC)
    p.add_argument("--splash", action="store_true", help="Régénère aussi le splash natif")
    args = p.parse_args()
    if not args.src.exists():
        raise SystemExit(f"missing source: {args.src}")

    im = Image.open(args.src).convert("RGBA")
    a = np.array(im)
    coral = coral_mask(a)
    mean = a[coral][:, :3].mean(axis=0).astype(np.uint8)
    coral_rgb = tuple(int(x) for x in mean)
    print(f"source coral #{coral_rgb[0]:02X}{coral_rgb[1]:02X}{coral_rgb[2]:02X} size={im.size}")

    assets = ROOT / "assets/images"
    shutil.copy2(args.src, assets / "logo_petit_coeur_4_bulle_v2_transp.png")

    white_full = to_white_rgba(a, coral)
    box = content_bbox(coral, pad=16)
    white_lockup = white_full.crop(box)
    tw, th = 900, int(round(900 * white_lockup.height / white_lockup.width))
    white_r = white_lockup.resize((tw, th), Image.Resampling.LANCZOS)
    white_r.save(assets / "logo_petit_coeur_48_white.png", optimize=True)

    noir = np.array(white_r)
    m = noir[:, :, 3] > 0
    noir[m, 0:3] = 28
    Image.fromarray(noir, "RGBA").save(assets / "logo_petit_coeur_48_noir.png", optimize=True)

    Image.fromarray(a, "RGBA").crop(box).resize((tw, th), Image.Resampling.LANCZOS).save(
        assets / "logo_petit_coeur_48_coral.png", optimize=True
    )

    imask = icon_mask(coral)
    ibox = content_bbox(imask, pad=24)
    bubble_white = to_white_rgba(a, coral).crop(ibox)
    bubble_white.save(assets / "logo_petit_coeur_bulle_white.png", optimize=True)

    ICON = 1024
    bw = np.array(bubble_white)
    max_dim = max(bw.shape[0], bw.shape[1])
    target = int(ICON * 0.72)
    ratio = target / max_dim
    nw, nh = int(round(bw.shape[1] * ratio)), int(round(bw.shape[0] * ratio))
    bubble_scaled = bubble_white.resize((nw, nh), Image.Resampling.LANCZOS)
    base = Image.new("RGBA", (ICON, ICON), (*coral_rgb, 255))
    base.alpha_composite(bubble_scaled, ((ICON - nw) // 2, (ICON - nh) // 2))
    icon_path = assets / "icon_petit_coeur_heart.png"
    base.convert("RGB").save(icon_path, optimize=True)
    shutil.copy2(
        icon_path,
        ROOT / "ios/Petitmo/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png",
    )
    print("wrote", icon_path)

    if args.splash:
        subprocess.check_call([sys.executable, str(ROOT / "scripts/generate-splash-assets.py")])


if __name__ == "__main__":
    main()
