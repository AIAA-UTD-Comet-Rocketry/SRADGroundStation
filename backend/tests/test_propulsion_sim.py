import pytest
from fastapi.testclient import TestClient

from ground_station.config import Config, SimulationConfig
from ground_station.server import create_app
from ground_station.sources.propulsion_sim import PSI, PropulsionSim, n2o_vapor_pressure_pa
from ground_station.sources.simulation import SimulationSource


def test_n2o_vapor_pressure_matches_tables():
    # ~5.06 MPa (734 psi) at 20 C, critical point 7.25 MPa at 36.4 C
    assert n2o_vapor_pressure_pa(20) / PSI == pytest.approx(734, abs=10)
    assert n2o_vapor_pressure_pa(36.42) == pytest.approx(7.251e6, rel=0.01)


def test_fill_hold_burn_sequence():
    s = PropulsionSim()
    s.start_fill()
    for _ in range(500):
        s.step(1.0)
    assert s.fill_valve_open and s.ox_kg == pytest.approx(s.p.ox_target_kg)
    assert 550 < s.tank_pressure_pa() / PSI < 850  # vapour pressure, not fill level
    s.stop_fill()
    s.step(60)
    assert s.state == "HOLD" and not s.fill_valve_open
    s.ignite()
    s.step(1.0)
    assert s.main_valves_open and s.chamber_pressure_pa() / PSI > 200
    for _ in range(100):
        s.step(0.1)
    assert s.state == "SPENT" and s.tank_pressure_pa() == 0


def test_launch_without_fill_still_burns():
    s = PropulsionSim()
    s.ignite()
    s.step(0.5)
    assert s.chamber_pressure_pa() > 0


def test_simulator_packets_carry_prop_fields():
    src = SimulationSource(SimulationConfig(packet_loss=0, seed=1))
    d = src.make_packet().data
    assert d.ox_mass_kg == pytest.approx(0, abs=0.05) and d.fill_valve_open is False
    src.start_fill()
    src.tick(0.1)
    assert src.make_packet().data.fill_valve_open is True


def test_fill_controls_via_api():
    with TestClient(create_app(Config())) as c:
        assert c.post("/api/sim", json={"action": "fill_start"}).status_code == 200
        assert c.get("/api/status").json()["source_status"]["prop_state"] == "FILLING"
        assert c.post("/api/sim", json={"action": "fill_stop"}).status_code == 200
        assert c.get("/api/status").json()["source_status"]["prop_state"] == "HOLD"
