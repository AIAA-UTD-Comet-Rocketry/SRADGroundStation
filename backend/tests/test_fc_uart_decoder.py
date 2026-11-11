import math
import struct
from datetime import UTC, datetime

import pytest

from ground_station.hub import LinkStats
from ground_station.schema import Phase
from ground_station.sources import (
    FcUartV1Decoder,
    JsonLinesDecoder,
    PacketError,
    RejectedPacket,
    SourcePacket,
    decode_fc_uart_v1,
)
from ground_station.sources.decoders import FC_UART_V1_FORMAT, FC_UART_V1_SIZE


def pkt(
    time_ms=12_345,
    alt_ft=1000.0,
    vel_x10=505,
    ax=10,
    ay=-20,
    az=1000,
    pitch=88,
    roll=-5,
    yaw=270,
    fsm=4,
    flags=0x11,
    pyro=0x03,
) -> bytes:
    return struct.pack(
        FC_UART_V1_FORMAT, 0xAA, 0xBB, FC_UART_V1_SIZE, time_ms, alt_ft, vel_x10, ax, ay, az, pitch, roll, yaw, fsm, flags, pyro
    )


def test_packet_size_matches_bridge_script():
    assert FC_UART_V1_SIZE == 29


def test_decode_units_and_fields():
    d = decode_fc_uart_v1(pkt()).data
    assert d.sequence is None
    assert d.fc_time_s == pytest.approx(12.345)
    assert d.altitude_agl_m == pytest.approx(304.8)
    assert d.vertical_velocity_mps == pytest.approx(50.5 * 0.3048)
    assert d.accel_z_mps2 == pytest.approx(9.80665)
    assert d.accel_y_mps2 == pytest.approx(-0.02 * 9.80665)
    assert (d.pitch_deg, d.roll_deg, d.yaw_deg) == (88.0, -5.0, 270.0)
    assert d.fc_state == "RISING"
    assert d.phase == Phase.COAST
    assert (d.status_flags, d.pyro_status) == (0x11, 0x03)
    # The packet has no lat/lon: must stay "no data", not 0.
    assert d.latitude_deg is None and d.acceleration_mps2 is None


@pytest.mark.parametrize(
    "code,state,phase",
    [
        (0, "IDLE", Phase.PAD),
        (1, "ARMED", Phase.PAD),
        (3, "BURNING", Phase.BOOST),
        (5, "APOGEE", Phase.APOGEE),
        (6, "DROGUE_DESCENT", Phase.DROGUE),
        (7, "MAIN_DESCENT", Phase.MAIN),
        (8, "LANDED", Phase.LANDED),
        (42, "UNKNOWN(42)", Phase.UNKNOWN),
    ],
)
def test_fsm_mapping(code, state, phase):
    d = decode_fc_uart_v1(pkt(fsm=code)).data
    assert d.fc_state == state
    assert d.phase == phase


@pytest.mark.parametrize("alt", [math.nan, math.inf, 1e9])
def test_implausible_altitude_rejected(alt):
    with pytest.raises(PacketError):
        decode_fc_uart_v1(pkt(alt_ft=alt))


def test_stream_handles_garbage_splits_and_resync():
    dec = FcUartV1Decoder()
    good1, good2 = pkt(time_ms=1), pkt(time_ms=2)
    bad = pkt(time_ms=3, alt_ft=math.nan)
    stream = b"\x00\x13\xaa\x01" + good1 + bad + b"\xff" * 5 + good2

    events = []
    for i in range(0, len(stream), 7):  # arrive in awkward 7-byte chunks
        events += dec.feed(stream[i : i + 7])

    goods = [e for e in events if isinstance(e, SourcePacket)]
    rejects = [e for e in events if isinstance(e, RejectedPacket)]
    assert [g.data.fc_time_s for g in goods] == [0.001, 0.002]
    assert len(rejects) == 1
    assert dec.discarded_bytes > 0


def test_stream_keeps_partial_sync_byte():
    dec = FcUartV1Decoder()
    p = pkt()
    assert dec.feed(b"\x55" + p[:1]) == []  # trailing 0xAA kept
    out = dec.feed(p[1:])
    assert len(out) == 1 and isinstance(out[0], SourcePacket)


def test_jsonl_stream_decoder():
    dec = JsonLinesDecoder()
    out = dec.feed(b'{"sequence": 1, "altitude_agl_m": 5}\n{bad\n{"sequence"')
    assert isinstance(out[0], SourcePacket) and isinstance(out[1], RejectedPacket)
    out = dec.feed(b': 2}\n')
    assert out[0].data.sequence == 2


def test_link_stats_without_sequence_numbers():
    s = LinkStats()
    now = datetime.now(UTC)
    for _ in range(5):
        s.record(None, None, None, now)
    d = s.as_dict(2.0)
    assert d["received"] == 5
    assert d["sequence_tracking"] is False
    assert d["loss_pct"] is None
    assert d["missed"] == 0
