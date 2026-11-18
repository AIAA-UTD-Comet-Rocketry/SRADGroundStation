from pathlib import Path

from ground_station.ascii_rocket import PART_FIN, PART_NOSE, build_points, render
from ground_station.rocket_model import load_rocket

ORK = Path(__file__).resolve().parents[2] / "rockets" / "irec-2027-v3.ork"


def test_ascii_rocket_draws_nose_up_with_fins_at_the_bottom():
    rocket = load_rocket(ORK).to_json()
    pts = build_points(rocket)
    lines, parts = render(pts, rocket["length_m"], 0.6, 30, 40)
    assert len(lines) == 40
    drawn = [r for r, line in enumerate(lines) if line.strip()]
    assert drawn, "nothing drawn"
    top, bottom = drawn[0], drawn[-1]
    rows_with = lambda part: [r for r in range(40) if part in parts[r]]  # noqa: E731
    assert min(rows_with(PART_NOSE)) == top  # nose cone at the top
    assert min(rows_with(PART_FIN)) > (top + bottom) / 2  # fins in the lower half
    widest = max(len(line.strip()) for line in lines)
    assert widest < 30  # fits the requested width


def test_ascii_rocket_handles_empty_model():
    lines, _ = render([], 1.0, 0.0, 10, 5)
    assert lines == [""] * 5


def test_terminal_scene_renders_title_rocket_and_temoc():
    import re

    from ground_station.tools.ascii_rocket import Scene

    scene = Scene(load_rocket(ORK).to_json(), ["UTD Comet Rocketry", "4.06 m  ·  155 mm"])
    text = re.sub(r"\x1b\[[0-9;]*[mK]", "", scene.frame(1.0, 120, 40))
    lines = text.split("\n")
    assert len(lines) == 40
    assert lines[1].strip().startswith("UTD Comet Rocketry")
    assert "4.06 m  ·  155 mm" in lines[2]  # stars never land inside the title block
    assert "UTD |" in text  # Temoc's jersey
    assert "@" in text  # rocket / flame drawn
