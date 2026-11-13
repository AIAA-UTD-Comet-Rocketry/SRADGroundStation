"""Digi XBee API-mode framing (ground-side receiver).

When the ground XBee runs in API mode (AP=1, or AP=2 "escaped"), every packet received
over the air comes out of its serial port wrapped in a frame:

    0x7E | length (2 bytes, big-endian) | frame data ... | checksum

    checksum = 0xFF - (sum(frame data) & 0xFF)

The frame data's first byte is the frame type. We unwrap the received-data frames and
hand the payload (the bytes the flight computer sent) to an inner decoder such as
``fc_uart_v1``. The rocket-side XBee may run in transparent or API mode; it doesn't matter
to us, as long as the GROUND XBee is in API mode.

Signal strength: frame 0x90 doesn't carry RSSI, so the serial source periodically asks
the ground XBee for the last packet's RSSI with a local "DB" AT command (frame 0x08). Local
AT commands are handled by the ground module itself and are never transmitted over RF.
Only read-only commands are allowed (see ``READ_ONLY_AT_COMMANDS``).

Reference: Digi XBee SX / XBee-PRO 900HP user guides, "API frame" sections. Verify the
frame types against the exact firmware you buy.
"""

from __future__ import annotations

from dataclasses import dataclass

from .base import RejectedPacket, SourceEvent, SourcePacket
from .decoders import StreamDecoder

START = 0x7E
ESC = 0x7D
XON = 0x11
XOFF = 0x13
ESCAPE_SET = {START, ESC, XON, XOFF}
MAX_FRAME_LEN = 512

# Frame types we understand (received from the ground XBee).
RX_PACKET_64 = 0x90  # Receive Packet (DigiMesh / point-to-multipoint): no RSSI
RX_LEGACY_64 = 0x80  # RX 64-bit address (legacy): includes RSSI
RX_LEGACY_16 = 0x81  # RX 16-bit address (legacy): includes RSSI
AT_RESPONSE = 0x88  # Local AT command response

# The only local AT commands this software will ever send. All are read-only queries.
READ_ONLY_AT_COMMANDS = {b"DB"}


def checksum(frame_data: bytes) -> int:
    return 0xFF - (sum(frame_data) & 0xFF)


def escape(raw: bytes) -> bytes:
    out = bytearray()
    for b in raw:
        if b in ESCAPE_SET:
            out += bytes([ESC, b ^ 0x20])
        else:
            out.append(b)
    return bytes(out)


def build_frame(frame_data: bytes, escaped: bool = False) -> bytes:
    """Wrap frame data as an API frame (used by tests, the fake radio, and the DB query)."""
    body = len(frame_data).to_bytes(2, "big") + frame_data + bytes([checksum(frame_data)])
    return bytes([START]) + (escape(body) if escaped else body)


def build_local_at_query(command: bytes, frame_id: int = 1, escaped: bool = False) -> bytes:
    """Local AT command (0x08) — answered by the ground module, never sent over the air."""
    if command not in READ_ONLY_AT_COMMANDS:
        raise ValueError(f"refusing to send AT command {command!r}: only read-only queries are allowed")
    return build_frame(bytes([0x08, frame_id & 0xFF]) + command, escaped)


@dataclass
class _Result:
    consumed: int
    frame: bytes | None = None
    error: str | None = None


