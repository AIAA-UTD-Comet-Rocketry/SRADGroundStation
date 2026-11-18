"""Spinning ASCII rocket in the terminal, built from the OpenRocket file.

    backend/.venv/bin/python -m ground_station.tools.ascii_rocket            # until Ctrl+C
    backend/.venv/bin/python -m ground_station.tools.ascii_rocket --seconds 4
    backend/.venv/bin/python -m ground_station.tools.ascii_rocket --once     # one frame, no animation

Just for fun (and a nice splash on the Pi). Reads the same [rocket] config as the server.
Plain Python, no extra packages; needs a terminal with 256 colours.
"""

from __future__ import annotations

import argparse
import shutil
import sys
import time
from pathlib import Path

from ..ascii_rocket import PART_BODY, PART_FIN, PART_NOSE, build_points, render
from ..config import load_config
from ..rocket_model import load_rocket
from ..server import REPO_ROOT

# 256-colour palette per part, dark -> bright (indexed by shade level)
PALETTE = {
    PART_NOSE: [94, 136, 172, 178, 214, 220, 221, 222, 229],
    PART_BODY: [238, 240, 242, 245, 248, 250, 252, 254, 255],
    PART_FIN: [17, 18, 19, 25, 26, 32, 33, 39, 45],
}
SHADES = " .:-=+*#%@"
SPIN_SPEED = 0.8  # rad/s
FPS = 20


def colourise(lines: list[str], parts: list[list[int]], info: list[str], cols: int) -> str:
    out = []
    pad = max(len(line) for line in lines) + 4 if lines else 0
    info_top = max(0, (len(lines) - len(info)) // 2)
    for r, line in enumerate(lines):
        buf, last = [], None
        for c, ch in enumerate(line):
            part = parts[r][c]
            if ch != " " and part >= 0:
                level = max(0, SHADES.index(ch) - 1)
                code = PALETTE[part][min(level, len(PALETTE[part]) - 1)]
                if code != last:
                    buf.append(f"\033[38;5;{code}m")
                    last = code
            buf.append(ch)
        text = "".join(buf) + "\033[0m"
        k = r - info_top
        if 0 <= k < len(info) and pad + len(info[k]) < cols:
            text += " " * (pad - len(line)) + info[k]
        out.append(text + "\033[K")
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
    points = build_points(rocket)
    pred = rocket.get("predicted") or {}
    apo = pred.get("max_altitude_m")
    info = [
        "\033[1mUTD Comet Rocketry · SRAD Ground Station\033[0m",
        "",
        f"Vehicle    {rocket['name']}",
        f"Length     {rocket['length_m']:.2f} m   Ø {rocket['diameter_m'] * 1000:.0f} mm",
        f"Apogee     {apo:,.0f} m ({apo * 3.28084:,.0f} ft) predicted" if apo else "Apogee     —",
        "",
        "\033[2mMonitoring only · no uplink\033[0m",
        "\033[2mShape from " + path.name + " (radius widened for display)\033[0m",
    ]

    def frame(t: float) -> str:
        size = shutil.get_terminal_size((100, 32))
        rows = max(16, size.lines - 2)
        cols = max(10, min(40, rows))
        lines, parts = render(points, rocket["length_m"], t * SPIN_SPEED, cols, rows)
        return colourise(lines, parts, info, size.columns)

    if args.once or not sys.stdout.isatty():
        print(frame(0.6))
        return

    sys.stdout.write("\033[?25l\033[2J")
    start = time.perf_counter()
    try:
        while args.seconds is None or time.perf_counter() - start < args.seconds:
            t0 = time.perf_counter()
            sys.stdout.write("\033[H" + frame(t0 - start))
            sys.stdout.flush()
            time.sleep(max(0.0, 1 / FPS - (time.perf_counter() - t0)))
    except KeyboardInterrupt:
        pass
    finally:
        sys.stdout.write("\033[0m\033[?25h\033[2J\033[H")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
