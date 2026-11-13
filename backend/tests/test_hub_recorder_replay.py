import asyncio
import csv

from fastapi.testclient import TestClient

from ground_station.config import Config, SimulationConfig
from ground_station.hub import LinkStats, TelemetryHub
from ground_station.recorder import list_sessions, resolve_session
from ground_station.schema import FlightData, Mode, Phase
from ground_station.server import create_app
from ground_station.sources import RejectedPacket, ReplaySource, SimulationSource, SourcePacket


def test_link_stats_counts_gaps_and_resets():
    from datetime import UTC, datetime

    s = LinkStats()
    now = datetime.now(UTC)
    for seq in (0, 1, 2, 5, 6, 0, 1):
        s.record(seq, None, None, now)
    assert s.received == 7
    assert s.missed == 2
    assert s.sequence_resets == 1
    assert s.as_dict(2.0)["state"] == "OK"


def test_hub_records_events_and_replays(tmp_path):
    async def run():
        cfg = Config()
        hub = TelemetryHub(cfg, tmp_path)
        await hub.switch(Mode.SIMULATION)
        # Drive packets by hand instead of waiting on real time.
        hub._task.cancel()
        src = hub.source
        phases = [Phase.PAD, Phase.PAD, Phase.BOOST, Phase.COAST, Phase.DROGUE, Phase.MAIN, Phase.LANDED]
        for i, ph in enumerate(phases):
            hub.handle_packet(SourcePacket(FlightData(sequence=i, phase=ph, altitude_agl_m=float(i)), -80.0, 7.0), src)
        hub.handle_rejected(RejectedPacket("bad crc", "xx"))
        session_dir = hub.recorder.path
        await hub.shutdown()
        return hub, session_dir

    hub, session_dir = asyncio.run(run())
    assert [e["name"] for e in hub.events] == [
        "Liftoff",
        "Burnout",
        "Apogee / drogue deploy",
        "Main deploy",
        "Landed",
    ]

    with open(session_dir / "telemetry.csv") as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == 7
    assert rows[0]["mode"] == "SIMULATION"
    assert rows[0]["latitude_deg"] == ""  # no data stays empty, not 0
    with open(session_dir / "rejected.csv") as f:
        assert len(list(csv.DictReader(f))) == 1

    sessions = list_sessions(tmp_path)
    assert sessions[0]["name"] == session_dir.name
    replay = ReplaySource(resolve_session(tmp_path, session_dir.name), speed=50)

    async def collect():
        return [ev async for ev in replay.events()]

    evs = asyncio.run(collect())
    assert [e.data.phase for e in evs] == [Phase.PAD, Phase.PAD, Phase.BOOST, Phase.COAST, Phase.DROGUE, Phase.MAIN, Phase.LANDED]
    assert evs[0].data.latitude_deg is None
    assert evs[0].rssi_dbm == -80.0
    assert replay.finished


def test_resolve_session_refuses_traversal(tmp_path):
    import pytest

    with pytest.raises(FileNotFoundError):
        resolve_session(tmp_path, "../../etc")


def test_api_and_websocket(tmp_path):
    cfg = Config()
    cfg.ground.data_dir = tmp_path
    cfg.simulation = SimulationConfig(packet_loss=0.0, seed=3)
    app = create_app(cfg)
    with TestClient(app) as client:
        st = client.get("/api/status").json()
        assert st["mode"] == "SIMULATION"
        assert st["recording"]["active"] is True

        with client.websocket_connect("/ws") as ws:
            snap = ws.receive_json()
            assert snap["type"] == "snapshot"
            types = set()
            for _ in range(30):
                msg = ws.receive_json()
                types.add(msg["type"])
                if "frame" in types:
                    break
            assert "frame" in types

        assert client.post("/api/sim", json={"action": "launch", "speed": 5}).status_code == 200
        assert client.post("/api/sim", json={"action": "configure", "apogee_ft": 10}).status_code == 400

        r = client.post("/api/mode", json={"mode": "REPLAY", "session": "nope"})
        assert r.status_code == 404

        # Sim controls are refused outside SIMULATION.
        cfg.serial.port = str(tmp_path / "no-such-port")
        assert client.post("/api/mode", json={"mode": "LIVE"}).json()["mode"] == "LIVE"
        assert client.post("/api/sim", json={"action": "launch"}).status_code == 409


def test_simulation_source_is_monitoring_only():
    # Guard rail: no source exposes anything that looks like an uplink/command method.
    for cls in (SimulationSource, ReplaySource):
        names = {n.lower() for n in dir(cls)}
        assert not any(w in n for n in names for w in ("uplink", "transmit", "ignite", "fire", "arm"))