class XBeeFrameReader:
    """Splits a serial byte stream into validated API frame data. Handles AP=1 and AP=2."""

    def __init__(self, escaped: bool) -> None:
        self.escaped = escaped
        self.buf = bytearray()
        self.discarded_bytes = 0

    def feed(self, data: bytes) -> list[tuple[bytes | None, str | None]]:
        """Returns a list of (frame_data, None) for good frames or (None, reason) for bad ones."""
        self.buf += data
        out: list[tuple[bytes | None, str | None]] = []
        while True:
            start = self.buf.find(START)
            if start < 0:
                self.discarded_bytes += len(self.buf)
                self.buf.clear()
                break
            if start > 0:
                self.discarded_bytes += start
                del self.buf[:start]
            res = self._try_frame()
            if res is None:
                break  # need more bytes
            del self.buf[: res.consumed]
            if res.frame is not None:
                out.append((res.frame, None))
            else:
                out.append((None, res.error))
        if len(self.buf) > 4 * MAX_FRAME_LEN:
            self.buf.clear()
        return out

    def _try_frame(self) -> _Result | None:
        body = bytearray()
        i = 1  # skip the 0x7E
        buf = self.buf
        while i < len(buf):
            b = buf[i]
            if self.escaped:
                if b == START:
                    return _Result(consumed=i, error="xbee frame truncated (new frame started)")
                if b == ESC:
                    if i + 1 >= len(buf):
                        return None
                    b = buf[i + 1] ^ 0x20
                    i += 2
                else:
                    i += 1
            else:
                i += 1
            body.append(b)
            if len(body) >= 2:
                length = (body[0] << 8) | body[1]
                if length == 0 or length > MAX_FRAME_LEN:
                    return _Result(consumed=1, error=f"xbee frame length {length} invalid")
                if len(body) == 2 + length + 1:
                    frame = bytes(body[2 : 2 + length])
                    if (sum(frame) + body[-1]) & 0xFF != 0xFF:
                        # Unescaped mode: 0x7E can appear inside data, so only skip one byte.
                        return _Result(consumed=i if self.escaped else 1, error="xbee frame checksum mismatch")
                    return _Result(consumed=i, frame=frame)
        return None


class XBeeApiDecoder(StreamDecoder):
    """Unwraps XBee API frames and passes RF payloads to an inner decoder (e.g. fc_uart_v1)."""

    def __init__(self, inner: StreamDecoder, escaped: bool = False) -> None:
        self.inner = inner
        self.reader = XBeeFrameReader(escaped)
        self.escaped = escaped
        self.last_rssi_dbm: float | None = None
        self.frames_rx = 0
        self.frames_other = 0

    @property
    def discarded_bytes(self) -> int:
        return self.reader.discarded_bytes + getattr(self.inner, "discarded_bytes", 0)

    def rssi_query(self) -> bytes:
        return build_local_at_query(b"DB", escaped=self.escaped)

    def feed(self, data: bytes) -> list[SourceEvent]:
        out: list[SourceEvent] = []
        for frame, error in self.reader.feed(data):
            if frame is None:
                out.append(RejectedPacket(reason=error or "bad xbee frame", raw=""))
                continue
            ftype = frame[0]
            payload: bytes | None = None
            frame_rssi: float | None = None
            if ftype == RX_PACKET_64 and len(frame) >= 12:
                payload = frame[12:]
            elif ftype == RX_LEGACY_64 and len(frame) >= 11:
                frame_rssi, payload = -float(frame[9]), frame[11:]
            elif ftype == RX_LEGACY_16 and len(frame) >= 5:
                frame_rssi, payload = -float(frame[3]), frame[5:]
            elif ftype == AT_RESPONSE and len(frame) >= 5:
                if frame[2:4] == b"DB" and frame[4] == 0 and len(frame) >= 6:
                    self.last_rssi_dbm = -float(frame[5])
                continue
            else:
                self.frames_other += 1
                continue

            if payload is None:
                out.append(RejectedPacket(reason=f"xbee frame 0x{ftype:02X} too short", raw=frame.hex()))
                continue
            self.frames_rx += 1
            if frame_rssi is not None:
                self.last_rssi_dbm = frame_rssi
            for ev in self.inner.feed(payload):
                if isinstance(ev, SourcePacket) and ev.rssi_dbm is None:
                    ev.rssi_dbm = frame_rssi if frame_rssi is not None else self.last_rssi_dbm
                out.append(ev)
        return out
