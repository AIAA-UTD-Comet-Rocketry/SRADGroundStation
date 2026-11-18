"""ASCII rocket in the terminal: our rocket (from the OpenRocket file) climbing at 45°
with a flame, drifting stars, and Temoc watching from the corner.

    backend/.venv/bin/python -m ground_station.tools.ascii_rocket            # until Ctrl+C
    backend/.venv/bin/python -m ground_station.tools.ascii_rocket --seconds 4
    backend/.venv/bin/python -m ground_station.tools.ascii_rocket --once     # one frame, no animation

Just for fun (and a nice splash on the Pi). Reads the same [rocket] config as the server.
Plain Python, no extra packages; needs a terminal with 256 colours. The dashboard's
Configuration -> About page shows the same scene (frontend/src/v3/AsciiRocket.tsx).
"""

from __future__ import annotations

import argparse
import math
import random
import shutil
import sys
import time
from pathlib import Path

from ..ascii_rocket import PART_BODY, PART_FIN, PART_NOSE, RADIAL_SCALE, SHADE, build_points, projector, render
from ..ascii_art import COMET_LOGO_CHARS, COMET_LOGO_KEYS, TEMOC_CHARS, TEMOC_KEYS
from ..config import load_config
from ..rocket_model import load_rocket
from ..server import REPO_ROOT

SPIN_SPEED = 0.8  # roll, rad/s
FPS = 20
TILT = math.pi / 4  # 45°, climbing to the upper right
TAIL_FRAC = 0.42  # flame room behind the tail, as a fraction of rocket length

# Extra cell kinds beyond the renderer's PART_* (0..2)
FLAME_HOT, FLAME_MID, FLAME_COOL, STAR, TEXT = range(3, 8)
TEMOC_KIND = {"k": 8, "y": 9, "o": 10, "s": 11, "S": 12, "w": 13}
LOGO_KIND = {"o": 14, "b": 15, "g": 16, "y": 17, "w": 18}

# 256-colour codes. Rocket parts are indexed by shade level (dark -> bright).
PALETTE = {
    PART_NOSE: [94, 130, 166, 172, 208, 208, 214, 214, 215],
    PART_BODY: [238, 240, 242, 245, 248, 250, 252, 254, 255],
    PART_FIN: [130, 166, 166, 202, 202, 208, 208, 214, 214],
}
FIXED = {
    FLAME_HOT: 227, FLAME_MID: 214, FLAME_COOL: 196, STAR: 245, TEXT: 252,
    8: 61, 9: 220, 10: 208, 11: 153, 12: 110, 13: 231,  # Temoc: outline, hair, shirt, skin, shade, logo
    14: 208, 15: 33, 16: 71, 17: 220, 18: 252,  # logo: ring, ocean, land, rocket, trail
}  # fmt: skip
HAIR_ROWS = 0.4  # top fraction of Temoc whose flame hair flickers
HAIR_CHARS = "*#%"


