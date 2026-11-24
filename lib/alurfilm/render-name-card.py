#!/usr/bin/env python3
"""
Batch Style-1 (Cinematic Lower-Third) Character Name Overlay PNG renderer.
Supports positions: "left", "center", "right".
Reads JSON array from stdin: [{ "name": "Singh", "role": "...", "position": "left", "output_path": "/tmp/card.png" }]
Writes JSON array to stdout: [{ "output_path": "...", "x": 62, "y": 878, "width": 620, "height": 132, "position": "left" }]
"""

import json
import os
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
GOLD = (229, 184, 58)
WHITE = (255, 255, 255)

NAME_FONT_CANDIDATES = [
    '/usr/share/fonts/truetype/roboto/unhinted/RobotoCondensed-Bold.ttf',
    os.path.join(ROOT, 'assets/fonts/Montserrat-ExtraBold.ttf'),
    '/usr/share/fonts/truetype/inter-zorin-os/Inter-ExtraBold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
]

ROLE_FONT_CANDIDATES = [
    '/usr/share/fonts/truetype/inter-zorin-os/Inter-SemiBold.ttf',
    '/usr/share/fonts/truetype/inter-zorin-os/Inter-Medium.ttf',
    '/usr/share/fonts/truetype/roboto/unhinted/RobotoTTF/Roboto-Medium.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
]


def pick_font(candidates: list[str], size: int) -> ImageFont.FreeTypeFont:
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def measure_tracked(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, tracking: int):
    if not text:
        return 0, 0, 0
    total_w = 0.0
    min_top = 10**9
    max_bot = -10**9
    for i, ch in enumerate(text):
        bbox = draw.textbbox((0, 0), ch, font=font)
        total_w += font.getlength(ch) + (tracking if i < len(text) - 1 else 0)
        if bbox[1] < min_top:
            min_top = bbox[1]
        if bbox[3] > max_bot:
            max_bot = bbox[3]
    return int(round(total_w)), int(round(max_bot - min_top)), int(round(min_top))


