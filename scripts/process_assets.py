#!/usr/bin/env python3
"""
Post-process AI-generated raw artwork into crisp Warcraft III raster game assets:
  - tile: 256x256 seamless top-down terrain texture with soft edge cross-fade
  - cutout: border-connected BFS flood-fill background removal (preserves interior white/ice)
  - sheet_cutout: split 2x2 grid into 4 cutouts
  - sheet_glow: split 2x2 black-background VFX/projectile sheet into luminance-alpha PNGs
  - icon_grid: split 3x3 or 2x2 War3 icon grid, auto-trim gutter margins, save 112x112 PNGs
  - banner: resize 16:9 lobby banner to 960x420 JPEG
"""

import argparse
import math
import os
from collections import deque
from pathlib import Path
from PIL import Image, ImageChops


def ensure_dir(path: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)


def process_tile(src: str, dst: str, size: int = 256) -> None:
    ensure_dir(dst)
    im = Image.open(src).convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
    # Subtle 16px edge blend against offset half-shifted image to eliminate visible tile seams
    half = size // 2
    shifted = ImageChops.offset(im, half, half)
    px = list(im.getdata())
    spx = list(shifted.getdata())
    blend_margin = 14
    out = []
    for y in range(size):
        dy = min(y, size - 1 - y)
        wy = max(0.0, min(1.0, (blend_margin - dy) / blend_margin)) if dy < blend_margin else 0.0
        row_off = y * size
        for x in range(size):
            dx = min(x, size - 1 - x)
            wx = max(0.0, min(1.0, (blend_margin - dx) / blend_margin)) if dx < blend_margin else 0.0
            w = max(wx, wy) * 0.5
            r0, g0, b0, _ = px[row_off + x]
            r1, g1, b1, _ = spx[row_off + x]
            r = int(r0 * (1.0 - w) + r1 * w)
            g = int(g0 * (1.0 - w) + g1 * w)
            b = int(b0 * (1.0 - w) + b1 * w)
            out.append((r, g, b, 255))
    res = Image.new("RGBA", (size, size))
    res.putdata(out)
    res.convert("RGB").save(dst, format="PNG", optimize=True)


def rgb_dist(c1: tuple[int, int, int], c2: tuple[int, int, int]) -> float:
    dr = c1[0] - c2[0]
    dg = c1[1] - c2[1]
    db = c1[2] - c2[2]
    return math.sqrt(dr * dr + dg * dg + db * db)


