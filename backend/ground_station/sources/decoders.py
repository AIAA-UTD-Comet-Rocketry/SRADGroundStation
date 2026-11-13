"""Byte-stream decoders: raw serial bytes in, SourcePacket / RejectedPacket out.

Each decoder is a small stateful object with ``feed(bytes) -> list[SourceEvent]``, so it
can be unit-tested without hardware and handles packets split across serial reads.

Formats
-------
``jsonl``      One JSON object per line using FlightData field names. Bench/testing only.
``fc_uart_v1`` Binary flight-computer packet taken from the club's python-ground-station
               repo (uart_to_can.py, commit 016b29d, 2026-06-14, "UART Updates based on
               incoming payload"). NOT confirmed for the L3 flight computer — check with
               avionics before relying on it. See docs/telemetry-schema.md.
"""

from __future__ import annotations

import json
import math
import struct
from abc import ABC, abstractmethod

from pydantic import ValidationError

from ..schema import SCHEMA_VERSION, FlightData, Phase
from .base import RejectedPacket, SourceEvent, SourcePacket

FT_TO_M = 0.3048
G0 = 9.80665


class PacketError(ValueError):
    pass


class StreamDecoder(ABC):
    @abstractmethod
    def feed(self, data: bytes) -> list[SourceEvent]:
        """Consume bytes from the receiver and return any complete packets."""


# --------------------------------------------------------------------------- jsonl


