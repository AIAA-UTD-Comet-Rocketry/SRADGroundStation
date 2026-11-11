"""Append-only ground-side recording of received telemetry.

This is the GROUND log of what the radio received. It is separate from, and no
substitute for, the rocket's onboard SD log or the official COTS altimeter log.

Layout: <data_dir>/sessions/<UTC timestamp>_<mode>/
    telemetry.csv   one row per accepted packet
    events.csv      phase transitions seen in the telemetry
    rejected.csv    packets that failed decoding/validation
"""

from __future__ import annotations

import csv
import os
import re
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import IO, Any

from .schema import CSV_COLUMNS, FlightEvent, Mode, TelemetryFrame

FSYNC_INTERVAL_S = 1.0
SESSION_NAME_RE = re.compile(r"^\d{8}T\d{6}Z_[a-z]+$")


class SessionRecorder:
    def __init__(self, data_dir: Path, mode: Mode) -> None:
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        base = data_dir / "sessions" / f"{stamp}_{mode.value.lower()}"
        n = 1
        self.path = base
        while self.path.exists():
            n += 1
            self.path = base.with_name(f"{base.name}{n}")
        self.path.mkdir(parents=True)

        self._files: list[IO[str]] = []
        self._telemetry = self._open("telemetry.csv", CSV_COLUMNS)
        self._events = self._open(
            "events.csv", ["received_at_utc", "flight_time_s", "sequence", "name", "from_phase", "to_phase"]
        )
        self._rejected = self._open("rejected.csv", ["received_at_utc", "reason", "raw"])
        self.rows_written = 0
        self._last_sync = time.monotonic()

    def _open(self, name: str, columns: list[str]) -> csv.DictWriter:
        f = open(self.path / name, "w", newline="", buffering=1)
        self._files.append(f)
        w = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        w.writeheader()
        return w

    def _flush(self, force: bool = False) -> None:
        for f in self._files:
            f.flush()
        now = time.monotonic()
        if force or now - self._last_sync >= FSYNC_INTERVAL_S:
            for f in self._files:
                os.fsync(f.fileno())
            self._last_sync = now

    def write_frame(self, frame: TelemetryFrame) -> None:
        self._telemetry.writerow(frame.to_row())
        self.rows_written += 1
        self._flush()

    def write_event(self, event: FlightEvent) -> None:
        self._events.writerow(
            {
                "received_at_utc": event.received_at_utc.isoformat(),
                "flight_time_s": event.flight_time_s,
                "sequence": event.sequence,
                "name": event.name,
                "from_phase": event.from_phase.value,
                "to_phase": event.to_phase.value,
            }
        )
        self._flush()

    def write_rejected(self, received_at: datetime, reason: str, raw: str) -> None:
        self._rejected.writerow({"received_at_utc": received_at.isoformat(), "reason": reason, "raw": raw})
        self._flush()

    def close(self) -> None:
        if not self._files:
            return
        self._flush(force=True)
        for f in self._files:
            f.close()
        self._files.clear()


def list_sessions(data_dir: Path) -> list[dict[str, Any]]:
    root = data_dir / "sessions"
    if not root.is_dir():
        return []
    out = []
    for d in sorted(root.iterdir(), reverse=True):
        tel = d / "telemetry.csv"
        if d.is_dir() and SESSION_NAME_RE.match(d.name.rstrip("0123456789")) and tel.is_file():
            out.append({"name": d.name, "size_bytes": tel.stat().st_size})
    return out


def resolve_session(data_dir: Path, name: str) -> Path:
    """Map a session name from the UI to its telemetry.csv, refusing anything outside data_dir."""
    names = {s["name"] for s in list_sessions(data_dir)}
    if name not in names:
        raise FileNotFoundError(f"no recorded session named {name!r}")
    return data_dir / "sessions" / name / "telemetry.csv"
