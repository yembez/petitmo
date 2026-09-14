#!/usr/bin/env python3
"""Icône app depuis petit-coeur_heart-axo-outline_epais_1.png (traits épaissis proprement)."""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

TOP = (0xFD, 0x62, 0x8D)
BOT = (0xFD, 0x67, 0x64)


def thicken_alpha(alpha: np.ndarray, radius: float, aa: float = 1.5) -> np.ndarray:
    ink = alpha.astype(np.float32) / 255.0
    binary = ink > 0.2
    dist = ndimage.distance_transform_edt(~binary)
    soft = np.clip((radius + aa * 0.5 - dist) / aa, 0, 1)
    soft = np.maximum(soft, ink)
    soft = ndimage.gaussian_filter(soft, sigma=0.5)
    return np.clip(soft, 0, 1)


def compose(src: Path, out: Path, *, radius: float, scale: float, size: int) -> None:
    arr = np.array(Image.open(src).convert("RGBA"))
    soft = thicken_alpha(arr[:, :, 3], radius)
    h, w = soft.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[:, :, 0:3] = 255
    rgba[:, :, 3] = (soft * 255).astype(np.uint8)
    heart = Image.fromarray(rgba, "RGBA")

    ys, xs = np.where(soft > 0.04)
    pad = 10
    box = (
        max(0, int(xs.min()) - pad),
        max(0, int(ys.min()) - pad),
        min(w, int(xs.max()) + pad + 1),
        min(h, int(ys.max()) + pad + 1),
    )
    cropped = heart.crop(box)
    max_dim = max(cropped.size)
    target = int(round(size * scale))
    ratio = target / max_dim
    nw = int(round(cropped.width * ratio))
    nh = int(round(cropped.height * ratio))
    scaled = cropped.resize((nw, nh), Image.Resampling.LANCZOS)

    top = np.array(TOP, np.float32)
    bot = np.array(BOT, np.float32)
    yy = np.linspace(0, 1, size, dtype=np.float32)[:, None, None]
    grad = (top * (1 - yy) + bot * yy).astype(np.uint8)
    grad = np.broadcast_to(grad, (size, size, 3)).copy()
    base = Image.fromarray(grad, "RGB").convert("RGBA")
    base.alpha_composite(scaled, ((size - nw) // 2, (size - nh) // 2))
    base.convert("RGB").save(out, "PNG", optimize=True)
    print(f"wrote {out} (radius={radius}, scale={scale}, heart={nw}x{nh})")


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    p = argparse.ArgumentParser()
    p.add_argument(
        "--src",
        type=Path,
        default=root / "assets/images/logo_petit_coeur_heart_epais_source.png",
    )
    p.add_argument(
        "--out",
        type=Path,
        default=root / "assets/images/icon_petit_coeur_heart.png",
    )
    p.add_argument("--ios", type=Path, default=root / "ios/Petitmo/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png")
    p.add_argument("--radius", type=float, default=7.0)
    p.add_argument("--scale", type=float, default=0.64)
    args = p.parse_args()
    compose(args.src, args.out, radius=args.radius, scale=args.scale, size=1024)
    if args.ios:
        shutil.copy2(args.out, args.ios)
        print(f"wrote {args.ios}")


if __name__ == "__main__":
    main()