def parse_jsonl_line(line: bytes) -> SourcePacket:
    try:
        obj = json.loads(line.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise PacketError(f"not valid JSON: {e}") from e
    if not isinstance(obj, dict):
        raise PacketError("packet is not a JSON object")

    version = obj.get("schema_version", SCHEMA_VERSION)
    if version != SCHEMA_VERSION:
        raise PacketError(f"unsupported schema_version {version!r}")
    if "sequence" not in obj:
        raise PacketError("missing 'sequence'")

    rssi = obj.pop("rssi_dbm", None)
    snr = obj.pop("snr_db", None)
    try:
        data = FlightData.model_validate(obj)
        return SourcePacket(
            data=data,
            rssi_dbm=float(rssi) if rssi is not None else None,
            snr_db=float(snr) if snr is not None else None,
        )
    except (ValidationError, TypeError, ValueError) as e:
        raise PacketError(f"validation failed: {e}") from e


class JsonLinesDecoder(StreamDecoder):
    MAX_LINE = 4096

    def __init__(self) -> None:
        self.buf = bytearray()

    def feed(self, data: bytes) -> list[SourceEvent]:
        self.buf += data
        out: list[SourceEvent] = []
        while (nl := self.buf.find(b"\n")) >= 0:
            line = bytes(self.buf[:nl]).strip()
            del self.buf[: nl + 1]
            if not line:
                continue
            try:
                out.append(parse_jsonl_line(line))
            except PacketError as e:
                out.append(RejectedPacket(reason=str(e)[:300], raw=line[:200].decode("utf-8", "replace")))
        if len(self.buf) > self.MAX_LINE:
            out.append(RejectedPacket(reason="line too long without newline", raw=""))
            self.buf.clear()
        return out


# --------------------------------------------------------------------- fc_uart_v1

# < little-endian
# B B   sync 0xAA 0xBB
# H     size (meaning unconfirmed; not enforced)
# I     time, ms (flight computer clock)
# f     altitude, ft
# h     vertical velocity, ft/s x10
# h h h accel x/y/z, g x1000
# h h h pitch/roll/yaw, deg
# B     FSM state
# B     status flags
# B     pyro status
FC_UART_V1_FORMAT = "<BBHIfhhhhhhhBBB"
FC_UART_V1_SIZE = struct.calcsize(FC_UART_V1_FORMAT)  # 29
FC_UART_V1_SYNC = b"\xaa\xbb"

FC_STATES: dict[int, str] = {
    0: "IDLE",
    1: "ARMED",
    2: "DISARM",
    3: "BURNING",
    4: "RISING",
    5: "APOGEE",
    6: "DROGUE_DESCENT",
    7: "MAIN_DESCENT",
    8: "LANDED",
}

FC_STATE_TO_PHASE: dict[str, Phase] = {
    "IDLE": Phase.PAD,
    "ARMED": Phase.PAD,
    "DISARM": Phase.PAD,
    "BURNING": Phase.BOOST,
    "RISING": Phase.COAST,
    "APOGEE": Phase.APOGEE,
    "DROGUE_DESCENT": Phase.DROGUE,
    "MAIN_DESCENT": Phase.MAIN,
    "LANDED": Phase.LANDED,
}

# This packet has no CRC, so reject values that can only come from corruption.
MAX_ABS_ALT_FT = 200_000.0


def decode_fc_uart_v1(packet: bytes) -> SourcePacket:
    if len(packet) != FC_UART_V1_SIZE:
        raise PacketError(f"expected {FC_UART_V1_SIZE} bytes, got {len(packet)}")
    (s1, s2, _size, time_ms, alt_ft, vel_x10, ax, ay, az, pitch, roll, yaw, fsm, flags, pyro) = struct.unpack(
        FC_UART_V1_FORMAT, packet
    )
    if (s1, s2) != (0xAA, 0xBB):
        raise PacketError("bad sync bytes")
    if not math.isfinite(alt_ft) or abs(alt_ft) > MAX_ABS_ALT_FT:
        raise PacketError(f"implausible altitude {alt_ft!r} ft (likely corruption)")

    state = FC_STATES.get(fsm)
    data = FlightData(
        sequence=None,  # this format has no packet counter
        fc_time_s=time_ms / 1000.0,
        phase=FC_STATE_TO_PHASE.get(state, Phase.UNKNOWN) if state else Phase.UNKNOWN,
        fc_state=state or f"UNKNOWN({fsm})",
        altitude_agl_m=alt_ft * FT_TO_M,  # assumed AGL (zeroed at pad) — confirm with avionics
        vertical_velocity_mps=(vel_x10 / 10.0) * FT_TO_M,
        accel_x_mps2=ax / 1000.0 * G0,
        accel_y_mps2=ay / 1000.0 * G0,
        accel_z_mps2=az / 1000.0 * G0,
        pitch_deg=float(pitch),
        roll_deg=float(roll),
        yaw_deg=float(yaw),
        status_flags=flags,
        pyro_status=pyro,
    )
    return SourcePacket(data=data)


class FcUartV1Decoder(StreamDecoder):
    """Finds 0xAA 0xBB, takes 29 bytes, decodes. On a bad packet, skips one byte and re-syncs."""

    MAX_BUFFER = 4096

    def __init__(self) -> None:
        self.buf = bytearray()
        self.discarded_bytes = 0

    def feed(self, data: bytes) -> list[SourceEvent]:
        self.buf += data
        out: list[SourceEvent] = []
        while True:
            idx = self.buf.find(FC_UART_V1_SYNC)
            if idx < 0:
                # Keep a trailing 0xAA: it may be the first half of the next sync marker.
                keep = 1 if self.buf.endswith(b"\xaa") else 0
                self.discarded_bytes += len(self.buf) - keep
                del self.buf[: len(self.buf) - keep]
                break
            if idx > 0:
                self.discarded_bytes += idx
                del self.buf[:idx]
            if len(self.buf) < FC_UART_V1_SIZE:
                break
            packet = bytes(self.buf[:FC_UART_V1_SIZE])
            try:
                out.append(decode_fc_uart_v1(packet))
                del self.buf[:FC_UART_V1_SIZE]
            except (PacketError, ValidationError) as e:
                out.append(RejectedPacket(reason=str(e)[:300], raw=packet.hex()))
                del self.buf[:1]  # resync on the next 0xAA 0xBB
        if len(self.buf) > self.MAX_BUFFER:
            self.buf.clear()
        return out


DECODERS: dict[str, type[StreamDecoder]] = {
    "jsonl": JsonLinesDecoder,
    "fc_uart_v1": FcUartV1Decoder,
}
