"""Real telemetry from the ground radio receiver on a serial port.

Reads raw bytes and hands them to a stream decoder chosen by ``serial.format``
(see ``decoders.py``). Adding a new over-the-air format means adding a decoder there;
nothing here or in the UI changes.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Any

from ..config import SerialConfig
from ..schema import Mode
from .base import SourceEvent, TelemetrySource
from .decoders import DECODERS, PacketError, parse_jsonl_line

__all__ = ["PacketError", "SerialLoRaSource", "parse_jsonl_line"]

READ_CHUNK = 256


class SerialLoRaSource(TelemetrySource):
    mode = Mode.LIVE
    name = "serial"

    def __init__(self, cfg: SerialConfig) -> None:
        if cfg.format not in DECODERS:
            raise ValueError(f"unknown serial format {cfg.format!r}; known: {sorted(DECODERS)}")
        self.cfg = cfg
        self.decoder = DECODERS[cfg.format]()
        self.port_state = "CLOSED"
        self.last_error: str | None = None
        self.bytes_read = 0
        self._ser: Any = None

    def status(self) -> dict[str, Any]:
        return {
            "port": self.cfg.port,
            "baud": self.cfg.baud,
            "format": self.cfg.format,
            "port_state": self.port_state,
            "last_error": self.last_error,
            "bytes_read": self.bytes_read,
            "discarded_bytes": getattr(self.decoder, "discarded_bytes", None),
        }

    def _open(self) -> Any:
        import serial  # pyserial

        return serial.Serial(self.cfg.port, self.cfg.baud, timeout=0.2)

    def _read(self) -> bytes:
        ser = self._ser
        return ser.read(max(1, min(READ_CHUNK, ser.in_waiting)))

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
