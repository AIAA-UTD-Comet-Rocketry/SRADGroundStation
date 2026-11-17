"""Load an OpenRocket (.ork) design for display: 2D outline + the predicted flight.

Only what the HUD needs is extracted:
* outline  — body profile (nose cone shape, tubes, transitions) as (x, r) points, metres
             from the nose tip, plus fin polygons and labelled internal sections
* predicted — the first simulation's altitude / vertical-velocity curves, events and summary

The prediction is shown as a reference line only. It is the design team's model, not
a measurement, and the HUD labels it that way.
"""

from __future__ import annotations

import io
import math
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

BODY_TAGS = ("nosecone", "bodytube", "transition")
INTERNAL_TAGS = ("tubecoupler", "innertube", "parachute", "streamer", "masscomponent")
FIN_TAGS = ("freeformfinset", "trapezoidfinset", "ellipticalfinset")
MAX_PREDICTED_POINTS = 400


def _f(el: ET.Element | None, tag: str, default: float = 0.0) -> float:
    if el is None:
        return default
    text = (el.findtext(tag) or "").strip()
    if text.startswith("auto"):
        text = text[4:].strip()
    try:
        return float(text)
    except ValueError:
        return default


def _read_xml(path: Path) -> ET.Element:
    data = path.read_bytes()
    if data[:2] == b"PK":  # .ork files are usually a zip with one XML inside
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            name = next(n for n in z.namelist() if n.endswith((".ork", ".xml")) or "." not in n)
            data = z.read(name)
    return ET.fromstring(data)


def _nose_profile(shape: str, length: float, radius: float, param: float, n: int = 40) -> list[tuple[float, float]]:
    pts = []
    for i in range(n + 1):
        x = length * i / n
        u = x / length if length else 0
        if shape == "conical":
            r = radius * u
        elif shape == "ellipsoid":
            r = radius * math.sqrt(max(0.0, 1 - (1 - u) ** 2))
        elif shape == "power":
            r = radius * u ** (param or 0.5)
        elif shape == "parabolic":
            k = param or 1.0
            r = radius * (2 * u - k * u * u) / (2 - k) if k != 2 else radius * u
        elif shape == "ogive":
            rho = (radius**2 + length**2) / (2 * radius) if radius else 0
            r = math.sqrt(max(0.0, rho**2 - (length - x) ** 2)) + radius - rho if rho else radius * u
        else:  # haack / von Kármán (param 0) and fallback
            theta = math.acos(max(-1.0, min(1.0, 1 - 2 * u)))
            r = radius / math.sqrt(math.pi) * math.sqrt(max(0.0, theta - math.sin(2 * theta) / 2 + param * math.sin(theta) ** 3))
        pts.append((x, max(0.0, r)))
    return pts


def _place(el: ET.Element, parent_start: float, parent_len: float, own_len: float) -> float:
    """Absolute x of a component's front, from OpenRocket's axial offset methods."""
    off = el.find("axialoffset")
    if off is None:
        off = el.find("position")
    if off is None:
        return parent_start
    method = off.get("method") or off.get("type") or "top"
    try:
        v = float((off.text or "0").strip())
    except ValueError:
        v = 0.0
    if method == "absolute":
        return v
    if method == "bottom":
        return parent_start + parent_len - own_len + v
    if method == "middle":
        return parent_start + (parent_len - own_len) / 2 + v
    return parent_start + v  # "top"/"after"


@dataclass
class RocketModel:
    name: str
    source_file: str
    length_m: float
    diameter_m: float
    outline: list[tuple[float, float]] = field(default_factory=list)
    fins: list[dict[str, Any]] = field(default_factory=list)
    sections: list[dict[str, Any]] = field(default_factory=list)
    internals: list[dict[str, Any]] = field(default_factory=list)
    motor: str | None = None
    predicted: dict[str, Any] | None = None

    def to_json(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "source_file": self.source_file,
            "length_m": round(self.length_m, 4),
            "diameter_m": round(self.diameter_m, 4),
            "outline": [[round(x, 4), round(r, 4)] for x, r in self.outline],
            "fins": self.fins,
            "sections": self.sections,
            "internals": self.internals,
            "motor": self.motor,
            "predicted": self.predicted,
        }


