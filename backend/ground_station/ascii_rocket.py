"""Spinning ASCII-art rocket built from the OpenRocket outline.

Idea credit: alishsharma17/Ascii-Flower-Bouquet- (3D points -> rotate -> project -> shade
-> depth buffer, drawn with characters). This is our own implementation; the shape comes
from the .ork file instead of being hand-modelled.

The body is the .ork profile spun around its axis (a surface of revolution); fins are
flat plates. Each frame the rocket, standing nose-up, rolls about its own axis, and every
point is projected to a character cell, shaded by a light direction, and depth-tested.

Pure functions only, so the terminal tool and tests can share it. The frontend has a
TypeScript port in frontend/src/v3/asciiRender.ts; keep the two in step.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

SHADE = " .:-=+*#%@"
# Real L3 rockets are ~25x longer than wide; at character resolution that is a line.
# Widen the radius so the shape reads. Purely cosmetic.
RADIAL_SCALE = 1.7
_L = (-0.6, 0.35, 0.72)  # light from upper-left, toward the viewer (screen x right, y up, z out)
_n = math.sqrt(sum(v * v for v in _L))
LIGHT = tuple(v / _n for v in _L)

PART_NOSE, PART_BODY, PART_FIN = 0, 1, 2


@dataclass(frozen=True)
class Point:
    x: float  # metres from nose tip along the axis
    y: float  # radial components
    z: float
    nx: float  # surface normal
    ny: float
    nz: float
    part: int
    two_sided: bool


def build_points(rocket: dict[str, Any], axial_samples: int = 260, ring_samples: int = 28) -> list[Point]:
    """Sample the rocket surface. `rocket` is RocketModel.to_json() (outline + fins + sections)."""
    outline: list[list[float]] = rocket["outline"]
    length = float(rocket["length_m"])
    nose_len = rocket["sections"][0]["length"] if rocket.get("sections") and rocket["sections"][0].get("kind") == "nosecone" else 0.0
    step = length / axial_samples
    pts: list[Point] = []

    for (x0, r0), (x1, r1) in zip(outline, outline[1:]):
        r0, r1 = r0 * RADIAL_SCALE, r1 * RADIAL_SCALE
        if x1 - x0 < 1e-9:
            continue  # a shoulder step; too small to see at this resolution
        slope = (r1 - r0) / (x1 - x0)
        n_ax = max(1, round((x1 - x0) / step))
        for i in range(n_ax):
            x = x0 + (x1 - x0) * (i + 0.5) / n_ax
            r = r0 + slope * (x - x0)
            k = max(6, round(ring_samples * r / (0.08 * RADIAL_SCALE)))
            part = PART_NOSE if x <= nose_len + 1e-6 else PART_BODY
            inv = 1 / math.sqrt(1 + slope * slope)
            for j in range(k):
                a = 2 * math.pi * (j + 0.5 * (i % 2)) / k
                c, s = math.cos(a), math.sin(a)
                pts.append(Point(x, r * c, r * s, -slope * inv, c * inv, s * inv, part, False))

    body_r = max((r for _, r in outline), default=0.0)
    for fin in rocket.get("fins", []):
        poly = [(px, py) for px, py in fin["polygon"]]
        if max(py for _, py in poly) - body_r < 0.02:
            continue  # strakes/rail guides: invisible at this scale
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        count = max(1, int(fin.get("count", 1)))
        for f in range(count):
            th = 2 * math.pi * f / count + math.pi / 4
            c, s = math.cos(th), math.sin(th)
            nx_, nz_ = -s, c  # plate normal (tangential)
            gx = step
            gy = (max(ys) - min(ys)) / 14
            x = min(xs)
            while x <= max(xs):
                y = body_r
                while y <= max(ys):
                    if _inside(x, y, poly):
                        rr = body_r * RADIAL_SCALE + (y - body_r) * 1.4
                        pts.append(Point(x, rr * c, rr * s, 0.0, nx_, nz_, PART_FIN, True))
                    y += gy
                x += gx
    return pts


def _inside(x: float, y: float, poly: list[tuple[float, float]]) -> bool:
    hit = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
            hit = not hit
        j = i
    return hit


def render(points: list[Point], length: float, roll: float, cols: int, rows: int) -> tuple[list[str], list[list[int]]]:
    """One frame: rocket standing nose-up, rolled `roll` radians about its own axis.

    Returns (lines, part-per-cell); cells with no surface have part -1.
    """
    chars = [[" "] * cols for _ in range(rows)]
    parts = [[-1] * cols for _ in range(rows)]
    zbuf = [[-1e9] * cols for _ in range(rows)]
    if not points:
        return ["" for _ in range(rows)], parts

    cr, sr = math.cos(roll), math.sin(roll)
    span = max(math.hypot(p.y, p.z) for p in points)
    # A character is ~2x taller than wide, so one metre is 2x more columns than rows.
    scale = min((rows - 1) / length, (cols - 2) / (4 * span))
    top = (rows - length * scale) / 2
    cx = cols / 2
    lx, ly, lz = LIGHT

    for p in points:
        # roll about the rocket's own (vertical) axis; z is toward the viewer
        y = p.y * cr - p.z * sr
        z = p.y * sr + p.z * cr
        col = int(cx + y * scale * 2)
        row = int(top + p.x * scale)
        if not (0 <= row < rows and 0 <= col < cols) or z <= zbuf[row][col]:
            continue
        ny = p.ny * cr - p.nz * sr
        nz = p.ny * sr + p.nz * cr
        dot = ny * lx - p.nx * ly + nz * lz  # axis runs nose-down the screen, so up = -x
        if p.two_sided and dot < 0:
            dot = -dot * 0.6
        b = min(0.999, max(0.0, 0.08 + 0.85 * dot))
        zbuf[row][col] = z
        chars[row][col] = SHADE[1 + int(b * (len(SHADE) - 1))]
        parts[row][col] = p.part
    return ["".join(r).rstrip() for r in chars], parts
