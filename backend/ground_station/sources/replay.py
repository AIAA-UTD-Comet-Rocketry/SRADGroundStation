"""Replay a recorded session's telemetry.csv at its original timing (optionally sped up)."""

from __future__ import annotations

import asyncio
import csv
from collections.abc import AsyncIterator
from datetime import datetime
from pathlib import Path
from typing import Any

from ..schema import FlightData, Mode
from .base import RejectedPacket, SourceEvent, SourcePacket, TelemetrySource

MAX_GAP_S = 5.0  # don't sit idle for long recorded gaps


def _none_if_empty(v: str | None) -> str | None:
    return None if v is None or v == "" else v


def row_to_packet(row: dict[str, str]) -> SourcePacket:
    flight_fields = {k: _none_if_empty(row.get(k)) for k in FlightData.model_fields}
    data = FlightData.model_validate({k: v for k, v in flight_fields.items() if v is not None})
    rssi = _none_if_empty(row.get("rssi_dbm"))
    snr = _none_if_empty(row.get("snr_db"))
    return SourcePacket(
        data=data,
        rssi_dbm=float(rssi) if rssi is not None else None,
        snr_db=float(snr) if snr is not None else None,
    )


class ReplaySource(TelemetrySource):
    mode = Mode.REPLAY

    def __init__(self, csv_path: Path, speed: float = 1.0) -> None:
        self.path = csv_path
        self.name = f"replay:{csv_path.parent.name}"
        self.speed = max(0.1, min(50.0, speed))
        with open(csv_path, newline="") as f:
            self.rows = list(csv.DictReader(f))
        self.index = 0
        self.finished = False

    def status(self) -> dict[str, Any]:
        return {
            "session": self.path.parent.name,
            "speed": self.speed,
            "position": self.index,
            "total": len(self.rows),
            "finished": self.finished,
        }

    async def events(self) -> AsyncIterator[SourceEvent]:
        prev_t: datetime | None = None
        for i, row in enumerate(self.rows):
            self.index = i + 1
            try:
                t = datetime.fromisoformat(row["received_at_utc"])
            except (KeyError, ValueError):
                t = None
            if prev_t is not None and t is not None:
                gap = min(MAX_GAP_S, max(0.0, (t - prev_t).total_seconds()))
                await asyncio.sleep(gap / self.speed)
            prev_t = t or prev_t
            try:
                yield row_to_packet(row)
            except Exception as e:  # malformed row in the log
                yield RejectedPacket(reason=f"bad log row {i + 2}: {e}"[:300], raw="")
        self.finished = True