class Scene:
    def __init__(self, rocket: dict, info: list[str]) -> None:
        self.rocket = rocket
        self.length = float(rocket["length_m"])
        self.points = build_points(rocket, axial_samples=360, ring_samples=34)
        self.nozzle = max(r for _, r in rocket["outline"]) * RADIAL_SCALE
        self.info = info
        self.rng = random.Random(99)
        star_rng = random.Random(7)
        self.stars = [(star_rng.random(), star_rng.random(), star_rng.uniform(0, 6.28), star_rng.uniform(1, 4)) for _ in range(400)]

    def frame(self, t: float, cols: int, rows: int) -> str:
        tail = self.length * TAIL_FRAC
        lines, parts = render(self.points, self.length, t * SPIN_SPEED, cols, rows, tilt=TILT, tail=tail)
        chars = [list(line.ljust(cols)) for line in lines]
        rnd = self.rng

        def put(c: int, r: int, ch: str, kind: int) -> None:
            if 0 <= r < rows and 0 <= c < cols and chars[r][c] == " ":
                chars[r][c] = ch
                parts[r][c] = kind

        # Logo + title block, top-left (the 45° rocket leaves that corner empty)
        logo = rows >= len(COMET_LOGO_CHARS) + len(self.info) + 22
        block = (COMET_LOGO_CHARS + [""] if logo else []) + self.info
        block_keys = (COMET_LOGO_KEYS + [""] if logo else []) + [""] * len(self.info)
        text_rows = len(block) + 1
        text_cols = 3 + max((len(x) for x in block), default=0)
        for i, (text, keys) in enumerate(zip(block, block_keys)):
            for j, ch in enumerate(text[: cols // 2]):
                if ch != " ":
                    k = keys[j] if j < len(keys) else " "
                    put(2 + j, 1 + i, ch, LOGO_KIND.get(k, TEXT))

        # Temoc, bottom-right; his flame hair flickers
        m_top = rows - len(TEMOC_CHARS)
        m_left = cols - max(len(x) for x in TEMOC_CHARS) - 1
        hair_rows = round(len(TEMOC_CHARS) * HAIR_ROWS)
        for i, (line, keys) in enumerate(zip(TEMOC_CHARS, TEMOC_KEYS)):
            for j, ch in enumerate(line):
                k = keys[j] if j < len(keys) else " "
                if ch == " " or k == " ":
                    continue
                if i < hair_rows and k in "yo" and rnd.random() < 0.2:
                    ch = rnd.choice(HAIR_CHARS)
                put(m_left + j, m_top + i, ch, TEMOC_KIND[k])

        # Exhaust plume: bulges just past the nozzle, tapers and cools with distance
        scale, cell = projector(self.points, self.length, cols, rows, TILT, tail)
        flame_len = tail * (0.85 + 0.15 * math.sin(t * 23) * math.sin(t * 7))
        ds = 1 / (scale * 2.2)
        d = 0.0
        while d < flame_len:
            k = d / flame_len
            w = self.nozzle * (1 + 0.8 * math.sin(math.pi * min(1.0, k * 1.6))) * (1 - k**1.8) * (1 + 0.25 * (rnd.random() - 0.5)) + 0.02
            u = -w
            while u <= w:
                heat = 1 - k - 0.35 * abs(u / w) + 0.25 * (rnd.random() - 0.5)
                if heat >= 0.05:
                    c, r = cell(-self.length / 2 - d, u)
                    for limit, ch, kind in ((0.75, "@", FLAME_HOT), (0.55, "#", FLAME_HOT), (0.4, "*", FLAME_MID),
                                            (0.25, "+", FLAME_MID), (0.13, ":", FLAME_COOL), (0.0, ".", FLAME_COOL)):  # fmt: skip
                        if heat > limit:
                            put(c, r, ch, kind)
                            break
                u += ds
            d += ds
        for _ in range(6):  # sparks
            c, r = cell(-self.length / 2 - flame_len * (0.8 + rnd.random() * 0.6), (rnd.random() - 0.5) * self.nozzle * 3)
            put(c, r, "'" if rnd.random() < 0.5 else ".", FLAME_COOL)

        # Stars drift opposite the direction of flight and twinkle
        n = cols * rows // 55
        for sx, sy, ph, sp in self.stars[:n]:
            c = int((sx * cols - math.sin(TILT) * 2 * 1.2 * t) % cols)
            r = int((sy * rows + math.cos(TILT) * 1.2 * t) % rows)
            if (r >= m_top - 1 and c >= m_left - 1) or (r <= text_rows and c <= text_cols):
                continue  # keep Temoc's corner and the title block clear
            tw = math.sin(t * sp + ph)
            put(c, r, "*" if tw > 0.85 else "+" if tw > 0.3 else ".", STAR)

        return self._colourise(chars, parts)

    @staticmethod
    def _colourise(chars: list[list[str]], parts: list[list[int]]) -> str:
        out = []
        for r, row in enumerate(chars):
            buf, last = [], None
            for c, ch in enumerate(row):
                kind = parts[r][c]
                if ch != " " and kind >= 0:
                    if kind in PALETTE:
                        pal = PALETTE[kind]
                        code = pal[min(max(0, SHADE.find(ch) - 1), len(pal) - 1)]
                    else:
                        code = FIXED[kind]
                    if code != last:
                        buf.append(f"\033[38;5;{code}m")
                        last = code
                buf.append(ch)
            out.append("".join(buf).rstrip() + "\033[0m\033[K")
        return "\n".join(out)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", type=Path, help="ground station TOML (for [rocket] ork_file)")
    ap.add_argument("--ork", type=Path, help="OpenRocket file (overrides config)")
    ap.add_argument("--seconds", type=float, help="stop after this long (default: until Ctrl+C)")
    ap.add_argument("--once", action="store_true", help="print a single frame and exit")
    args = ap.parse_args()

    cfg = load_config(args.config)
    ork = args.ork or cfg.rocket.ork_file
    if ork is None:
        sys.exit("no rocket file: pass --ork or set [rocket] ork_file")
    path = ork if ork.is_absolute() else REPO_ROOT / ork
    rocket = load_rocket(path, cfg.rocket.display_name).to_json()
    apo = (rocket.get("predicted") or {}).get("max_altitude_m")
    info = [
        "UTD Comet Rocketry",
        "SRAD Ground Station",
        "",
        rocket["name"],
        f"{rocket['length_m']:.2f} m  ·  {rocket['diameter_m'] * 1000:.0f} mm",
        f"apogee {apo:,.0f} m / {apo * 3.28084:,.0f} ft (predicted)" if apo else "",
        "",
        "monitoring only · no uplink",
    ]
    scene = Scene(rocket, info)

    def size() -> tuple[int, int]:
        s = shutil.get_terminal_size((100, 32))
        return max(40, s.columns - 1), max(20, s.lines - 1)

    if args.once or not sys.stdout.isatty():
        print(scene.frame(0.6, *size()))
        return

    sys.stdout.write("\033[?25l\033[2J")
    start = time.perf_counter()
    last_size = None
    try:
        while args.seconds is None or time.perf_counter() - start < args.seconds:
            t0 = time.perf_counter()
            cur = size()
            if cur != last_size:
                sys.stdout.write("\033[2J")
                last_size = cur
            sys.stdout.write("\033[H" + scene.frame(t0 - start, *cur))
            sys.stdout.flush()
            time.sleep(max(0.0, 1 / FPS - (time.perf_counter() - t0)))
    except KeyboardInterrupt:
        pass
    finally:
        sys.stdout.write("\033[0m\033[?25h\033[2J\033[H")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
