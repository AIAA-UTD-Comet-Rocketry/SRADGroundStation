"""Real telemetry from a LoRa ground receiver on a serial port.

STATUS: skeleton. The flight packet format and the receiver hardware are not
decided yet, so the only decoder is ``jsonl`` — one JSON object per line using the
:class:`FlightData` field names, optionally with receiver-added ``rssi_dbm`` /
``snr_db``. That is handy for bench tests (an ESP32 or a laptop script can print it),
but the flight link will almost certainly use a compact binary packet with a CRC.
When that format is defined, add a decoder here with the same signature as
:func:`parse_jsonl_line` and register it in ``DECODERS``.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Callable
from typing import Any

from pydantic import ValidationError

from ..config import SerialConfig
from ..schema import SCHEMA_VERSION, FlightData, Mode
from .base import RejectedPacket, SourceEvent, SourcePacket, TelemetrySource


class PacketError(ValueError):
    pass


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


Decoder = Callable[[bytes], SourcePacket]
DECODERS: dict[str, Decoder] = {"jsonl": parse_jsonl_line}


class SerialLoRaSource(TelemetrySource):
    mode = Mode.LIVE
    name = "serial"

    def __init__(self, cfg: SerialConfig) -> None:
        if cfg.format not in DECODERS:
            raise ValueError(f"unknown serial format {cfg.format!r}; known: {sorted(DECODERS)}")
        self.cfg = cfg
        self.decode = DECODERS[cfg.format]
        self.port_state = "CLOSED"
        self.last_error: str | None = None
        self._ser: Any = None

    def status(self) -> dict[str, Any]:
        return {
            "port": self.cfg.port,
            "baud": self.cfg.baud,
            "format": self.cfg.format,
            "port_state": self.port_state,
            "last_error": self.last_error,
        }

    def _open(self) -> Any:
        import serial  # pyserial

        return serial.Serial(self.cfg.port, self.cfg.baud, timeout=0.5)

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
                    line = await asyncio.to_thread(self._ser.readline)
                    if not line or not line.strip():
                        continue
                    try:
                        yield self.decode(line.strip())
                    except PacketError as e:
                        yield RejectedPacket(reason=str(e)[:300], raw=line[:200].decode("utf-8", "replace"))
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
