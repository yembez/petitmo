#!/usr/bin/env python3
"""Compose l'icône app 1024 : cœur blanc (PNG RGBA) sur dégradé splash."""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image
import numpy as np

TOP = (0xFD, 0x62, 0x8D)
BOT = (0xFD, 0x67, 0x64)


def compose(heart_path: Path, out_path: Path, size: int = 1024, scale: float = 0.62) -> None:
    heart = Image.open(heart_path).convert("RGBA")
    a = np.array(heart)
    alpha = a[:, :, 3]
    ys, xs = np.where(alpha > 12)
    if len(xs) == 0:
        raise SystemExit(f"no opaque pixels in {heart_path}")
    pad = 8
    box = (
        max(0, int(xs.min()) - pad),
        max(0, int(ys.min()) - pad),
        min(heart.width, int(xs.max()) + pad + 1),
        min(heart.height, int(ys.max()) + pad + 1),
    )
    cropped = heart.crop(box)
    max_dim = max(cropped.size)
    target = int(round(size * scale))
    ratio = target / max_dim
    nw = int(round(cropped.width * ratio))
    nh = int(round(cropped.height * ratio))
    scaled = cropped.resize((nw, nh), Image.Resampling.LANCZOS)

    top = np.array(TOP, dtype=np.float32)
    bot = np.array(BOT, dtype=np.float32)
    yy = np.linspace(0, 1, size, dtype=np.float32)[:, None, None]
    grad = (top * (1 - yy) + bot * yy).astype(np.uint8)
    grad = np.broadcast_to(grad, (size, size, 3)).copy()
    base = Image.fromarray(grad, "RGB").convert("RGBA")
    base.alpha_composite(scaled, ((size - nw) // 2, (size - nh) // 2))
    base.convert("RGB").save(out_path, "PNG", optimize=True)
    print(f"wrote {out_path} ({size}×{size}, heart={nw}×{nh})")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit("usage: compose-app-icon.py <heart.png> <out.png> [scale]")
    scale = float(sys.argv[3]) if len(sys.argv) > 3 else 0.62
    compose(Path(sys.argv[1]), Path(sys.argv[2]), scale=scale)