def draw_tracked(
    img: Image.Image,
    xy: tuple[int, int],
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int, int],
    tracking: int,
    shadow: tuple[int, int, int, int],
    shadow_offset: tuple[int, int],
    shadow_blur: int,
):
    sh = Image.new('RGBA', img.size, (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(sh)
    cx, cy = xy[0] + shadow_offset[0], xy[1] + shadow_offset[1]
    for ch in text:
        sdraw.text((cx, cy), ch, font=font, fill=shadow)
        cx += font.getlength(ch) + tracking
    sh = sh.filter(ImageFilter.GaussianBlur(shadow_blur))
    img.alpha_composite(sh)

    draw = ImageDraw.Draw(img)
    cx, cy = xy
    for ch in text:
        draw.text((cx, cy), ch, font=font, fill=fill)
        cx += font.getlength(ch) + tracking


def _draw_glowing_bar(canvas: Image.Image, box: list[int], radius: int, blur: int):
    glow = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(glow).rounded_rectangle(
        [box[0] - radius, box[1] - radius // 2, box[2] + radius, box[3] + radius // 2],
        radius=radius + 1,
        fill=(*GOLD, 110),
    )
    glow = glow.filter(ImageFilter.GaussianBlur(blur))
    canvas.alpha_composite(glow)
    ImageDraw.Draw(canvas).rounded_rectangle(box, radius=radius, fill=(*GOLD, 255))


def render_cinematic_bar_card(name: str, role: str, output_path: str, position: str = 'left') -> dict:
    pos = position if position in ('left', 'center', 'right') else 'left'
    S = 2  # 2x supersampling for crisp edges
    name_up = name.strip().upper()
    role_clean = role.strip()
    if len(role_clean) > 46:
        role_clean = role_clean[:43].rstrip(' ,.-') + '...'
    role_up = role_clean.upper()

    name_pt = 72 if len(name_up) <= 14 else (60 if len(name_up) <= 22 else 52)
    f_name = pick_font(NAME_FONT_CANDIDATES, name_pt * S)
    f_role = pick_font(ROLE_FONT_CANDIDATES, 20 * S)

    dummy = ImageDraw.Draw(Image.new('RGBA', (10, 10)))
    nw, nh, ntop = measure_tracked(dummy, name_up, f_name, 7 * S)
    rw, rh, rtop = measure_tracked(dummy, role_up, f_role, 4 * S) if role_up else (0, 0, 0)

    if pos == 'center':
        pad_x = 120 * S
        pad_y = 66 * S
        bar_h = 3 * S
        gap_nb = 14 * S
        gap_br = 12 * S
        content_w = max(nw, rw, 140 * S)
        content_h = nh + gap_nb + bar_h + (gap_br + rh if role_up else 0)
        w = content_w + pad_x * 2
        h = content_h + pad_y * 2

        canvas = Image.new('RGBA', (w, h), (0, 0, 0, 0))

        # Seamless soft elliptical center scrim (bleed > 3x blur radius)
        scrim = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        ImageDraw.Draw(scrim).ellipse(
            [pad_x - 36 * S, pad_y - 18 * S, pad_x + content_w + 36 * S, pad_y + content_h + 20 * S],
            fill=(8, 10, 15, 145),
        )
        scrim = scrim.filter(ImageFilter.GaussianBlur(26 * S))
        canvas.alpha_composite(scrim)

        cx = w // 2
        ty_name = pad_y - ntop
        draw_tracked(
            canvas, (cx - nw // 2, ty_name), name_up, f_name, (*WHITE, 255),
            tracking=7 * S, shadow=(0, 0, 0, 215), shadow_offset=(0, 3 * S), shadow_blur=8 * S,
        )

        # Crisp centered horizontal gold accent bar
        bar_y = pad_y + nh + gap_nb
        bar_w = min(max(84 * S, int(nw * 0.55)), 160 * S)
        _draw_glowing_bar(canvas, [cx - bar_w // 2, bar_y, cx + bar_w // 2, bar_y + bar_h], radius=2 * S, blur=7 * S)

        if role_up:
            ty_role = bar_y + bar_h + gap_br - rtop
            draw_tracked(
                canvas, (cx - rw // 2, ty_role), role_up, f_role, (*GOLD, 240),
                tracking=4 * S, shadow=(0, 0, 0, 215), shadow_offset=(0, 2 * S), shadow_blur=6 * S,
            )

        out = canvas.resize((w // S, h // S), Image.Resampling.LANCZOS)
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        out.save(output_path)
        return {
            'output_path': output_path,
            'x': (1920 - out.width) // 2,
            'y': 1080 - out.height - 52,
            'width': out.width,
            'height': out.height,
            'position': pos,
        }

    # Left or mirrored Right vertical accent bar layout
    pad_edge = 52 * S
    bar_w = 5 * S
    bar_gap = 22 * S
    content_w = max(nw, rw)
    grad_tail = 180 * S
    w = pad_edge + bar_w + bar_gap + content_w + grad_tail
    pad_y = 48 * S
    gap_nr = 10 * S
    content_h = nh + (gap_nr + rh if role_up else 0)
    h = content_h + pad_y * 2

    canvas = Image.new('RGBA', (w, h), (0, 0, 0, 0))

    # Seamless horizontal gradient scrim (fades right for left-aligned, fades left for right-aligned)
    grad_top = pad_y - 12 * S
    grad_bot = pad_y + content_h + 14 * S
    grad_layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(grad_layer)
    if pos == 'left':
        grad_start = pad_edge - 14 * S
        grad_w = w - grad_start - 36 * S
        for x in range(max(1, grad_w)):
            t = x / max(1, grad_w - 1)
            alpha = 155 if t < 0.35 else int(155 * ((1 - (t - 0.35) / 0.65) ** 2.2))
            if alpha > 0:
                gdraw.line([(grad_start + x, grad_top), (grad_start + x, grad_bot)], fill=(8, 10, 15, alpha))
    else:
        grad_end = w - pad_edge + 14 * S
        grad_start = 36 * S
        grad_w = grad_end - grad_start
        for x in range(max(1, grad_w)):
            # t = 0 near right bar, t = 1 at far left fade-out
            t = (grad_w - 1 - x) / max(1, grad_w - 1)
            alpha = 155 if t < 0.35 else int(155 * ((1 - (t - 0.35) / 0.65) ** 2.2))
            if alpha > 0:
                gdraw.line([(grad_start + x, grad_top), (grad_start + x, grad_bot)], fill=(8, 10, 15, alpha))

    grad_layer = grad_layer.filter(ImageFilter.GaussianBlur(12 * S))
    canvas.alpha_composite(grad_layer)

    bar_y1 = pad_y + (2 if not role_up else 4) * S
    bar_y2 = pad_y + content_h + (2 if not role_up else 4) * S
    bar_x = pad_edge if pos == 'left' else (w - pad_edge - bar_w)
    _draw_glowing_bar(canvas, [bar_x, bar_y1, bar_x + bar_w, bar_y2], radius=2 * S, blur=8 * S)

    ty_name = pad_y - ntop + 2 * S
    tx_name = (bar_x + bar_w + bar_gap) if pos == 'left' else (bar_x - bar_gap - nw)
    draw_tracked(
        canvas, (tx_name, ty_name), name_up, f_name, (*WHITE, 255),
        tracking=7 * S, shadow=(0, 0, 0, 210), shadow_offset=(0, 3 * S), shadow_blur=8 * S,
    )

    if role_up:
        ty_role = pad_y + nh + gap_nr - rtop + 4 * S
        tx_role = (bar_x + bar_w + bar_gap + 2 * S) if pos == 'left' else (bar_x - bar_gap - rw - 2 * S)
        draw_tracked(
            canvas, (tx_role, ty_role), role_up, f_role, (*GOLD, 240),
            tracking=4 * S, shadow=(0, 0, 0, 210), shadow_offset=(0, 2 * S), shadow_blur=6 * S,
        )

    out = canvas.resize((w // S, h // S), Image.Resampling.LANCZOS)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    out.save(output_path)
    out_x = 62 if pos == 'left' else (1920 - out.width - 62)
    return {
        'output_path': output_path,
        'x': out_x,
        'y': 1080 - out.height - 70,
        'width': out.width,
        'height': out.height,
        'position': pos,
    }


def main():
    items = json.load(sys.stdin)
    results = [
        render_cinematic_bar_card(
            item['name'],
            item.get('role', ''),
            item['output_path'],
            item.get('position', 'left'),
        )
        for item in items
    ]
    json.dump(results, sys.stdout)


if __name__ == '__main__':
    main()
