"""Draws the 1200x630 link previews (Open Graph images) into assets/og/.

One for the site (pg.png) and one per app (<id>.png), from projects.json, the app icons,
the screenshots and accents.json. Run it from the site's folder after changing an app's
name, tagline, icon or screenshots, then commit the images:

    python scripts/og.py

Needs Pillow (pip install pillow). Uses Segoe UI from Windows' fonts folder; elsewhere,
point OG_FONT_DIR at a folder holding segoeuib.ttf and segoeui.ttf.
"""

import json
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "og"
W, H = 1200, 630
BG = (17, 17, 19)
TEXT = (255, 255, 255)
DIM = (170, 170, 178)
FONT_DIR = Path(os.environ.get("OG_FONT_DIR", r"C:\Windows\Fonts"))
DEVICE = {"iOS": "iPhone", "iPadOS": "iPad", "macOS": "Mac", "tvOS": "Apple TV"}
WIDE = ["Windows", "Mac", "iPad", "Apple TV"]


def font(bold, size):
    return ImageFont.truetype(str(FONT_DIR / ("segoeuib.ttf" if bold else "segoeui.ttf")), size)


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def rounded(img, radius):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, img.width - 1, img.height - 1), radius, fill=255)
    out = img.convert("RGBA")
    out.putalpha(Image.composite(out.getchannel("A"), mask, mask))
    return out


def circle(img):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, img.width - 1, img.height - 1), fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


def canvas(accent):
    """A dark card with one soft, still glow of the app's colour in the top-left corner."""
    img = Image.new("RGB", (W, H), BG)
    glow = Image.new("RGB", (W, H), BG)
    ImageDraw.Draw(glow).ellipse((-260, -320, 560, 380), fill=tuple(int(c * 0.45 + b * 0.55) for c, b in zip(accent, BG)))
    return Image.blend(img, glow.filter(ImageFilter.GaussianBlur(160)), 0.9)


def wrap(draw, text, fnt, width):
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=fnt) <= width:
            line = trial
        else:
            lines.append(line)
            line = word
    lines.append(line)
    return lines


def balanced(draw, text, fnt, width):
    """Wrap into as few lines as fit, then even them out so no word sits alone on the last line."""
    n = len(wrap(draw, text, fnt, width))
    while width > 200 and len(wrap(draw, text, fnt, width - 10)) == n:
        width -= 10
    return wrap(draw, text, fnt, width)


def card_shot(p):
    shots = p.get("screenshots") or []
    if p.get("cardShot"):
        return p["cardShot"]
    for d in WIDE:
        for s in shots:
            if s["device"] == d:
                return s["src"]
    return shots[0]["src"] if shots else None


def footer(draw, x, y, text):
    draw.text((x, y), text, font=font(False, 26), fill=DIM)


def site_image():
    img = canvas((150, 40, 50))
    avatar = circle(Image.open(ROOT / "assets" / "avatar.jpg").convert("RGB").resize((200, 200), Image.LANCZOS))
    img.paste(avatar, ((W - 200) // 2, 90), avatar)
    d = ImageDraw.Draw(img)
    title = font(True, 120)
    d.text(((W - d.textlength("PG", font=title)) / 2, 300), "PG", font=title, fill=TEXT)
    sub = font(False, 36)
    line = "Small, fast apps that do one job well."
    d.text(((W - d.textlength(line, font=sub)) / 2, 455), line, font=sub, fill=DIM)
    small = font(False, 26)
    url = "lilpatter.github.io"
    d.text(((W - d.textlength(url, font=small)) / 2, 540), url, font=small, fill=(120, 120, 128))
    img.save(OUT / "pg.png", optimize=True)


def app_image(p, accent):
    img = canvas(accent)
    d = ImageDraw.Draw(img)
    shot = card_shot(p)
    text_w = 520 if shot else 1000
    x = 72

    if shot:
        # The screenshot runs off the right edge, so the card reads as a window peeking in.
        s = Image.open(ROOT / shot).convert("RGB")
        sw = 700
        s = s.resize((sw, round(s.height * sw / s.width)), Image.LANCZOS)
        s = s.crop((0, 0, sw, min(s.height, 470)))
        s = rounded(s, 18)
        img.paste(s, (W - 560, 80), s)

    icon = rounded(Image.open(ROOT / p["icon"]).convert("RGBA").resize((150, 150), Image.LANCZOS), 34)
    img.paste(icon, (x, 84), icon)

    d.text((x, 262), p["name"], font=font(True, 84), fill=TEXT)
    tag = font(False, 36)
    y = 372
    for line in balanced(d, p["tagline"], tag, text_w)[:3]:
        d.text((x, y), line, font=tag, fill=(225, 225, 230))
        y += 46

    if p["status"] == "in-development":
        where = ", ".join(DEVICE.get(x_, x_) for x_ in p["platforms"])
        meta = f"In development · {where}"
    else:
        meta = "Free for Windows 10 and 11"
    footer(d, x, 540, f"PG  ·  {meta}")
    img.save(OUT / f"{p['id']}.png", optimize=True)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    projects = json.loads((ROOT / "projects.json").read_text(encoding="utf-8"))["projects"]
    accents = json.loads((ROOT / "accents.json").read_text(encoding="utf-8"))
    site_image()
    for p in projects:
        app_image(p, hex_rgb(p.get("accent") or accents.get(p["id"], "#0a84ff")))
    print(f"Drew {len(projects) + 1} images in {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
