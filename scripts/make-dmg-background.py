#!/usr/bin/env python3
"""Makes the picture behind the OpenCephAI installer window (the .dmg).

Writes apps/desktop/src-tauri/icons/dmg/background.png (660x400, for the Tauri `bundle.macOS.dmg.background` key). Tauri takes one
background file only (no @2x twin), so Retina screens show this picture scaled up. The window shows an arrow from the app (left) to the
Applications folder (right); Finder draws the two icons itself at the positions in tauri.conf.json. Under them,
the backup warning.

Colours are read from apps/desktop/src/styles/tokens.css (the app's own light theme), so the picture follows the app.
Needs Pillow (`python3 -m pip install pillow`; already present on the author's Mac). Run from anywhere:

    python3 scripts/make-dmg-background.py

The words are checked by apps/desktop/src/dmgBackground.test.ts against tauri.conf.json and this file.
"""
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
TOKENS = ROOT / "apps/desktop/src/styles/tokens.css"
OUT = ROOT / "apps/desktop/src-tauri/icons/dmg"   # under icons/: the one folder where the repository's picture rules allow pictures

W, H = 660, 400                      # window size in points; must equal windowSize in tauri.conf.json
APP_X, FOLDER_X, ICON_Y = 180, 480, 170   # icon centres; must equal appPosition and applicationFolderPosition

HEADLINE = "Back up your OpenCephAI library before installing a new version."
SMALL = "In OpenCephAI, the Library screen's Back up… button makes a copy."
FOLDER = "In Finder: Go › Go to Folder… (⇧⌘G), then ~/Library/Application Support/app.cephtrace.desktop"
DRAG = "Drag OpenCephAI to Applications"


def light_tokens() -> dict:
    """The first `:root { ... }` block of tokens.css: the light theme."""
    css = TOKENS.read_text()
    block = re.search(r":root\s*\{(.*?)\n\}", css, re.S)
    if not block:
        sys.exit(f"no :root block found in {TOKENS}")
    return dict(re.findall(r"--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;", block.group(1)))


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    for path, index in (("/System/Library/Fonts/Helvetica.ttc", 1 if bold else 0), ("/System/Library/Fonts/HelveticaNeue.ttc", 1 if bold else 0)):
        try:
            return ImageFont.truetype(path, size, index=index)
        except OSError:
            continue
    sys.exit("no Helvetica found; this script is for macOS")


def fit(draw: ImageDraw.ImageDraw, text: str, start: int, bold: bool, max_w: int) -> ImageFont.FreeTypeFont:
    """The largest font not above `start` for which `text` fits `max_w`."""
    size = start
    while size > 6:
        f = font(size, bold)
        if draw.textlength(text, font=f) <= max_w:
            return f
        size -= 1
    return font(6, bold)


KEYS = "\u21e7\u2318"   # shift and command signs: Helvetica has neither, Apple Symbols has both


def mixed_line(d: ImageDraw.ImageDraw, cx: float, y: float, text: str, f: ImageFont.FreeTypeFont, fill: str) -> None:
    """Draws `text` centred at (cx, y), the key signs in Apple Symbols and everything else in `f`."""
    sym = ImageFont.truetype("/System/Library/Fonts/Apple Symbols.ttf", int(f.size))
    parts, cur = [], ""
    for ch in text:
        if (ch in KEYS) != (cur != "" and cur[0] in KEYS):
            if cur: parts.append(cur)
            cur = ""
        cur += ch
    parts.append(cur)
    fonts = [sym if p[0] in KEYS else f for p in parts]
    total = sum(d.textlength(p, font=ft) for p, ft in zip(parts, fonts))
    x = cx - total / 2
    for p, ft in zip(parts, fonts):
        d.text((x, y), p, fill=fill, font=ft, anchor="lm")
        x += d.textlength(p, font=ft)


def render(scale: int) -> Image.Image:
    t = light_tokens()
    img = Image.new("RGB", (W * scale, H * scale), t["panel"])
    d = ImageDraw.Draw(img)
    s = scale

    # Arrow between the two icon positions.
    y = ICON_Y * s
    x0, x1 = (APP_X + 80) * s, (FOLDER_X - 80) * s
    d.line([(x0, y), (x1 - 10 * s, y)], fill=t["text-3"], width=4 * s)
    d.polygon([(x1, y), (x1 - 16 * s, y - 11 * s), (x1 - 16 * s, y + 11 * s)], fill=t["text-3"])
    f = font(13 * s)
    d.text((W * s / 2, y - 22 * s), DRAG, fill=t["text-3"], font=f, anchor="mm")

    # The backup warning, in the app's warning colours, under the icons.
    bx0, by0, bx1, by1 = 30 * s, 275 * s, (W - 30) * s, 370 * s
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=8 * s, fill=t["warn-bg"], outline=t["warn"], width=2 * s)
    inner = bx1 - bx0 - 24 * s
    big = fit(d, HEADLINE, 16 * s, True, inner)
    d.text(((bx0 + bx1) / 2, by0 + 26 * s), HEADLINE, fill=t["warn-text"], font=big, anchor="mm")
    small = fit(d, SMALL, 11 * s, False, inner)
    d.text(((bx0 + bx1) / 2, by0 + 52 * s), SMALL, fill=t["text-2"], font=small, anchor="mm")
    folder = fit(d, FOLDER, 11 * s, False, inner)
    mixed_line(d, (bx0 + bx1) / 2, by0 + 74 * s, FOLDER, folder, t["text-2"])
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    render(1).save(OUT / "background.png", dpi=(72, 72))
    with Image.open(OUT / "background.png") as im:
        print("background.png", im.size)


if __name__ == "__main__":
    main()
