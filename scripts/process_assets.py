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
from PIL import Image, ImageChops, ImageEnhance, ImageFilter


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


def extract_cutout_rgba(
    im: Image.Image,
    tol_hard: float = 46.0,
    tol_soft: float = 78.0,
    clear_interior_white: bool = False,
    aggressive_magenta: bool = False,
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
        mag_thresh = 28 if aggressive_magenta else 58
        dist_thresh = 136.0 if aggressive_magenta else 108.0
        for idx, (r, g, b, _) in enumerate(px):
            if not is_bg[idx]:
                mag_dom = min(r, b) - g
                if rgb_dist((r, g, b), bg) <= dist_thresh or (mag_dom >= mag_thresh and r > 110 and b > 100):
                    is_bg[idx] = 1
    elif clear_interior_white and min(bg) >= 240:
        for idx, (r, g, b, _) in enumerate(px):
            if not is_bg[idx] and min(r, g, b) >= 244 and (max(r, g, b) - min(r, g, b)) <= 10:
                is_bg[idx] = 1

    # Apply smooth alpha + despill on background pixels
    out = []
    min_x, min_y, max_x, max_y = w, h, -1, -1
    eff_hard = max(tol_hard, 86.0 if aggressive_magenta else 76.0) if is_magenta_bg else tol_hard
    eff_soft = max(tol_soft, 142.0 if aggressive_magenta else 118.0) if is_magenta_bg else tol_soft
    hole_dom = 28 if aggressive_magenta else 58

    for idx, (r, g, b, a) in enumerate(px):
        if is_bg[idx]:
            d = rgb_dist((r, g, b), bg)
            if d <= eff_hard or (is_magenta_bg and (min(r, b) - g) >= hole_dom):
                out.append((0, 0, 0, 0))
                continue
            t = max(0.0, min(1.0, (d - eff_hard) / max(1.0, eff_soft - eff_hard)))
            na = int(a * t)
            inv = 1.0 - t
            nr = max(0, min(255, int((r - bg[0] * inv) / max(0.25, t))))
            ng = max(0, min(255, int((g - bg[1] * inv) / max(0.25, t))))
            nb = max(0, min(255, int((b - bg[2] * inv) / max(0.25, t))))
            if is_magenta_bg and min(nr, nb) - ng > (6 if aggressive_magenta else 18):
                if aggressive_magenta and nr >= ng:
                    nb = min(nb, int(ng * 0.72))
                else:
                    nr = min(nr, int(ng + (nr - ng) * 0.22))
                    nb = min(nb, int(ng + (nb - ng) * 0.22))
            out.append((nr, ng, nb, na))
            if na > 16:
                x = idx % w
                y = idx // w
                if x < min_x: min_x = x
                if x > max_x: max_x = x
                if y < min_y: min_y = y
                if y > max_y: max_y = y
        else:
            nr, ng, nb, na = r, g, b, a
            if is_magenta_bg and aggressive_magenta and min(nr, nb) - ng > 10 and nr >= ng:
                nb = min(nb, int(ng * 0.72))
            out.append((nr, ng, nb, na))
            if na > 16:
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
                if near_trans and min(r, b) - g > (6 if aggressive_magenta else 16):
                    if aggressive_magenta and r >= g:
                        nb = min(b, int(g * 0.72))
                        na = int(a * max(0.25, 1.0 - (min(r, b) - g) / 110.0))
                        cleaned[idx] = (r, g, nb, na)
                    else:
                        nr = min(r, int(g + (r - g) * 0.25))
                        nb = min(b, int(g + (b - g) * 0.25))
                        na = int(a * max(0.35, 1.0 - (min(r, b) - g) / 140.0))
                        cleaned[idx] = (nr, g, nb, na)
        out = cleaned

    res = Image.new("RGBA", (w, h))
    res.putdata(out)

    if max_x >= min_x and max_y >= min_y:
        return res.crop((min_x, min_y, max_x + 1, max_y + 1))
    return res


def cutout_image(
    im: Image.Image,
    target_size: int,
    pad_ratio: float = 0.06,
    tol_hard: float = 46.0,
    tol_soft: float = 78.0,
    clear_interior_white: bool = False,
) -> Image.Image:
    cropped = extract_cutout_rgba(
        im, tol_hard=tol_hard, tol_soft=tol_soft, clear_interior_white=clear_interior_white
    )
    cw, ch = cropped.size
    side = max(cw, ch)
    pad = max(2, int(side * pad_ratio))
    canvas_side = side + pad * 2
    sq = Image.new("RGBA", (canvas_side, canvas_side), (0, 0, 0, 0))
    sq.paste(cropped, ((canvas_side - cw) // 2, (canvas_side - ch) // 2), cropped)
    return sq.resize((target_size, target_size), Image.Resampling.LANCZOS)


def process_hero_anim_sheet(
    src: str,
    dsts: list[str],
    size: int = 192,
    clear_interior_white: bool = False,
    aggressive_magenta: bool = False,
) -> None:
    """Split a 2x2 hero sheet into 4 foot-anchored poses with consistent body height."""
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    hw, hh = w // 2, h // 2
    mx = max(2, int(hw * 0.02))
    my = max(2, int(hh * 0.02))
    boxes = [
        (0, 0, hw - mx, hh - my),
        (hw + mx, 0, w, hh - my),
        (0, hh + my, hw - mx, h),
        (hw + mx, hh + my, w, h),
    ]
    crops = [
        extract_cutout_rgba(
            im.crop(b),
            clear_interior_white=clear_interior_white,
            aggressive_magenta=aggressive_magenta,
        )
        for b in boxes
    ]
    max_h_ref = max(1, max(c.height for c in crops))
    base_scale = (size * 0.80) / max_h_ref
    foot_y = int(size * 0.90)

    for cropped, dst in zip(crops, dsts):
        ensure_dir(dst)
        cw, ch = cropped.size
        s = min(base_scale, (size * 0.88) / max(1, cw), (size * 0.82) / max(1, ch))
        nw = max(1, int(round(cw * s)))
        nh = max(1, int(round(ch * s)))
        resized = cropped.resize((nw, nh), Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        px = max(0, (size - nw) // 2)
        py = max(2, foot_y - nh)
        canvas.paste(resized, (px, py), resized)
        canvas.save(dst, format="PNG", optimize=True)


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


def process_splash(src: str, dst: str, width: int = 540, height: int = 720) -> None:
    ensure_dir(dst)
    im = Image.open(src).convert("RGB")
    w, h = im.size
    target_ratio = width / height
    cur_ratio = w / h
    if cur_ratio > target_ratio:
        nw = int(h * target_ratio)
        x0 = (w - nw) // 2
        im = im.crop((x0, 0, x0 + nw, h))
    else:
        nh = int(w / target_ratio)
        y0 = (h - nh) // 2
        im = im.crop((0, y0, w, y0 + nh))
    im.resize((width, height), Image.Resampling.LANCZOS).save(dst, format="JPEG", quality=88, optimize=True)


def derive_tinted_glow(
    src: str,
    dst: str,
    rgb_mult: tuple[float, float, float],
    size: int = 192,
    src2: str | None = None,
) -> None:
    """Create color-graded additive VFX variant from existing AI glow PNGs."""
    ensure_dir(dst)
    base = Image.open(src).convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
    px1 = list(base.getdata())
    px2 = None
    if src2:
        layer2 = Image.open(src2).convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
        px2 = list(layer2.getdata())

    mr, mg, mb = rgb_mult
    out = []
    for i, (r1, g1, b1, a1) in enumerate(px1):
        if px2 is not None:
            r2, g2, b2, a2 = px2[i]
            f1 = a1 / 255.0
            f2 = a2 / 255.0
            r = min(255, int(r1 * f1 + r2 * f2 * 0.72))
            g = min(255, int(g1 * f1 + g2 * f2 * 0.72))
            b = min(255, int(b1 * f1 + b2 * f2 * 0.72))
            a = min(255, int((f1 + f2 * (1.0 - f1 * 0.65)) * 255))
        else:
            r, g, b, a = r1, g1, b1, a1
        if a < 6:
            out.append((0, 0, 0, 0))
        else:
            nr = max(0, min(255, int(r * mr)))
            ng = max(0, min(255, int(g * mg)))
            nb = max(0, min(255, int(b * mb)))
            out.append((nr, ng, nb, a))
    res = Image.new("RGBA", (size, size))
    res.putdata(out)
    res.save(dst, format="PNG", optimize=True)


def glow_cutout_rect(im: Image.Image, target_w: int, target_h: int) -> Image.Image:
    """Luminance-alpha cutout preserving non-square aspect ratio inside (target_w, target_h)."""
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
        nr = min(255, int(r * scale * 0.96))
        ng = min(255, int(g * scale * 0.96))
        nb = min(255, int(b * scale * 0.96))
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
    pad_x = max(2, int(cw * 0.04))
    pad_y = max(2, int(ch * 0.04))
    fit_s = min((target_w - pad_x * 2) / max(1, cw), (target_h - pad_y * 2) / max(1, ch))
    nw = max(1, int(round(cw * fit_s)))
    nh = max(1, int(round(ch * fit_s)))
    resized = cropped.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
    canvas.paste(resized, ((target_w - nw) // 2, (target_h - nh) // 2), resized)
    return canvas


def process_sheet_glow_rect(src: str, specs: list[tuple[str, int, int]]) -> None:
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    hw, hh = w // 2, h // 2
    boxes = [(0, 0, hw, hh), (hw, 0, w, hh), (0, hh, hw, h), (hw, hh, w, h)]
    for box, (dst, tw, th) in zip(boxes, specs):
        ensure_dir(dst)
        out = glow_cutout_rect(im.crop(box), tw, th)
        out.save(dst, format="PNG", optimize=True)


def _tint_rgba(im: Image.Image, rgb: tuple[int, int, int], gain: float = 1.0, min_a: int = 4) -> Image.Image:
    """Colorize an RGBA sprite by luminance while preserving painted structure."""
    tr, tg, tb = rgb
    px = list(im.convert("RGBA").getdata())
    out = []
    for r, g, b, a in px:
        if a <= min_a:
            out.append((0, 0, 0, 0))
            continue
        lum = (0.3 * r + 0.58 * g + 0.12 * b) / 255.0
        core = max(0.0, lum - 0.72) / 0.28
        nr = min(255, int(tr * lum * gain + 255 * core * 0.55))
        ng = min(255, int(tg * lum * gain + 255 * core * 0.55))
        nb = min(255, int(tb * lum * gain + 255 * core * 0.55))
        na = min(255, int(a * gain))
        out.append((nr, ng, nb, na))
    res = Image.new("RGBA", im.size)
    res.putdata(out)
    return res


def _blend_max_rgba(layers: list[Image.Image]) -> Image.Image:
    base = layers[0].convert("RGBA")
    w, h = base.size
    acc = list(base.getdata())
    for layer in layers[1:]:
        lpx = list(layer.convert("RGBA").resize((w, h), Image.Resampling.LANCZOS).getdata())
        for i, (r0, g0, b0, a0) in enumerate(acc):
            r1, g1, b1, a1 = lpx[i]
            f1 = a1 / 255.0
            acc[i] = (
                min(255, int(max(r0, r1 * (0.4 + 0.6 * f1)) + min(r0, r1) * 0.35)),
                min(255, int(max(g0, g1 * (0.4 + 0.6 * f1)) + min(g0, g1) * 0.35)),
                min(255, int(max(b0, b1 * (0.4 + 0.6 * f1)) + min(b0, b1) * 0.35)),
                min(255, max(a0, a1) + min(a0, a1) // 3),
            )
    out = Image.new("RGBA", (w, h))
    out.putdata(acc)
    return out


def build_derived_raster_fx(assets_dir: Path, raw_dir: Path) -> None:
    """Build 100% raster VFX, rings, beams, shadows, feathered roads, carved plaza disc & UI plaques."""
    out = lambda name: str(assets_dir / name)

    # Check if optional fresh AI FX sheets exist first; otherwise derive richly from existing AI artwork
    def find_latest_raw(prefix: str) -> str | None:
        matches = sorted(raw_dir.glob(f"{prefix}_*.jpg")) + sorted(raw_dir.glob(f"{prefix}_*.png"))
        return str(matches[-1]) if matches else None

    fx_slash = Image.open(out("fx_slash.png")).convert("RGBA")
    fx_ring = Image.open(out("fx_holy_ring.png")).convert("RGBA")
    fx_frost = Image.open(out("fx_frost_burst.png")).convert("RGBA")
    fx_exp = Image.open(out("fx_explosion.png")).convert("RGBA")
    fx_spark = Image.open(out("fx_hit_spark.png")).convert("RGBA")
    fx_dust = Image.open(out("fx_dust_puff.png")).convert("RGBA")
    aura_pal = Image.open(out("fx_aura_paladin.png")).convert("RGBA")
    aura_arc = Image.open(out("fx_aura_arcane.png")).convert("RGBA")
    aura_wnd = Image.open(out("fx_aura_wind.png")).convert("RGBA")
    tile_cobble = Image.open(out("tile_cobble.png")).convert("RGBA")
    tile_road = Image.open(out("tile_road.png")).convert("RGBA")
    stone_panel = Image.open(out("ui_stone_panel.png")).convert("RGBA")

    # A. Beams, Lightning & Level-Up Pillar
    raw_beams = find_latest_raw("sheet_fx_beams_raw")
    if raw_beams:
        process_sheet_glow_rect(raw_beams, [
            (out("fx_beam_holy.png"), 256, 96),
            (out("fx_lightning_arc.png"), 256, 96),
            (out("fx_levelup_pillar.png"), 160, 280),
            (out("fx_beam_wind.png"), 256, 96),
        ])
    else:
        # Derive crisp painterly beams from AI slash/frost/holy sprites
        streak = fx_slash.rotate(-32, resample=Image.Resampling.BICUBIC).resize((256, 84), Image.Resampling.LANCZOS)
        streak_m = streak.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
        beam_core = Image.new("RGBA", (256, 96), (0, 0, 0, 0))
        bpx = beam_core.load()
        spx = streak.load()
        mpx = streak_m.load()
        for y in range(96):
            sy = max(0, min(83, int((y - 6) * 84 / 84)))
            wy = math.exp(-((y - 48) ** 2) / (2 * 13.5 ** 2))
            for x in range(256):
                wx = math.sin(math.pi * (x + 0.5) / 256.0) ** 0.45
                r0, g0, b0, a0 = spx[x, sy]
                r1, g1, b1, a1 = mpx[x, sy]
                tex = max(a0, a1) / 255.0
                lum = min(1.0, (0.55 * tex + 0.65 * wy) * wx * 1.15)
                if lum < 0.04:
                    continue
                core = (wy ** 2.6) * (0.45 + 0.55 * tex) * wx
                r = min(255, int(max(r0, r1) * 0.55 + 255 * lum * 0.55 + 255 * core))
                g = min(255, int(max(g0, g1) * 0.5 + 225 * lum * 0.55 + 250 * core))
                b = min(255, int(max(b0, b1) * 0.2 + 95 * lum + 225 * core))
                bpx[x, y] = (r, g, b, min(255, int(lum * 255)))
        beam_core.save(out("fx_beam_holy.png"), format="PNG", optimize=True)

        beam_wind = _tint_rgba(beam_core, (85, 250, 150), gain=1.08)
        beam_wind.save(out("fx_beam_wind.png"), format="PNG", optimize=True)

        # Jagged lightning bolt derived from fx_frost_burst spikes & noise displacement
        l_src = fx_frost.resize((256, 96), Image.Resampling.LANCZOS).load()
        l_img = Image.new("RGBA", (256, 96), (0, 0, 0, 0))
        lpx = l_img.load()
        for x in range(256):
            wx = math.sin(math.pi * (x + 0.5) / 256.0) ** 0.35
            jag = math.sin(x * 0.21) * 10.5 + math.sin(x * 0.47 + 1.1) * 6.0 + math.cos(x * 0.11) * 4.5
            jag2 = -jag * 0.6 + math.sin(x * 0.33 + 2.4) * 7.0
            for y in range(96):
                d1 = abs(y - (48 + jag))
                d2 = abs(y - (48 + jag2)) * 1.55
                d = min(d1, d2)
                sr, sg, sb, sa = l_src[x, y]
                shard = (sa / 255.0) * 0.32
                bolt = math.exp(-(d * d) / 14.0)
                halo = math.exp(-(d * d) / 92.0) * 0.65
                val = min(1.0, (bolt + halo + shard * math.exp(-((y - 48) ** 2) / 520.0)) * wx)
                if val < 0.04:
                    continue
                core = bolt ** 1.6 * wx
                lpx[x, y] = (
                    min(255, int(90 * val + 255 * core + sr * 0.25)),
                    min(255, int(205 * val + 255 * core + sg * 0.3)),
                    min(255, int(255 * val + sb * 0.35)),
                    min(255, int(val * 255)),
                )
        l_img.save(out("fx_lightning_arc.png"), format="PNG", optimize=True)

        # Level-up vertical light pillar
        pil_img = Image.new("RGBA", (160, 280), (0, 0, 0, 0))
        ppx = pil_img.load()
        r_src = fx_ring.resize((160, 160), Image.Resampling.LANCZOS).load()
        s_src = fx_spark.resize((160, 280), Image.Resampling.LANCZOS).load()
        for y in range(280):
            # Bright base rising upward cleanly
            vy = (279 - y) / 279.0
            fade_top = min(1.0, (y / 85.0)) * (1.0 - max(0.0, (y - 252) / 28.0))
            fade_h = (1.0 - vy * 0.65) * fade_top
            sy = y % 160
            for x in range(160):
                dx = abs(x - 80) / (46.0 - vy * 18.0)
                col = math.exp(-(dx * dx) * 1.8) * fade_h
                _, _, _, ra = r_src[x, sy]
                sr, sg, sb, sa = s_src[x, y]
                shaft = min(1.0, col * (0.72 + 0.35 * (ra / 255.0)) + (sa / 255.0) * 0.38 * math.exp(-(dx * dx)))
                if shaft < 0.04:
                    continue
                core = col ** 2.2
                ppx[x, y] = (
                    min(255, int(255 * shaft + sr * 0.2)),
                    min(255, int(218 * shaft + 37 * core + sg * 0.15)),
                    min(255, int(105 * shaft + 145 * core)),
                    min(255, int(shaft * 245)),
                )
        base_aura = _tint_rgba(aura_pal, (255, 224, 100), gain=1.15).resize((152, 86), Image.Resampling.LANCZOS)
        pil_img.alpha_composite(base_aura, (4, 192))
        pil_img.save(out("fx_levelup_pillar.png"), format="PNG", optimize=True)

    # B. Rings, Telegraphs, Shields & Statuses
    raw_rings = find_latest_raw("sheet_fx_rings_raw")
    if raw_rings:
        process_sheet_glow(
            raw_rings,
            [out("fx_telegraph_danger.png"), out("fx_target_lock.png"), out("_fx_shield_tmp.png"), out("fx_ring_local.png")],
            size=192,
        )
        Image.open(out("fx_telegraph_danger.png")).resize((224, 224), Image.Resampling.LANCZOS).save(out("fx_telegraph_danger.png"), optimize=True)
        sh_tmp = Image.open(out("_fx_shield_tmp.png"))
        _tint_rgba(sh_tmp, (253, 215, 75), gain=1.08).save(out("fx_shield_holy.png"), optimize=True)
        _tint_rgba(sh_tmp, (56, 196, 255), gain=1.1).save(out("fx_shield_arcane.png"), optimize=True)
        os.remove(out("_fx_shield_tmp.png"))
        _tint_rgba(Image.open(out("fx_ring_local.png")), (64, 196, 255), gain=1.08).save(out("fx_ring_ally.png"), optimize=True)
    else:
        # Hollow glowing rings derived directly from painted AI runic rings (aura_arc, aura_pal, fx_ring)
        def make_hollow_ring(src_ring: Image.Image, size: int, rgb: tuple[int, int, int], r_in: float, r_out: float, gain: float = 1.2) -> Image.Image:
            im = _tint_rgba(src_ring, rgb, gain=gain).resize((size, size), Image.Resampling.LANCZOS)
            px = im.load()
            half = size * 0.5
            res = Image.new("RGBA", (size, size), (0, 0, 0, 0))
            rpx = res.load()
            for y in range(size):
                for x in range(size):
                    rn = math.hypot(x - half + 0.5, y - half + 0.5) / half
                    if rn < r_in or rn > r_out:
                        continue
                    band = math.sin(math.pi * (rn - r_in) / max(0.01, r_out - r_in)) ** 0.45
                    r, g, b, a = px[x, y]
                    # Subtle boost right on the ring ridge
                    ridge = math.exp(-((rn - (r_in + r_out) * 0.52) ** 2) / 0.008) * 0.45
                    na = min(255, int(max(a * band, ridge * 170 * (0.4 + 0.6 * a / 255.0))))
                    if na > 6:
                        rpx[x, y] = (min(255, int(r + ridge * 40)), min(255, int(g + ridge * 40)), min(255, int(b + ridge * 40)), na)
            return res

        # 1. Danger telegraph ring & expanding danger core disc
        danger_ring = make_hollow_ring(aura_arc, 224, (255, 58, 58), 0.52, 0.96, gain=1.25)
        danger_ring.save(out("fx_telegraph_danger.png"), optimize=True)

        dfill = _tint_rgba(fx_exp, (239, 50, 50), gain=0.95).resize((224, 224), Image.Resampling.LANCZOS)
        dpx = dfill.load()
        for y in range(224):
            for x in range(224):
                rn = math.hypot(x - 111.5, y - 111.5) / 112.0
                r, g, b, a = dpx[x, y]
                fade = max(0.0, 1.0 - max(0.0, (rn - 0.62) / 0.34))
                na = int(min(185, max(a * 0.62, 110 * (1.0 - rn * 0.35))) * fade)
                dpx[x, y] = (min(255, max(r, 220)), min(255, max(g // 2, 35)), min(255, b // 2), na) if na > 5 else (0, 0, 0, 0)
        dfill.save(out("fx_telegraph_danger_fill.png"), optimize=True)

        # 2. Target Lock crimson 4-point rune reticle
        lock = make_hollow_ring(fx_ring, 192, (255, 72, 108), 0.46, 0.95, gain=1.35)
        lock.save(out("fx_target_lock.png"), optimize=True)

        # 3. Shield spheres (hollow dome rim + faint runic lattice)
        sh_base = _blend_max_rgba([make_hollow_ring(fx_ring, 192, (255, 255, 255), 0.62, 0.97, gain=1.3), _tint_rgba(aura_arc, (255, 255, 255), gain=0.45)])
        _tint_rgba(sh_base, (253, 220, 82), gain=1.1).save(out("fx_shield_holy.png"), optimize=True)
        _tint_rgba(sh_base, (64, 200, 255), gain=1.1).save(out("fx_shield_arcane.png"), optimize=True)

        # 4. Hero selection rune rings
        make_hollow_ring(aura_pal, 192, (86, 245, 138), 0.64, 0.95, gain=1.22).save(out("fx_ring_local.png"), optimize=True)
        make_hollow_ring(aura_arc, 192, (72, 198, 255), 0.64, 0.95, gain=1.18).save(out("fx_ring_ally.png"), optimize=True)

    # Always derive danger_fill if needed + boss/frost/nature/status variants
    if not os.path.exists(out("fx_telegraph_danger_fill.png")):
        dfill = _tint_rgba(fx_exp, (239, 50, 50), gain=0.95).resize((224, 224), Image.Resampling.LANCZOS)
        dfill.save(out("fx_telegraph_danger_fill.png"), optimize=True)

    _blend_max_rgba([
        _tint_rgba(aura_wnd, (244, 63, 94), gain=1.1),
        _tint_rgba(aura_arc, (192, 60, 252), gain=0.85),
    ]).resize((224, 224), Image.Resampling.LANCZOS).save(out("fx_boss_aura.png"), optimize=True)

    _blend_max_rgba([
        _tint_rgba(aura_arc, (56, 189, 248), gain=1.1),
        _tint_rgba(fx_frost, (165, 243, 252), gain=0.65),
    ]).resize((224, 224), Image.Resampling.LANCZOS).save(out("fx_telegraph_frost.png"), optimize=True)

    _blend_max_rgba([
        _tint_rgba(aura_pal, (74, 222, 128), gain=1.05),
        _tint_rgba(aura_wnd, (163, 230, 53), gain=0.75),
    ]).resize((224, 224), Image.Resampling.LANCZOS).save(out("fx_telegraph_nature.png"), optimize=True)

    # Orbiting 3-star stun crown from fx_spark
    stun = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    mini_star = _tint_rgba(fx_spark, (253, 224, 71), gain=1.2).resize((44, 44), Image.Resampling.LANCZOS)
    for k in range(3):
        ang = k * (math.pi * 2 / 3)
        sx = int(64 + math.cos(ang) * 32 - 22)
        sy = int(64 + math.sin(ang) * 20 - 22)
        stun.alpha_composite(mini_star, (sx, sy))
    stun.save(out("fx_status_stun.png"), optimize=True)

    # Slow frost ring from fx_frost + aura_arc
    _blend_max_rgba([
        _tint_rgba(fx_frost, (96, 218, 255), gain=0.85),
        _tint_rgba(aura_arc, (56, 189, 248), gain=1.0),
    ]).resize((160, 160), Image.Resampling.LANCZOS).save(out("fx_status_slow.png"), optimize=True)

    # C. Skill Aim Indicators & Env FX (firelight & sanctuary plaza rim)
    raw_aim = find_latest_raw("sheet_fx_aim_env_raw")
    if raw_aim:
        process_sheet_glow_rect(raw_aim, [
            (out("fx_aim_line.png"), 256, 96),
            (out("fx_aim_cone.png"), 224, 224),
            (out("fx_glow_fire.png"), 192, 192),
            (out("fx_plaza_rim.png"), 512, 512),
        ])
    else:
        # Crisp painted-texture directional lane pointing right (+X)
        tex_noise = fx_dust.resize((256, 96), Image.Resampling.LANCZOS).load()
        aim_line = Image.new("RGBA", (256, 96), (0, 0, 0, 0))
        alpx = aim_line.load()
        for y in range(96):
            dy = abs(y - 47.5) / 36.0
            if dy > 1.05:
                continue
            for x in range(256):
                # Slight tapered arrowhead at right tip
                tip_t = max(0.0, (x - 208) / 48.0)
                max_dy = 1.0 * (1.0 - tip_t * 0.88)
                ny = abs(y - 47.5) / max(4.0, 34.0 * max_dy)
                if ny > 1.0:
                    continue
                edge = math.exp(-((ny - 0.88) ** 2) / 0.014)
                chev = 0.25 if ((x - int(abs(y - 47.5) * 0.65)) % 44) < 7 and x > 24 else 0.0
                _, _, _, na = tex_noise[x, y]
                body = 0.24 + 0.14 * (na / 255.0)
                fade_l = min(1.0, x / 18.0)
                alpha_f = min(1.0, (body + edge * 0.82 + chev * 0.5) * fade_l)
                alpx[x, y] = (
                    min(255, int(62 + 170 * (edge + chev))),
                    min(255, int(205 + 50 * edge)),
                    255,
                    min(255, int(alpha_f * 235)),
                )
        aim_line.save(out("fx_aim_line.png"), optimize=True)

        # Crisp 60-deg cone sector pointing right (+X), apex centered at (112, 112)? No, apex at left/center (24, 112) rotated easily?
        # Keep centered at (112, 112) as full radius circle around caster with 60-deg sector carved out so center-rotation works naturally!
        aim_cone = Image.new("RGBA", (224, 224), (0, 0, 0, 0))
        acpx = aim_cone.load()
        arc_tex = aura_arc.resize((224, 224), Image.Resampling.LANCZOS).load()
        half_ang = math.pi / 6.0  # +-30 deg = 60 deg
        for y in range(224):
            for x in range(224):
                dx = x - 111.5
                dy = y - 111.5
                r = math.hypot(dx, dy)
                if r < 6 or r > 106:
                    continue
                ang = abs(math.atan2(dy, dx))
                if ang > half_ang:
                    continue
                rn = r / 106.0
                ang_edge = math.exp(-(((half_ang - ang) / 0.055) ** 2))
                arc_edge = math.exp(-(((1.0 - rn) / 0.05) ** 2))
                _, _, _, ta = arc_tex[x, y]
                fill = (0.20 + 0.18 * (ta / 255.0)) * min(1.0, r / 20.0)
                a_f = min(1.0, fill + max(ang_edge, arc_edge) * 0.82)
                rim = max(ang_edge, arc_edge)
                acpx[x, y] = (
                    min(255, int(58 + 165 * rim)),
                    min(255, int(200 + 55 * rim)),
                    255,
                    min(255, int(a_f * 230)),
                )
        aim_cone.save(out("fx_aim_cone.png"), optimize=True)

        # Warm flickering soft brazier ambient glow
        glow_fire = _blend_max_rgba([
            _tint_rgba(fx_dust, (255, 138, 38), gain=1.05),
            _tint_rgba(fx_ring, (255, 196, 72), gain=0.45),
        ]).resize((192, 192), Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(radius=8.5))
        gfpx = glow_fire.load()
        for y in range(192):
            for x in range(192):
                rn = math.hypot(x - 95.5, y - 95.5) / 96.0
                if rn >= 0.98:
                    gfpx[x, y] = (0, 0, 0, 0)
                    continue
                r, g, b, a = gfpx[x, y]
                falloff = max(0.0, 1.0 - rn) ** 1.55
                edge = max(0.0, 1.0 - max(0.0, (rn - 0.55) / 0.43))
                na = int(min(215, (a * 0.48 + 165 * falloff)) * edge)
                gfpx[x, y] = (min(255, max(r, int(255 * falloff))), min(255, max(g, int(146 * falloff))), min(255, max(b, int(44 * falloff))), na)
        glow_fire.save(out("fx_glow_fire.png"), optimize=True)

    # Always generate crisp 768x768 Sanctuary curb, portal biome halos, range / aoe / cancel aiming sprites
    _tint_rgba(aura_arc, (255, 206, 78), gain=1.18).resize((192, 192), Image.Resampling.LANCZOS).save(out("fx_portal_gold.png"), optimize=True)
    _tint_rgba(aura_arc, (255, 88, 48), gain=1.22).resize((192, 192), Image.Resampling.LANCZOS).save(out("fx_portal_fire.png"), optimize=True)
    _tint_rgba(aura_arc, (62, 238, 138), gain=1.18).resize((192, 192), Image.Resampling.LANCZOS).save(out("fx_portal_emerald.png"), optimize=True)

    # Chiseled dark slate-granite & subtle antique-bronze Sanctuary courtyard curb (768x768)
    cob_px = tile_cobble.load()
    plaza_rim = Image.new("RGBA", (768, 768), (0, 0, 0, 0))
    rune_ring = aura_pal.resize((768, 768), Image.Resampling.LANCZOS).load()
    prpx = plaza_rim.load()
    for y in range(768):
        for x in range(768):
            dx = x - 383.5
            dy = y - 383.5
            r = math.hypot(dx, dy)
            if r < 342 or r > 368:
                continue
            ang = math.atan2(dy, dx)
            joint = abs(math.sin(ang * 20.0))
            mortar = 0.72 if joint < 0.055 else 1.0
            cr, cg, cb, _ = cob_px[x % 256, y % 256]
            stone_lum = (0.3 * cr + 0.58 * cg + 0.12 * cb) / 255.0
            bevel = (0.64 + 0.34 * math.sin((r - 342.0) / 26.0 * math.pi)) * mortar
            rr, rg, rb, ra = rune_ring[x, y]
            gold_thread = math.exp(-((r - 354.0) ** 2) / 2.8)
            inlay = gold_thread * (0.45 + 0.35 * (ra / 255.0)) * mortar
            sr = (52 + 54 * stone_lum) * bevel
            sg = (58 + 56 * stone_lum) * bevel
            sb = (66 + 60 * stone_lum) * bevel
            gold_r = min(255, int(sr * (1.0 - inlay) + 194 * inlay))
            gold_g = min(255, int(sg * (1.0 - inlay) + 150 * inlay))
            gold_b = min(255, int(sb * (1.0 - inlay) + 64 * inlay))
            edge_a = 1.0 if 345.0 <= r <= 364.0 else max(0.0, min((r - 342.0) / 3.0, (368.0 - r) / 4.0))
            prpx[x, y] = (gold_r, gold_g, gold_b, min(255, int(edge_a * 246)))
    plaza_rim.save(out("fx_plaza_rim.png"), optimize=True)

    aim_line_im = Image.open(out("fx_aim_line.png"))
    _tint_rgba(aim_line_im, (248, 82, 82), gain=1.08).save(out("fx_aim_line_cancel.png"), optimize=True)
    aim_cone_im = Image.open(out("fx_aim_cone.png"))
    _tint_rgba(aim_cone_im, (248, 82, 82), gain=1.08).save(out("fx_aim_cone_cancel.png"), optimize=True)

    # Aim range & AoE reticles from aura_arc
    aim_range = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    ar_px = aim_range.load()
    arc256 = _tint_rgba(aura_arc, (56, 200, 255), gain=1.18).resize((256, 256), Image.Resampling.LANCZOS).load()
    for y in range(256):
        for x in range(256):
            rn = math.hypot(x - 127.5, y - 127.5) / 128.0
            if rn < 0.76 or rn > 0.99:
                continue
            r, g, b, a = arc256[x, y]
            ridge = math.exp(-((rn - 0.93) ** 2) / 0.0022)
            na = min(255, int(max(a * 0.78, ridge * 175)))
            if na > 5:
                ar_px[x, y] = (min(255, int(r + ridge * 60)), min(255, int(g + ridge * 80)), 255, na)
    aim_range.save(out("fx_aim_range.png"), optimize=True)
    _tint_rgba(aim_range, (248, 82, 82), gain=1.08).save(out("fx_aim_range_cancel.png"), optimize=True)

    aim_aoe = Image.new("RGBA", (224, 224), (0, 0, 0, 0))
    aa_px = aim_aoe.load()
    arc224 = _tint_rgba(aura_arc, (56, 208, 255), gain=1.18).resize((224, 224), Image.Resampling.LANCZOS).load()
    for y in range(224):
        for x in range(224):
            rn = math.hypot(x - 111.5, y - 111.5) / 112.0
            if rn > 0.98:
                continue
            r, g, b, a = arc224[x, y]
            edge = math.exp(-((rn - 0.91) ** 2) / 0.0035)
            body = 0.16 * (1.0 - rn * 0.25) + (a / 255.0) * 0.24
            alpha_f = min(1.0, body + edge * 0.85) * (1.0 if rn < 0.94 else max(0.0, (0.98 - rn) / 0.04))
            aa_px[x, y] = (min(255, int(48 + r * 0.55 + edge * 95)), min(255, int(195 + edge * 55)), 255, min(255, int(alpha_f * 230)))
    aim_aoe.save(out("fx_aim_aoe.png"), optimize=True)
    _tint_rgba(aim_aoe, (248, 82, 82), gain=1.08).save(out("fx_aim_aoe_cancel.png"), optimize=True)

    # D. Environmental Blend Textures (always generated deterministically in PIL)
    # 1. Soft elliptical contact shadow
    sh = Image.new("RGBA", (128, 64), (0, 0, 0, 0))
    sh_px = sh.load()
    for y in range(64):
        dy = (y - 31.5) / 28.0
        for x in range(128):
            dx = (x - 63.5) / 56.0
            d2 = dx * dx + dy * dy
            if d2 < 1.0:
                a = int(175 * ((1.0 - d2) ** 1.85))
                if a > 2:
                    sh_px[x, y] = (6, 8, 14, a)
    sh.filter(ImageFilter.GaussianBlur(radius=1.8)).save(out("fx_shadow_soft.png"), optimize=True)

    # 2. Feathered dirt-and-stone roads (tile_road_v.png 160x256 & tile_road_h.png 256x160)
    road_px = tile_road.load()
    cob_px = tile_cobble.load()
    rv = Image.new("RGBA", (160, 256), (0, 0, 0, 0))
    rvpx = rv.load()
    for y in range(256):
        # Seamless vertical wave modulation (integer cycles over 256)
        w1 = math.sin(2 * math.pi * y / 128.0) * 5.0 + math.cos(2 * math.pi * y / 64.0) * 3.0
        for x in range(160):
            dx = abs(x - 79.5 + w1 * 0.6) / 68.0
            if dx >= 1.08:
                continue
            r0, g0, b0, _ = road_px[(x + 48) % 256, y]
            cr, cg, cb, _ = cob_px[(x + 24) % 256, y]
            # Blend subtle scattered cobble texture near edges
            cob_mix = max(0.0, min(0.38, (dx - 0.42) * 0.7))
            r = int(r0 * (1.0 - cob_mix) + cr * cob_mix)
            g = int(g0 * (1.0 - cob_mix) + cg * cob_mix)
            b = int(b0 * (1.0 - cob_mix) + cb * cob_mix)
            # Soft dark wear along center wheel ruts + organic feathered alpha border
            shade = 0.88 + 0.14 * (1.0 - dx * 0.8)
            edge_a = 1.0 if dx < 0.70 else max(0.0, (1.06 - dx) / 0.36)
            edge_a = edge_a ** 1.4
            rvpx[x, y] = (min(255, int(r * shade)), min(255, int(g * shade)), min(255, int(b * shade)), int(edge_a * 255))
    rv.save(out("tile_road_v.png"), optimize=True)
    rh = rv.transpose(Image.Transpose.ROTATE_90)
    rh.save(out("tile_road_h.png"), optimize=True)

    # 3. High-resolution Carved Circular Sanctuary Courtyard Disc (768x768 -> zero upscaling blur)
    plaza = Image.new("RGBA", (768, 768), (0, 0, 0, 0))
    p_px = plaza.load()
    rim_src = Image.open(out("fx_plaza_rim.png")).convert("RGBA").resize((768, 768), Image.Resampling.LANCZOS).load()
    for y in range(768):
        for x in range(768):
            dx = x - 383.5
            dy = y - 383.5
            r = math.hypot(dx, dy)
            ang = math.atan2(dy, dx)
            # Crisp stone masonry micro-relief instead of rubbery wobble
            wobble = math.sin(ang * 20.0) * 0.9
            eff_r = r + wobble
            if eff_r > 380.0:
                continue
            cr, cg, cb, _ = cob_px[x % 256, y % 256]
            center_lift = 1.05 - 0.11 * (r / 368.0)
            # Subtle inner sanctum ring around Athena pedestal + darkened outer curb transition
            inner_inlay = math.exp(-((r - 78.0) ** 2) / 3.2) * 0.42
            curb_dark = 0.62 if eff_r > 362.0 else 1.0
            mr = min(255, int(cr * center_lift * curb_dark * (1.0 - inner_inlay) + 178 * inner_inlay))
            mg = min(255, int(cg * center_lift * curb_dark * (1.0 - inner_inlay) + 140 * inner_inlay))
            mb = min(255, int(cb * center_lift * curb_dark * (1.0 - inner_inlay) + 64 * inner_inlay))
            rr, rg, rb, ra = rim_src[x, y]
            if ra > 4:
                rf = ra / 255.0
                mr = int(mr * (1.0 - rf) + rr * rf)
                mg = int(mg * (1.0 - rf) + rg * rf)
                mb = int(mb * (1.0 - rf) + rb * rf)
            edge_a = 1.0 if eff_r < 364.0 else max(0.0, (380.0 - eff_r) / 16.0) ** 1.3
            p_px[x, y] = (mr, mg, mb, int(edge_a * 255))
    plaza.save(out("tile_plaza_disc.png"), optimize=True)

    # 4. Screen-edge Warcraft vignette (512x288) textured subtly from ui_stone_panel.png
    vig = Image.new("RGBA", (512, 288), (0, 0, 0, 0))
    vpx = vig.load()
    st_px = stone_panel.load()
    for y in range(288):
        ny = (y - 143.5) / 144.0
        for x in range(512):
            nx = (x - 255.5) / 256.0
            d = math.hypot(nx, ny)
            if d < 0.62:
                continue
            sr, sg, sb, _ = st_px[x % 256, y % 256]
            tex = 0.85 + 0.15 * ((sr + sg + sb) / 3.0 / 255.0)
            t = min(1.0, max(0.0, (d - 0.62) / 0.68)) ** 1.65
            vpx[x, y] = (int(5 * tex), int(7 * tex), int(14 * tex), min(255, int(t * 138)))
    vig.save(out("ui_vignette.png"), optimize=True)

    # 5. Carved stone & gold zone nameplate plaque (256x44)
    plaque = Image.new("RGBA", (256, 44), (0, 0, 0, 0))
    pq_px = plaque.load()
    for y in range(44):
        for x in range(256):
            # Rounded corner bevel mask
            cx = min(x, 255 - x)
            cy = min(y, 43 - y)
            if cx < 5 and cy < 5 and ((5 - cx) ** 2 + (5 - cy) ** 2) > 28:
                continue
            edge_d = min(cx, cy)
            sr, sg, sb, _ = st_px[x, y]
            if edge_d <= 2:
                # Chiseled antique gold rim
                shade = 0.82 if edge_d == 0 or y > 38 else 1.15
                pq_px[x, y] = (min(255, int(198 * shade)), min(255, int(156 * shade)), min(255, int(68 * shade)), 245)
            else:
                dark = 0.68 if y < 6 or y > 37 else 0.78
                pq_px[x, y] = (int(sr * dark * 0.9), int(sg * dark * 0.95), int(sb * dark * 1.1), 228)
    plaque.save(out("ui_zone_plaque.png"), optimize=True)


def _smoothstep(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def _sample_premul_bilinear(spx, cw: int, ch: int, x: float, y: float) -> tuple[int, int, int, int]:
    if x < 0 or x >= cw - 1 or y < 0 or y >= ch - 1:
        ix, iy = int(round(x)), int(round(y))
        if 0 <= ix < cw and 0 <= iy < ch:
            return spx[ix, iy]
        return (0, 0, 0, 0)
    x0, y0 = int(math.floor(x)), int(math.floor(y))
    fx, fy = x - x0, y - y0
    c00, c10, c01, c11 = spx[x0, y0], spx[x0 + 1, y0], spx[x0, y0 + 1], spx[x0 + 1, y0 + 1]
    w00, w10, w01, w11 = (1.0 - fx) * (1.0 - fy), fx * (1.0 - fy), (1.0 - fx) * fy, fx * fy
    pa = c00[3] * w00 + c10[3] * w10 + c01[3] * w01 + c11[3] * w11
    if pa < 2.0:
        return (0, 0, 0, 0)
    return (
        min(255, int(round((c00[0] * c00[3] * w00 + c10[0] * c10[3] * w10 + c01[0] * c01[3] * w01 + c11[0] * c11[3] * w11) / pa))),
        min(255, int(round((c00[1] * c00[3] * w00 + c10[1] * c10[3] * w10 + c01[1] * c01[3] * w01 + c11[1] * c11[3] * w11) / pa))),
        min(255, int(round((c00[2] * c00[3] * w00 + c10[2] * c10[3] * w10 + c01[2] * c01[3] * w01 + c11[2] * c11[3] * w11) / pa))),
        min(255, int(round(pa))),
    )


def _render_q_chibi_canvas(
    raw_cut: Image.Image,
    head_fx: float,
    head_fy: float,
    head_end: float,
    torso_end: float,
    head_bulge: float,
    head_rad: float,
    pose: str = "idle",
) -> Image.Image:
    crop = ImageEnhance.Color(raw_cut.convert("RGBA")).enhance(1.16)
    cw, ch = crop.size
    spx = crop.load()

    # True 2.1-head Q-chibi vertical spline: head/shoulders 57%, torso 24%, legs/boots 19%
    dst_h, dst_t = 0.57, 0.81
    N = 256
    slopes = []
    for i in range(N):
        v = i / (N - 1)
        s1 = head_end / dst_h
        s2 = (torso_end - head_end) / (dst_t - dst_h)
        s3 = (1.0 - torso_end) / (1.0 - dst_t)
        w12 = _smoothstep((v - (dst_h - 0.12)) / 0.24)
        w23 = _smoothstep((v - (dst_t - 0.12)) / 0.24)
        slopes.append(s1 * (1.0 - w12) + s2 * w12 * (1.0 - w23) + s3 * w23)
    lut = [0.0]
    for sl in slopes[1:]:
        lut.append(lut[-1] + sl)
    tot = lut[-1]
    lut = [x / tot for x in lut]

    def map_y(vd: float) -> float:
        if vd <= 0.0:
            return vd * (head_end / dst_h)
        if vd >= 1.0:
            return 1.0 + (vd - 1.0) * ((1.0 - torso_end) / (1.0 - dst_t))
        pos = vd * (N - 1)
        i0 = int(pos)
        f = pos - i0
        return lut[i0] * (1.0 - f) + lut[min(N - 1, i0 + 1)] * f

    work = 380
    win_w, win_h = int(work * 1.62), int(work * 1.28)
    warped = Image.new("RGBA", (win_w, win_h), (0, 0, 0, 0))
    wpx = warped.load()
    hx, hy = head_fx * (cw - 1), head_fy * (ch - 1)
    rx, ry = head_rad * max(cw, ch), head_rad * 0.94 * max(cw, ch)
    ox, oy = (win_w - work) * 0.5, (win_h - work) * 0.5

    for yd in range(win_h):
        vd = (yd - oy) / (work - 1)
        if vd < -0.15 or vd > 1.15:
            continue
        vs = map_y(vd)
        sy_base = vs * (ch - 1)
        wb = _smoothstep((vs - (torso_end - 0.18)) / 0.28)
        wm = 1.20 * (1.0 - wb) + 1.08 * wb

        upper_k = 1.0 - _smoothstep((vd - 0.10) / 0.72)
        boot_k = _smoothstep((vd - 0.74) / 0.24)

        for xd in range(win_w):
            ud = (xd - ox) / (work - 1)
            side_k = _smoothstep((ud - 0.34) / 0.32)  # 0 = left/rear boot, 1 = right/lead boot
            pose_dx = 0.0
            pose_dy = 0.0
            if pose == "walk1":
                pose_dx = upper_k * (cw * 0.042)
                pose_dy = boot_k * ((1.0 - side_k) * (ch * 0.055) - side_k * (ch * 0.015))
            elif pose == "walk2":
                pose_dx = upper_k * (cw * -0.025)
                pose_dy = boot_k * (side_k * (ch * 0.055) - (1.0 - side_k) * (ch * 0.015))
            elif pose == "attack":
                pose_dx = upper_k * (cw * 0.088)
                pose_dy = upper_k * (ch * -0.032)

            sx_base = cw * 0.5 + (ud - 0.5) * cw / wm - pose_dx
            sy_p = sy_base + pose_dy
            dx, dy = (sx_base - hx) / rx, (sy_p - hy) / ry
            r2 = dx * dx + dy * dy
            if r2 < 1.0:
                w = 0.5 * (1.0 + math.cos(math.pi * math.sqrt(r2)))
                sk = 1.0 / (1.0 + head_bulge * w)
                sx, sy = hx + (sx_base - hx) * sk, hy + (sy_p - hy) * sk * 0.94
            else:
                sx, sy = sx_base, sy_p
            if -0.5 <= sx <= cw - 0.5 and -0.5 <= sy <= ch - 0.5:
                wpx[xd, yd] = _sample_premul_bilinear(spx, cw, ch, sx, sy)

    return warped


def process_q_chibi_hero_set(
    src_raw: str,
    dst_td: str,
    dst_anims: list[str],
    head_fx: float,
    head_fy: float,
    head_end: float,
    torso_end: float,
    head_bulge: float,
    head_rad: float,
    clear_interior_white: bool = False,
) -> None:
    """Build Q-chibi hero_td & 4 foot-aligned hero_anim frames directly from hi-res AI artwork."""
    raw_im = Image.open(src_raw)
    raw_cut = extract_cutout_rgba(raw_im, clear_interior_white=clear_interior_white)

    idle_canvas = _render_q_chibi_canvas(raw_cut, head_fx, head_fy, head_end, torso_end, head_bulge, head_rad, "idle")
    wb = idle_canvas.getbbox()
    if not wb:
        return
    # Fixed reference bbox with small motion padding so legs/weapon never recenter across frames
    pad = 26
    rx0 = max(0, wb[0] - pad)
    ry0 = max(0, wb[1] - pad)
    rx1 = min(idle_canvas.width, wb[2] + pad)
    ry1 = min(idle_canvas.height, wb[3] + pad)
    tw, th = rx1 - rx0, ry1 - ry0

    def place_on_square(canvas_im: Image.Image, out_size: int, boost: float = 1.0) -> Image.Image:
        fig_crop = canvas_im.crop((rx0, ry0, rx1, ry1))
        # Maintain tight scale vs actual opaque body bounds
        bw, bh = wb[2] - wb[0], wb[3] - wb[1]
        fit = min((out_size * 0.89) / max(1, bw), (out_size * 0.85) / max(1, bh))
        nw = max(1, int(round(tw * fit)))
        nh = max(1, int(round(th * fit)))
        resized = fig_crop.resize((nw, nh), Image.Resampling.LANCZOS)
        if boost != 1.0:
            resized = ImageEnhance.Brightness(resized).enhance(boost)
        out = Image.new("RGBA", (out_size, out_size), (0, 0, 0, 0))
        foot_offset = int(round((ry1 - wb[3]) * fit))
        px = (out_size - nw) // 2
        py = int(out_size * 0.91) - (nh - foot_offset)
        out.paste(resized, (px, py), resized)
        return out

    ensure_dir(dst_td)
    place_on_square(idle_canvas, 176).save(dst_td, format="PNG", optimize=True)

    for pose, dst in zip(["idle", "walk1", "walk2", "attack"], dst_anims):
        ensure_dir(dst)
        cv = idle_canvas if pose == "idle" else _render_q_chibi_canvas(
            raw_cut, head_fx, head_fy, head_end, torso_end, head_bulge, head_rad, pose
        )
        place_on_square(cv, 192, boost=1.06 if pose == "attack" else 1.0).save(dst, format="PNG", optimize=True)


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
