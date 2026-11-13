"""Real telemetry from the ground radio receiver on a serial port.

Reads raw bytes and hands them to a decoder chain chosen by config:

    framing  (how packets are wrapped on the serial line: raw / XBee API)
      └─ format  (the flight computer's packet layout: fc_uart_v1 / jsonl)

Adding a radio or packet format means adding a decoder; nothing here or in the UI changes.

Monitoring only: the one thing ever written to the port is a read-only local query to an
XBee ("DB" = RSSI of the last packet), which the ground module answers itself without
transmitting.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from typing import Any

from ..config import SerialConfig
from ..schema import Mode
from .base import SourceEvent, TelemetrySource
from .decoders import DECODERS, PacketError, StreamDecoder, parse_jsonl_line
from .xbee import XBeeApiDecoder

__all__ = ["FRAMINGS", "PacketError", "SerialRadioSource", "SerialLoRaSource", "make_decoder", "parse_jsonl_line"]

READ_CHUNK = 256
FRAMINGS = ("raw", "xbee_api", "xbee_api_escaped")


def make_decoder(cfg: SerialConfig) -> StreamDecoder:
    if cfg.format not in DECODERS:
        raise ValueError(f"unknown serial format {cfg.format!r}; known: {sorted(DECODERS)}")
    if cfg.framing not in FRAMINGS:
        raise ValueError(f"unknown serial framing {cfg.framing!r}; known: {list(FRAMINGS)}")
    inner = DECODERS[cfg.format]()
    if cfg.framing == "raw":
        return inner
    return XBeeApiDecoder(inner, escaped=cfg.framing == "xbee_api_escaped")


class SerialRadioSource(TelemetrySource):
    mode = Mode.LIVE
    name = "serial"

    def __init__(self, cfg: SerialConfig) -> None:
        self.cfg = cfg
        self.decoder = make_decoder(cfg)
        self.port_state = "CLOSED"
        self.last_error: str | None = None
        self.bytes_read = 0
        self._ser: Any = None
        self._last_query = 0.0

    def status(self) -> dict[str, Any]:
        st: dict[str, Any] = {
            "port": self.cfg.port,
            "baud": self.cfg.baud,
            "format": self.cfg.format,
            "framing": self.cfg.framing,
            "port_state": self.port_state,
            "last_error": self.last_error,
            "bytes_read": self.bytes_read,
            "discarded_bytes": getattr(self.decoder, "discarded_bytes", None),
        }
        if isinstance(self.decoder, XBeeApiDecoder):
            st["xbee_frames_rx"] = self.decoder.frames_rx
            st["xbee_frames_other"] = self.decoder.frames_other
        return st

    def _open(self) -> Any:
        import serial  # pyserial

        return serial.Serial(self.cfg.port, self.cfg.baud, timeout=0.2)

    def _read(self) -> bytes:
        ser = self._ser
        return ser.read(max(1, min(READ_CHUNK, ser.in_waiting)))

    def _maybe_query_rssi(self) -> None:
        if not (isinstance(self.decoder, XBeeApiDecoder) and self.cfg.xbee_query_rssi):
            return
        now = time.monotonic()
        if now - self._last_query >= self.cfg.xbee_rssi_interval_s:
            self._last_query = now
            self._ser.write(self.decoder.rssi_query())

    async def events(self) -> AsyncIterator[SourceEvent]:
        import serial

        while True:
            try:
                self._ser = await asyncio.to_thread(self._open)
            except (serial.SerialException, OSError) as e:
                self.port_state = "UNAVAILABLE"
                self.last_error = str(e)
                await asyncio.sleep(2.0)
                continue

            self.port_state = "OPEN"
            self.last_error = None
            try:
                while True:
                    await asyncio.to_thread(self._maybe_query_rssi)
                    chunk = await asyncio.to_thread(self._read)
                    if not chunk:
                        continue
                    self.bytes_read += len(chunk)
                    for ev in self.decoder.feed(chunk):
                        yield ev
            except (serial.SerialException, OSError) as e:
                self.port_state = "LOST"
                self.last_error = str(e)
                await asyncio.sleep(1.0)
            finally:
                await self.close()

    async def close(self) -> None:
        if self._ser is not None:
            try:
                self._ser.close()
            except Exception:
                pass
            self._ser = None
            if self.port_state == "OPEN":
                self.port_state = "CLOSED"


# Old name: the receiver isn't necessarily LoRa (e.g. Digi XBee SX is FHSS, not LoRa).
SerialLoRaSource = SerialRadioSource
