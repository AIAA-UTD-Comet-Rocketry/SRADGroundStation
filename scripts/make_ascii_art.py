"""Regenerate the colour ASCII art (Temoc + Comet Rocketry logo) used by the terminal splash.

Only needed when changing the art. Needs Pillow (`pip install pillow`); the app itself
does not. Source images are not stored in the repo, only the generated text (Temoc is UT Dallas'
mascot; the club has UTD's permission to use him):

    python3 scripts/make_ascii_art.py --temoc ~/Downloads/temoc.png

Writes backend/ground_station/ascii_art.py (terminal splash) and frontend/src/v3/temocRider.ts
(About page). Each piece of
art is two parallel string lists: `chars` (what to print) and `keys` (one colour key per
character; space = transparent). Colours per key are defined by each consumer.
"""

from __future__ import annotations

import argparse
import colorsys
import json
import math
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]

# key -> reference RGB. Each cell takes the nearest key by average colour.
TEMOC_PALETTE = {
    "k": (35, 45, 75),  # outline / features (navy)
    "y": (255, 205, 45),  # flame, yellow
    "o": (245, 135, 35),  # flame tips + shirt, orange
    "s": (200, 222, 240),  # skin, light blue
    "S": (140, 170, 205),  # skin shadow
    "w": (250, 250, 250),  # UTD logo
}
LOGO_PALETTE = {
    "o": (240, 120, 40),  # ring
    "n": (22, 30, 72),  # night sky
    "b": (45, 125, 200),  # ocean
    "g": (105, 170, 80),  # land
    "y": (245, 185, 45),  # rocket
    "w": (240, 240, 240),  # trail, stars
}
RAMPS = {"y": "*#%", "o": "+*#", "s": "=+*", "S": "-=+", "w": "@", "b": "~=", "g": "#%", "n": " "}


def cell_pixels(px, x0, y0, x1, y1):
    for y in range(int(y0), max(int(y0) + 1, int(y1))):
        for x in range(int(x0), max(int(x0) + 1, int(x1))):
            yield px[x, y]


def convert(path: Path, cols: int, palette: dict, outline_key: str | None, bg_black: bool = False, dark_min: float = 0.3):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    rows = round(cols * h / w / 2.0)  # characters are ~2x taller than wide
    px = im.load()
    cw, ch = w / cols, h / rows

    cover = [[0.0] * cols for _ in range(rows)]
    keys = [[" "] * cols for _ in range(rows)]
    light = [[0.0] * cols for _ in range(rows)]
    peak = [[0.0] * cols for _ in range(rows)]
    for r in range(rows):
        for c in range(cols):
            opaque = []
            n = 0
            for pr, pg, pb, pa in cell_pixels(px, c * cw, r * ch, (c + 1) * cw, (r + 1) * ch):
                n += 1
                if pa > 128 and not (bg_black and pr + pg + pb < 40):
                    opaque.append((pr, pg, pb))
            if not opaque or len(opaque) / n < 0.35:
                continue
            cover[r][c] = len(opaque) / n
            avg = tuple(sum(p[i] for p in opaque) / len(opaque) for i in range(3))
            keys[r][c] = min(palette, key=lambda k: sum((a - b) ** 2 for a, b in zip(avg, palette[k])))
            if outline_key and keys[r][c] != outline_key:
                # thin dark strokes (eyes, mouth, outline) vanish in an average; keep them
                dark = sum(1 for p in opaque if 0.3 * p[0] + 0.59 * p[1] + 0.11 * p[2] < 70) / len(opaque)
                if dark > dark_min:
                    keys[r][c] = outline_key
            light[r][c] = colorsys.rgb_to_hls(*(v / 255 for v in avg))[1]
            peak[r][c] = max(0.3 * p[0] + 0.59 * p[1] + 0.11 * p[2] for p in opaque) / 255

    chars = [[" "] * cols for _ in range(rows)]
    for r in range(rows):
        for c in range(cols):
            k = keys[r][c]
            if k == " ":
                continue
            if k == outline_key:
                # line character that follows the edge (from the coverage gradient)
                def cv(dc, dr):
                    return cover[r + dr][c + dc] if 0 <= r + dr < rows and 0 <= c + dc < cols else 0.0

                gx, gy = cv(1, 0) - cv(-1, 0), cv(0, 1) - cv(0, -1)
                if abs(gx) < 0.25 and abs(gy) < 0.25:
                    chars[r][c] = "#"
                else:
                    a = math.degrees(math.atan2(gy, gx)) % 180
                    chars[r][c] = "|" if a < 22.5 or a >= 157.5 else "\\" if a < 67.5 else "_" if a < 112.5 else "/"
            elif k == "n":
                chars[r][c] = "*" if peak[r][c] > 0.75 else " "  # keep the stars, not the sky
                if chars[r][c] == "*":
                    keys[r][c] = "w"
            else:
                ramp = RAMPS[k]
                chars[r][c] = ramp[min(len(ramp) - 1, int(light[r][c] * len(ramp)))]
    for r in range(rows):  # a key with a blank char is just transparent
        for c in range(cols):
            if chars[r][c] == " ":
                keys[r][c] = " "
    return ["".join(x).rstrip() for x in chars], ["".join(x).rstrip() for x in keys]


