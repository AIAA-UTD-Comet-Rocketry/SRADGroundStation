import json

import pytest

from ground_station.schema import FlightData, Phase, transition_name
from ground_station.sources import PacketError, parse_jsonl_line


def test_missing_fields_are_none_not_zero():
    d = FlightData(sequence=1)
    assert d.altitude_agl_m is None
    assert d.vertical_velocity_mps is None
    assert d.phase == Phase.UNKNOWN


def test_real_zero_is_preserved():
    d = FlightData(sequence=1, altitude_agl_m=0.0)
    assert d.altitude_agl_m == 0.0


def test_parse_valid_line_with_link_metrics():
    line = json.dumps({"sequence": 7, "phase": "COAST", "altitude_agl_m": 1234.5, "rssi_dbm": -90, "snr_db": 6.5})
    pkt = parse_jsonl_line(line.encode())
    assert pkt.data.sequence == 7
    assert pkt.data.phase == Phase.COAST
    assert pkt.rssi_dbm == -90.0
    assert pkt.snr_db == 6.5


@pytest.mark.parametrize(
    "raw",
    [
        b"{not json",
        b"[1,2,3]",
        b'{"phase": "COAST"}',  # no sequence
        b'{"sequence": -1}',
        b'{"sequence": 1, "latitude_deg": 123}',
        b'{"sequence": 1, "phase": "EXPLODED"}',
        b'{"sequence": 1, "schema_version": 99}',
        b"\xff\xfe",
    ],
)
def test_parse_rejects_bad_packets(raw):
    with pytest.raises(PacketError):
        parse_jsonl_line(raw)


def test_transition_names():
    assert transition_name(Phase.PAD, Phase.BOOST) == "Liftoff"
    assert "UNKNOWN" in transition_name(Phase.UNKNOWN, Phase.PAD)
