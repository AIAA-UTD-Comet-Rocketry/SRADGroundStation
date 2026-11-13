import struct

import pytest

from ground_station.config import SerialConfig
from ground_station.sources import (
    FcUartV1Decoder,
    JsonLinesDecoder,
    RejectedPacket,
    SourcePacket,
    XBeeApiDecoder,
    XBeeFrameReader,
    build_frame,
    make_decoder,
)
from ground_station.sources.decoders import FC_UART_V1_FORMAT, FC_UART_V1_SIZE
from ground_station.sources.xbee import (
    AT_RESPONSE,
    RX_LEGACY_64,
    RX_PACKET_64,
    build_local_at_query,
    checksum,
)

ADDR = bytes.fromhex("0013A20041ABCDEF")


def fc_packet(time_ms=1000, alt_ft=500.0, fsm=4) -> bytes:
    return struct.pack(FC_UART_V1_FORMAT, 0xAA, 0xBB, FC_UART_V1_SIZE, time_ms, alt_ft, 100, 0, 0, 1000, 90, 0, 0, fsm, 0x11, 0)


def rx90(payload: bytes) -> bytes:
    return bytes([RX_PACKET_64]) + ADDR + b"\xff\xfe" + b"\x01" + payload


def test_checksum_matches_digi_example():
    # Digi user guide example: AT command "NJ" frame data 08 01 4E 4A -> checksum 0x5E
    assert checksum(bytes.fromhex("08014E4A")) == 0x5E


@pytest.mark.parametrize("escaped", [False, True])
def test_rx_frame_payload_reaches_inner_decoder(escaped):
    dec = XBeeApiDecoder(FcUartV1Decoder(), escaped=escaped)
    out = dec.feed(build_frame(rx90(fc_packet(time_ms=4242)), escaped))
    assert len(out) == 1 and isinstance(out[0], SourcePacket)
    assert out[0].data.fc_time_s == pytest.approx(4.242)
    assert dec.frames_rx == 1


def test_escaped_mode_handles_special_bytes_in_payload():
    # Payload deliberately contains every byte that must be escaped (7E 7D 11 13).
    reader = XBeeFrameReader(escaped=True)
    frame_data = rx90(b"\x7e\x7d\x11\x13hello")
    wire = build_frame(frame_data, escaped=True)
    assert wire.count(0x7E) == 1  # only the start delimiter is a raw 0x7E
    [(frame, err)] = reader.feed(wire)
    assert err is None and frame == frame_data


def test_bad_checksum_rejected_then_resyncs():
    dec = XBeeApiDecoder(FcUartV1Decoder())
    good = build_frame(rx90(fc_packet(time_ms=1)))
    bad = bytearray(build_frame(rx90(fc_packet(time_ms=2))))
    bad[-1] ^= 0xFF
    stream = b"\x00\x01" + bytes(bad) + good
    events = []
    for i in range(0, len(stream), 5):
        events += dec.feed(stream[i : i + 5])
    goods = [e for e in events if isinstance(e, SourcePacket)]
    assert [g.data.fc_time_s for g in goods] == [0.001]
    assert any(isinstance(e, RejectedPacket) and "checksum" in e.reason for e in events)


def test_db_response_sets_rssi_on_following_packets():
    dec = XBeeApiDecoder(FcUartV1Decoder())
    dec.feed(build_frame(bytes([AT_RESPONSE, 1]) + b"DB" + bytes([0, 87])))
    [pkt] = dec.feed(build_frame(rx90(fc_packet())))
    assert pkt.rssi_dbm == -87.0


def test_legacy_rx_frame_carries_its_own_rssi():
    dec = XBeeApiDecoder(FcUartV1Decoder())
    frame = bytes([RX_LEGACY_64]) + ADDR + bytes([72, 0]) + fc_packet()
    [pkt] = dec.feed(build_frame(frame))
    assert pkt.rssi_dbm == -72.0


def test_other_frame_types_ignored():
    dec = XBeeApiDecoder(FcUartV1Decoder())
    assert dec.feed(build_frame(bytes([0x8A, 0x06]))) == []  # modem status
    assert dec.frames_other == 1


def test_payload_split_across_frames_still_decodes():
    # A transparent-mode rocket XBee may split one flight packet across two RF frames.
    p = fc_packet(time_ms=777)
    dec = XBeeApiDecoder(FcUartV1Decoder())
    out = dec.feed(build_frame(rx90(p[:10])) + build_frame(rx90(p[10:])))
    assert len(out) == 1 and out[0].data.fc_time_s == pytest.approx(0.777)


def test_only_read_only_at_queries_can_be_built():
    assert build_local_at_query(b"DB")[3] == 0x08  # local AT command frame, never RF
    for cmd in (b"ID", b"CM", b"WR", b"RE", b"FR"):
        with pytest.raises(ValueError):
            build_local_at_query(cmd)


def test_make_decoder_chain():
    assert isinstance(make_decoder(SerialConfig()), FcUartV1Decoder)
    d = make_decoder(SerialConfig(framing="xbee_api_escaped", format="jsonl"))
    assert isinstance(d, XBeeApiDecoder) and d.escaped and isinstance(d.inner, JsonLinesDecoder)
    with pytest.raises(ValueError):
        make_decoder(SerialConfig(framing="carrier_pigeon"))