FLAT_FILL = {"y": "#%@", "o": "%#", "s": "@%#*", "S": "#*+", "w": "@"}


def convert_flat(path: Path, cols: int, palette: dict, dark_min: float = 0.42):
    """Solid-fill variant for small sizes: each cell takes its colour from the light pixels only,
    and only strong dark features (eyes, mouth, outline) become 'k'. Reads better than
    edge-following outlines when the art is only ~25 characters wide."""
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    rows = round(cols * h / w / 2.0)
    px = im.load()
    cw, ch = w / cols, h / rows
    fills = [k for k in palette if k != "k"]

    def lum(p):
        return 0.3 * p[0] + 0.59 * p[1] + 0.11 * p[2]

    out_c, out_k = [], []
    for r in range(rows):
        lc, lk = "", ""
        for c in range(cols):
            pix = list(cell_pixels(px, c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
            op = [p[:3] for p in pix if p[3] > 128]
            if not op or len(op) / len(pix) < 0.45:
                lc, lk = lc + " ", lk + " "
                continue
            dark = sum(1 for p in op if lum(p) < 80) / len(op)
            light = [p for p in op if lum(p) >= 80] or op
            avg = tuple(sum(p[i] for p in light) / len(light) for i in range(3))
            k = min(fills, key=lambda kk: sum((a - b) ** 2 for a, b in zip(avg, palette[kk])))
            if dark > dark_min:
                lc, lk = lc + ("o" if k in "sS" else "#"), lk + "k"
                continue
            ramp = FLAT_FILL[k]
            lightness = colorsys.rgb_to_hls(*(v / 255 for v in avg))[1]
            lc, lk = lc + ramp[min(len(ramp) - 1, int((1 - lightness) * len(ramp) * 1.3))], lk + k
        out_c.append(lc.rstrip())
        out_k.append(lk[: len(lc.rstrip())])
    return out_c, out_k


def overlay(chars, keys, row, col, text, key):
    line, kline = list(chars[row].ljust(col + len(text))), list(keys[row].ljust(col + len(text)))
    for i, t in enumerate(text):
        line[col + i], kline[col + i] = t, key
    chars[row], keys[row] = "".join(line).rstrip(), "".join(kline).rstrip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--temoc", type=Path, required=True, help="Temoc image (PNG with transparency)")
    ap.add_argument("--logo", type=Path, default=ROOT / "frontend/public/comet-logo.png")
    ap.add_argument("--temoc-cols", type=int, default=34)
    ap.add_argument("--logo-cols", type=int, default=28)
    ap.add_argument("--rider", type=Path, help="Temoc image for the About-page rider (defaults to --temoc)")
    ap.add_argument("--rider-cols", type=int, default=26)
    args = ap.parse_args()

    t_chars, t_keys = convert(args.temoc, args.temoc_cols, TEMOC_PALETTE, outline_key="k")
    # The shirt logo is a few pixels wide at this size; write it as text, centred on the chest.
    row = round(len(t_chars) * 0.69)
    overlay(t_chars, t_keys, row, round(args.temoc_cols * 0.5) - 2, "UTD", "w")

    l_chars, l_keys = convert(args.logo, args.logo_cols, LOGO_PALETTE, outline_key=None, bg_black=True)
    art = {"TEMOC": (t_chars, t_keys), "COMET_LOGO": (l_chars, l_keys)}

    header = "Generated by scripts/make_ascii_art.py; do not edit by hand."
    py = [f'"""{header}"""', "", "from __future__ import annotations", ""]
    for name, (c, k) in art.items():
        py.append(f"{name}_CHARS = {json.dumps(c, indent=4)}\n")
        py.append(f"{name}_KEYS = {json.dumps(k, indent=4)}\n")
    (ROOT / "backend/ground_station/ascii_art.py").write_text("\n".join(py))
    r_chars, r_keys = convert_flat(args.rider or args.temoc, args.rider_cols, TEMOC_PALETTE)
    ts = [
        f"// {header}",
        "// Temoc riding the rocket on the About page (flat-fill conversion; keys: k y o s S w).",
        f"export const TEMOC_RIDER = {json.dumps({'chars': r_chars, 'keys': r_keys}, indent=2)};",
        "",
    ]
    (ROOT / "frontend/src/v3/temocRider.ts").write_text("\n".join(ts))
    art["TEMOC_RIDER"] = (r_chars, r_keys)

    for name, (c, k) in art.items():
        print(name)
        for a in c:
            print("  |" + a)


if __name__ == "__main__":
    main()
