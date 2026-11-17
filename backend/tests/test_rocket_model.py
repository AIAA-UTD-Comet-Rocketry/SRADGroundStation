from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from ground_station.config import Config
from ground_station.rocket_model import _nose_profile, load_rocket
from ground_station.server import REPO_ROOT, create_app

ORK = REPO_ROOT / "rockets" / "irec-2027-v3.ork"


@pytest.mark.skipif(not ORK.exists(), reason="team .ork not present")
def test_loads_team_design():
    m = load_rocket(ORK, "IREC 2027 · V3").to_json()
    assert m["length_m"] == pytest.approx(4.064, abs=1e-3)
    assert m["diameter_m"] == pytest.approx(0.1554, abs=1e-3)
    assert [s["kind"] for s in m["sections"]][0] == "nosecone"
    assert len(m["fins"]) == 2 and m["fins"][0]["count"] == 4
    names = {i["name"] for i in m["internals"]}
    assert {"Avionics", "Airbrake module"} <= names
    p = m["predicted"]
    assert p["max_altitude_m"] == pytest.approx(2844.474)
    assert max(p["altitude_m"]) == pytest.approx(2844, abs=5)
    assert len(p["t"]) <= 401
    assert any(e["type"] == "apogee" for e in p["events"])


def test_von_karman_nose_ends_at_full_radius():
    pts = _nose_profile("haack", 0.8, 0.08, 0.0)
    assert pts[0] == (0.0, 0.0)
    assert pts[-1][1] == pytest.approx(0.08, rel=1e-3)
    assert all(b[1] >= a[1] for a, b in zip(pts, pts[1:]))


def test_api_rocket_endpoint_and_missing_file(tmp_path):
    cfg = Config()
    cfg.ground.data_dir = tmp_path
    cfg.rocket.ork_file = Path(tmp_path / "nope.ork")
    with TestClient(create_app(cfg)) as c:
        assert c.get("/api/rocket").status_code == 404
        assert c.get("/api/status").status_code == 200  # bad design file never breaks the station