def cutout_image(
    im: Image.Image,
    target_size: int,
    pad_ratio: float = 0.06,
    tol_hard: float = 46.0,
    tol_soft: float = 78.0,
    clear_interior_white: bool = False,
) -> Image.Image:
    im = im.convert("RGBA")
    w, h = im.size
    px = list(im.getdata())

    # Detect background color from 4 corners
    corners = [
        px[0][:3],
        px[w - 1][:3],
        px[(h - 1) * w][:3],
        px[(h - 1) * w + (w - 1)][:3],
    ]
    bg = (
        sum(c[0] for c in corners) // 4,
        sum(c[1] for c in corners) // 4,
        sum(c[2] for c in corners) // 4,
    )
    is_magenta_bg = bg[0] > 170 and bg[1] < 95 and bg[2] > 170

    visited = bytearray(w * h)
    is_bg = bytearray(w * h)
    q: deque[int] = deque()

    def try_seed(idx: int) -> None:
        if not visited[idx]:
            visited[idx] = 1
            if rgb_dist(px[idx][:3], bg) <= tol_soft:
                q.append(idx)

    for x in range(w):
        try_seed(x)
        try_seed((h - 1) * w + x)
    for y in range(h):
        try_seed(y * w)
        try_seed(y * w + (w - 1))

    while q:
        idx = q.popleft()
        is_bg[idx] = 1
        x = idx % w
        y = idx // w
        if x > 0:
            ni = idx - 1
            if not visited[ni]:
                visited[ni] = 1
                if rgb_dist(px[ni][:3], bg) <= tol_soft:
                    q.append(ni)
        if x + 1 < w:
            ni = idx + 1
            if not visited[ni]:
                visited[ni] = 1
                if rgb_dist(px[ni][:3], bg) <= tol_soft:
                    q.append(ni)
        if y > 0:
            ni = idx - w
            if not visited[ni]:
                visited[ni] = 1
                if rgb_dist(px[ni][:3], bg) <= tol_soft:
                    q.append(ni)
        if y + 1 < h:
            ni = idx + w
            if not visited[ni]:
                visited[ni] = 1
                if rgb_dist(px[ni][:3], bg) <= tol_soft:
                    q.append(ni)

    # Punch out enclosed #FF00FF magenta pockets (or pure white pockets if requested)
    if is_magenta_bg:
        for idx, (r, g, b, _) in enumerate(px):
            if not is_bg[idx]:
                mag_dom = min(r, b) - g
                if rgb_dist((r, g, b), bg) <= 108.0 or (mag_dom >= 58 and r > 135 and b > 135):
                    is_bg[idx] = 1
    elif clear_interior_white and min(bg) >= 240:
        for idx, (r, g, b, _) in enumerate(px):
            if not is_bg[idx] and min(r, g, b) >= 244 and (max(r, g, b) - min(r, g, b)) <= 10:
                is_bg[idx] = 1

    # Apply smooth alpha + despill on background pixels
    out = []
    min_x, min_y, max_x, max_y = w, h, -1, -1
    eff_hard = max(tol_hard, 76.0) if is_magenta_bg else tol_hard
    eff_soft = max(tol_soft, 118.0) if is_magenta_bg else tol_soft

    for idx, (r, g, b, a) in enumerate(px):
        if is_bg[idx]:
            d = rgb_dist((r, g, b), bg)
            if d <= eff_hard or (is_magenta_bg and (min(r, b) - g) >= 58):
                out.append((0, 0, 0, 0))
                continue
            t = max(0.0, min(1.0, (d - eff_hard) / max(1.0, eff_soft - eff_hard)))
            na = int(a * t)
            inv = 1.0 - t
            nr = max(0, min(255, int((r - bg[0] * inv) / max(0.25, t))))
            ng = max(0, min(255, int((g - bg[1] * inv) / max(0.25, t))))
            nb = max(0, min(255, int((b - bg[2] * inv) / max(0.25, t))))
            if is_magenta_bg and min(nr, nb) - ng > 18:
                nr = min(nr, int(ng + (nr - ng) * 0.25))
                nb = min(nb, int(ng + (nb - ng) * 0.25))
            out.append((nr, ng, nb, na))
            if na > 16:
                x = idx % w
                y = idx // w
                if x < min_x: min_x = x
                if x > max_x: max_x = x
                if y < min_y: min_y = y
                if y > max_y: max_y = y
        else:
            out.append((r, g, b, a))
            if a > 16:
                x = idx % w
                y = idx // w
                if x < min_x: min_x = x
                if x > max_x: max_x = x
                if y < min_y: min_y = y
                if y > max_y: max_y = y

    # 2px edge magenta-despill pass so purple halos vanish around bright sprites
    if is_magenta_bg:
        cleaned = list(out)
        for y in range(h):
            row = y * w
            for x in range(w):
                idx = row + x
                r, g, b, a = out[idx]
                if a <= 10:
                    continue
                near_trans = False
                for dy in range(-2, 3):
                    ny = y + dy
                    if 0 <= ny < h:
                        for dx in range(-2, 3):
                            nx = x + dx
                            if 0 <= nx < w and out[ny * w + nx][3] < 40:
                                near_trans = True
                                break
                    if near_trans:
                        break
                if near_trans and min(r, b) - g > 16:
                    nr = min(r, int(g + (r - g) * 0.25))
                    nb = min(b, int(g + (b - g) * 0.25))
                    na = int(a * max(0.35, 1.0 - (min(r, b) - g) / 140.0))
                    cleaned[idx] = (nr, g, nb, na)
        out = cleaned

    res = Image.new("RGBA", (w, h))
    res.putdata(out)

    if max_x >= min_x and max_y >= min_y:
        cropped = res.crop((min_x, min_y, max_x + 1, max_y + 1))
    else:
        cropped = res

    cw, ch = cropped.size
    side = max(cw, ch)
    pad = max(2, int(side * pad_ratio))
    canvas_side = side + pad * 2
    sq = Image.new("RGBA", (canvas_side, canvas_side), (0, 0, 0, 0))
    sq.paste(cropped, ((canvas_side - cw) // 2, (canvas_side - ch) // 2), cropped)
    return sq.resize((target_size, target_size), Image.Resampling.LANCZOS)


def process_cutout(
    src: str,
    dst: str,
    size: int,
    tol_hard: float = 46.0,
    tol_soft: float = 78.0,
    clear_interior_white: bool = False,
) -> None:
    ensure_dir(dst)
    im = Image.open(src)
    out = cutout_image(im, size, tol_hard=tol_hard, tol_soft=tol_soft, clear_interior_white=clear_interior_white)
    out.save(dst, format="PNG", optimize=True)


def process_sheet_cutout(src: str, dsts: list[str], size: int) -> None:
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    hw, hh = w // 2, h // 2
    boxes = [
        (0, 0, hw, hh),
        (hw, 0, w, hh),
        (0, hh, hw, h),
        (hw, hh, w, h),
    ]
    for box, dst in zip(boxes, dsts):
        ensure_dir(dst)
        sub = im.crop(box)
        out = cutout_image(sub, size)
        out.save(dst, format="PNG", optimize=True)


def glow_cutout(im: Image.Image, target_size: int) -> Image.Image:
    im = im.convert("RGBA")
    w, h = im.size
    px = list(im.getdata())
    out = []
    min_x, min_y, max_x, max_y = w, h, -1, -1
    for idx, (r, g, b, _) in enumerate(px):
        lum = max(r, g, b)
        if lum < 16:
            out.append((0, 0, 0, 0))
            continue
        a = min(255, int(((lum - 16) / 200.0) * 255))
        scale = 255.0 / max(1, lum)
        nr = min(255, int(r * scale * 0.95))
        ng = min(255, int(g * scale * 0.95))
        nb = min(255, int(b * scale * 0.95))
        out.append((nr, ng, nb, a))
        if a > 20:
            x = idx % w
            y = idx // w
            if x < min_x: min_x = x
            if x > max_x: max_x = x
            if y < min_y: min_y = y
            if y > max_y: max_y = y

    res = Image.new("RGBA", (w, h))
    res.putdata(out)
    if max_x >= min_x and max_y >= min_y:
        cropped = res.crop((min_x, min_y, max_x + 1, max_y + 1))
    else:
        cropped = res
    cw, ch = cropped.size
    side = max(cw, ch)
    pad = max(2, int(side * 0.06))
    sq = Image.new("RGBA", (side + pad * 2, side + pad * 2), (0, 0, 0, 0))
    sq.paste(cropped, ((sq.width - cw) // 2, (sq.height - ch) // 2), cropped)
    return sq.resize((target_size, target_size), Image.Resampling.LANCZOS)


def process_sheet_glow(src: str, dsts: list[str], size: int) -> None:
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    hw, hh = w // 2, h // 2
    boxes = [
        (0, 0, hw, hh),
        (hw, 0, w, hh),
        (0, hh, hw, h),
        (hw, hh, w, h),
    ]
    for box, dst in zip(boxes, dsts):
        ensure_dir(dst)
        sub = im.crop(box)
        out = glow_cutout(sub, size)
        out.save(dst, format="PNG", optimize=True)


def process_single_glow(src: str, dst: str, size: int) -> None:
    ensure_dir(dst)
    im = Image.open(src).convert("RGBA")
    out = glow_cutout(im, size)
    out.save(dst, format="PNG", optimize=True)


def trim_gutter(cell: Image.Image) -> Image.Image:
    cell = cell.convert("RGB")
    w, h = cell.size
    px = cell.load()
    max_trim = int(min(w, h) * 0.14)

    def row_std(y: int) -> float:
        vals = [px[x, y][0] + px[x, y][1] + px[x, y][2] for x in range(w)]
        avg = sum(vals) / len(vals)
        return math.sqrt(sum((v - avg) ** 2 for v in vals) / len(vals))

    def col_std(x: int) -> float:
        vals = [px[x, y][0] + px[x, y][1] + px[x, y][2] for y in range(h)]
        avg = sum(vals) / len(vals)
        return math.sqrt(sum((v - avg) ** 2 for v in vals) / len(vals))

    top = 0
    while top < max_trim and row_std(top) < 18.0:
        top += 1
    bottom = h - 1
    while h - 1 - bottom < max_trim and row_std(bottom) < 18.0:
        bottom -= 1
    left = 0
    while left < max_trim and col_std(left) < 18.0:
        left += 1
    right = w - 1
    while w - 1 - right < max_trim and col_std(right) < 18.0:
        right -= 1

    if right - left < w * 0.5 or bottom - top < h * 0.5:
        inset = int(min(w, h) * 0.04)
        return cell.crop((inset, inset, w - inset, h - inset))
    cropped = cell.crop((left, top, right + 1, bottom + 1))
    cw, ch = cropped.size
    side = min(cw, ch)
    cx, cy = (cw - side) // 2, (ch - side) // 2
    return cropped.crop((cx, cy, cx + side, cy + side))


def process_icon_grid(src: str, dsts: list[str], cols: int, rows: int, size: int = 112) -> None:
    im = Image.open(src).convert("RGB")
    w, h = im.size
    cw = w / cols
    ch = h / rows
    idx = 0
    for r in range(rows):
        for c in range(cols):
            if idx >= len(dsts):
                return
            dst = dsts[idx]
            idx += 1
            ensure_dir(dst)
            cell = im.crop((int(c * cw), int(r * ch), int((c + 1) * cw), int((r + 1) * ch)))
            trimmed = trim_gutter(cell)
            out = trimmed.resize((size, size), Image.Resampling.LANCZOS)
            out.save(dst, format="PNG", optimize=True)


def process_banner(src: str, dst: str, tw: int = 960, th: int = 420) -> None:
    ensure_dir(dst)
    im = Image.open(src).convert("RGB")
    w, h = im.size
    target_ratio = tw / th
    cur_ratio = w / h
    if cur_ratio > target_ratio:
        nw = int(h * target_ratio)
        x0 = (w - nw) // 2
        im = im.crop((x0, 0, x0 + nw, h))
    else:
        nh = int(w / target_ratio)
        y0 = (h - nh) // 2
        im = im.crop((0, y0, w, y0 + nh))
    im.resize((tw, th), Image.Resampling.LANCZOS).save(dst, format="JPEG", quality=86, optimize=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["tile", "cutout", "sheet_cutout", "sheet_glow", "single_glow", "icon_grid", "banner"])
    ap.add_argument("src")
    ap.add_argument("dsts", nargs="+")
    ap.add_argument("--size", type=int, default=160)
    ap.add_argument("--cols", type=int, default=3)
    ap.add_argument("--rows", type=int, default=3)
    args = ap.parse_args()

    if args.mode == "tile":
        process_tile(args.src, args.dsts[0], args.size)
    elif args.mode == "cutout":
        process_cutout(args.src, args.dsts[0], args.size)
    elif args.mode == "sheet_cutout":
        process_sheet_cutout(args.src, args.dsts, args.size)
    elif args.mode == "sheet_glow":
        process_sheet_glow(args.src, args.dsts, args.size)
    elif args.mode == "single_glow":
        process_single_glow(args.src, args.dsts[0], args.size)
    elif args.mode == "icon_grid":
        process_icon_grid(args.src, args.dsts, args.cols, args.rows, args.size)
    elif args.mode == "banner":
        process_banner(args.src, args.dsts[0])


if __name__ == "__main__":
    main()