def load_rocket(path: Path, display_name: str | None = None) -> RocketModel:
    root = _read_xml(path)
    rocket = root.find("rocket")
    if rocket is None:
        raise ValueError("not an OpenRocket file (no <rocket>)")

    outline: list[tuple[float, float]] = []
    sections: list[dict[str, Any]] = []
    internals: list[dict[str, Any]] = []
    fins: list[dict[str, Any]] = []
    x = 0.0
    radius = 0.0

    for stage in rocket.iter("stage"):
        subs = stage.find("subcomponents")
        if subs is None:
            continue
        for comp in subs:
            if comp.tag not in BODY_TAGS:
                continue
            length = _f(comp, "length")
            name = (comp.findtext("name") or comp.tag).split("[")[0].strip()
            if comp.tag == "nosecone":
                radius = _f(comp, "aftradius") or radius
                pts = _nose_profile(
                    (comp.findtext("shape") or "haack").strip(), length, radius, _f(comp, "shapeparameter")
                )
                outline += [(x + px, pr) for px, pr in pts]
            elif comp.tag == "transition":
                fr, ar = _f(comp, "foreradius", radius), _f(comp, "aftradius", radius)
                outline += [(x, fr), (x + length, ar)]
                radius = ar
            else:
                radius = _f(comp, "radius", radius) or radius
                outline += [(x, radius), (x + length, radius)]
            sections.append({"name": name, "kind": comp.tag, "x": round(x, 4), "length": round(length, 4)})
            _collect_children(comp, x, length, radius, internals, fins)
            x += length

    motor_el = next(root.iter("motor"), None)
    motor = (motor_el.findtext("designation") or "").strip() if motor_el is not None else None

    return RocketModel(
        name=display_name or path.stem,
        source_file=path.name,
        length_m=x,
        diameter_m=2 * max((r for _, r in outline), default=0.0),
        outline=outline,
        fins=fins,
        sections=sections,
        internals=internals,
        motor=motor or None,
        predicted=_predicted(root),
    )


def _collect_children(
    comp: ET.Element,
    start: float,
    length: float,
    body_r: float,
    internals: list[dict[str, Any]],
    fins: list[dict[str, Any]],
) -> None:
    subs = comp.find("subcomponents")
    if subs is None:
        return
    for child in subs:
        name = (child.findtext("name") or child.tag).split("[")[0].strip()
        if child.tag in FIN_TAGS:
            pts = [(float(p.get("x", 0)), float(p.get("y", 0))) for p in child.iter("point")]
            if not pts and child.tag == "trapezoidfinset":
                root_c, tip_c = _f(child, "rootchord"), _f(child, "tipchord")
                span, sweep = _f(child, "height"), _f(child, "sweeplength")
                pts = [(0, 0), (sweep, span), (sweep + tip_c, span), (root_c, 0)]
            root_len = max((p[0] for p in pts), default=0.0)
            fx = _place(child, start, length, root_len)
            fins.append(
                {
                    "name": name,
                    "count": int(_f(child, "fincount", 1)),
                    "polygon": [[round(fx + px, 4), round(body_r + py, 4)] for px, py in pts],
                }
            )
        elif child.tag in INTERNAL_TAGS:
            clen = _f(child, "length") or _f(child, "packedlength")
            cx = _place(child, start, length, clen)
            internals.append({"name": name, "kind": child.tag, "x": round(cx, 4), "length": round(clen, 4)})
            if child.tag in ("tubecoupler", "innertube"):
                _collect_children(child, cx, clen, body_r, internals, fins)


def _predicted(root: ET.Element) -> dict[str, Any] | None:
    sim = next(root.iter("simulation"), None)
    if sim is None:
        return None
    fd = sim.find("flightdata")
    branch = next(sim.iter("databranch"), None)
    if fd is None or branch is None:
        return None
    types = (branch.get("types") or "").split(",")
    try:
        it, ia, iv = types.index("Time"), types.index("Altitude"), types.index("Vertical velocity")
        ie = types.index("Position East of launch") if "Position East of launch" in types else None
        inn = types.index("Position North of launch") if "Position North of launch" in types else None
    except ValueError:
        return None
    rows = []
    for dp in branch.findall("datapoint"):
        vals = (dp.text or "").split(",")
        try:
            east = float(vals[ie]) if ie is not None else math.nan
            north = float(vals[inn]) if inn is not None else math.nan
            rows.append((float(vals[it]), float(vals[ia]), float(vals[iv]), east, north))
        except (ValueError, IndexError):
            continue
    step = max(1, math.ceil(len(rows) / MAX_PREDICTED_POINTS))
    sampled = rows[::step]
    if rows and sampled[-1] != rows[-1]:
        sampled.append(rows[-1])
    rows = sampled

    def num(k: str) -> float | None:
        try:
            return float(fd.get(k, ""))
        except ValueError:
            return None

    events = []
    for ev in sim.iter("event"):
        etype = ev.get("type", "")
        if etype in ("liftoff", "burnout", "apogee", "recoverydevicedeployment", "groundhit"):
            events.append({"type": etype, "t": float(ev.get("time", "0"))})
    return {
        "simulation": (sim.findtext("name") or "Simulation").strip(),
        "t": [round(r[0], 3) for r in rows],
        "altitude_m": [round(r[1], 2) for r in rows],
        "vertical_velocity_mps": [round(r[2], 2) for r in rows],
        # Ground track relative to the launch point (m); null if the sim didn't record it.
        "east_m": [round(r[3], 1) if math.isfinite(r[3]) else None for r in rows],
        "north_m": [round(r[4], 1) if math.isfinite(r[4]) else None for r in rows],
        "events": events,
        "max_altitude_m": num("maxaltitude"),
        "max_velocity_mps": num("maxvelocity"),
        "max_mach": num("maxmach"),
        "time_to_apogee_s": num("timetoapogee"),
        "flight_time_s": num("flighttime"),
        "ground_hit_velocity_mps": num("groundhitvelocity"),
    }
