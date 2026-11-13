"""TelemetryHub: runs one active source, tracks link health, records, and fans out to UI clients.

Exactly one source is active at a time and switching sources clears all history,
so SIMULATION, LIVE and REPLAY data are never mixed on screen or in a log.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections import deque
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .config import Config
from .recorder import SessionRecorder
from .schema import FlightEvent, Mode, Phase, TelemetryFrame, transition_name
from .sources import (
    RejectedPacket,
    ReplaySource,
    SerialRadioSource,
    SimulationSource,
    SourcePacket,
    TelemetrySource,
)

log = logging.getLogger(__name__)

STATUS_INTERVAL_S = 0.5
CLIENT_QUEUE_SIZE = 2000


class LinkStats:
    def __init__(self) -> None:
        self.received = 0
        self.missed = 0
        self.rejected = 0
        self.sequence_resets = 0
        self.last_sequence: int | None = None
        self.last_packet_mono: float | None = None
        self.last_packet_utc: datetime | None = None
        self.last_rssi_dbm: float | None = None
        self.last_snr_db: float | None = None
        # False once any packet arrives without a sequence number: loss can't be measured.
        self.sequence_tracking = True

    def record(self, seq: int | None, rssi: float | None, snr: float | None, now_utc: datetime) -> None:
        if seq is None:
            self.sequence_tracking = False
            self.last_sequence = None
        elif self.last_sequence is not None:
            if seq > self.last_sequence:
                self.missed += seq - self.last_sequence - 1
            else:
                # Duplicate, out of order, or the flight computer rebooted. Don't count as loss.
                self.sequence_resets += 1
        self.last_sequence = seq
        self.received += 1
        self.last_packet_mono = time.monotonic()
        self.last_packet_utc = now_utc
        self.last_rssi_dbm = rssi
        self.last_snr_db = snr

    def as_dict(self, stale_after_s: float) -> dict[str, Any]:
        age = None if self.last_packet_mono is None else time.monotonic() - self.last_packet_mono
        expected = self.received + self.missed
        if age is None:
            state = "NO_DATA"
        elif age > stale_after_s:
            state = "STALE"
        else:
            state = "OK"
        return {
            "state": state,
            "received": self.received,
            "missed": self.missed,
            "rejected": self.rejected,
            "sequence_resets": self.sequence_resets,
            "sequence_tracking": self.sequence_tracking,
            "loss_pct": round(100.0 * self.missed / expected, 2) if expected and self.sequence_tracking else None,
            "last_sequence": self.last_sequence,
            "last_packet_age_s": round(age, 2) if age is not None else None,
            "last_packet_utc": self.last_packet_utc.isoformat() if self.last_packet_utc else None,
            "rssi_dbm": self.last_rssi_dbm,
            "snr_db": self.last_snr_db,
            "stale_after_s": stale_after_s,
        }


class TelemetryHub:
    def __init__(self, cfg: Config, data_dir: Path) -> None:
        self.cfg = cfg
        self.data_dir = data_dir
        self.source: TelemetrySource | None = None
        self.recorder: SessionRecorder | None = None
        self.stats = LinkStats()
        self.history: deque[dict[str, Any]] = deque(maxlen=cfg.ground.history_frames)
        self.events: list[dict[str, Any]] = []
        self.last_phase: Phase | None = None
        self.source_error: str | None = None
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self._task: asyncio.Task[None] | None = None
        self._status_task: asyncio.Task[None] | None = None
        self._lock = asyncio.Lock()

    # ---------- lifecycle ----------
    async def start(self) -> None:
        self._status_task = asyncio.create_task(self._status_loop())

    async def shutdown(self) -> None:
        await self._stop_source()
        if self._status_task:
            self._status_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._status_task

    def _build_source(self, mode: Mode, session_csv: Path | None, speed: float) -> TelemetrySource:
        if mode == Mode.SIMULATION:
            return SimulationSource(self.cfg.simulation)
        if mode == Mode.LIVE:
            return SerialRadioSource(self.cfg.serial)
        if session_csv is None:
            raise ValueError("REPLAY needs a recorded session")
        return ReplaySource(session_csv, speed=speed)

    async def switch(self, mode: Mode, session_csv: Path | None = None, speed: float = 1.0) -> None:
        async with self._lock:
            source = self._build_source(mode, session_csv, speed)
            await self._stop_source()
            self.stats = LinkStats()
            self.history.clear()
            self.events = []
            self.last_phase = None
            self.source_error = None
            self.source = source
            # Replays are not re-recorded; SIMULATION and LIVE each get their own session folder.
            if mode in (Mode.SIMULATION, Mode.LIVE):
                self.recorder = SessionRecorder(self.data_dir, mode)
            self._task = asyncio.create_task(self._run(source))
            log.info("switched to %s (%s)", mode.value, source.name)
        self._broadcast(self.snapshot())

    async def _stop_source(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        if self.source:
            await self.source.close()
        if self.recorder:
            self.recorder.close()
            self.recorder = None

    async def _run(self, source: TelemetrySource) -> None:
        try:
            async for ev in source.events():
                if isinstance(ev, SourcePacket):
                    self.handle_packet(ev, source)
                elif isinstance(ev, RejectedPacket):
                    self.handle_rejected(ev)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # keep the server up; surface the fault in the UI
            log.exception("telemetry source crashed")
            self.source_error = f"{type(e).__name__}: {e}"

    # ---------- packet handling ----------
    def handle_packet(self, pkt: SourcePacket, source: TelemetrySource) -> TelemetryFrame:
        now = datetime.now(UTC)
        frame = TelemetryFrame(
            mode=source.mode,
            source=source.name,
            received_at_utc=now,
            rssi_dbm=pkt.rssi_dbm,
            snr_db=pkt.snr_db,
            data=pkt.data,
        )
        self.stats.record(pkt.data.sequence, pkt.rssi_dbm, pkt.snr_db, now)
        frame_json = frame.model_dump(mode="json")
        self.history.append(frame_json)
        if self.recorder:
            self.recorder.write_frame(frame)
        self._broadcast({"type": "frame", "frame": frame_json})

        phase = pkt.data.phase
        if self.last_phase is not None and phase != self.last_phase:
            event = FlightEvent(
                received_at_utc=now,
                flight_time_s=pkt.data.flight_time_s,
                sequence=pkt.data.sequence,
                name=transition_name(self.last_phase, phase),
                from_phase=self.last_phase,
                to_phase=phase,
            )
            event_json = event.model_dump(mode="json")
            self.events.append(event_json)
            if self.recorder:
                self.recorder.write_event(event)
            self._broadcast({"type": "event", "event": event_json})
        self.last_phase = phase
        return frame

    def handle_rejected(self, rej: RejectedPacket) -> None:
        now = datetime.now(UTC)
        self.stats.rejected += 1
        if self.recorder:
            self.recorder.write_rejected(now, rej.reason, rej.raw)
        self._broadcast({"type": "rejected", "received_at_utc": now.isoformat(), "reason": rej.reason})

    # ---------- status / fan-out ----------
    def status(self) -> dict[str, Any]:
        src = self.source
        return {
            "mode": src.mode.value if src else None,
            "source": src.name if src else None,
            "source_status": src.status() if src else {},
            "source_error": self.source_error,
            "link": self.stats.as_dict(self.cfg.ground.stale_after_s),
            "recording": {
                "active": self.recorder is not None,
                "path": str(self.recorder.path) if self.recorder else None,
                "rows": self.recorder.rows_written if self.recorder else 0,
            },
            "server_time_utc": datetime.now(UTC).isoformat(),
        }

    def snapshot(self) -> dict[str, Any]:
        return {
            "type": "snapshot",
            "status": self.status(),
            "frames": list(self.history),
            "events": list(self.events),
        }

    def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=CLIENT_QUEUE_SIZE)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[dict[str, Any]]) -> None:
        self._subscribers.discard(q)

    def _broadcast(self, msg: dict[str, Any]) -> None:
        for q in list(self._subscribers):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                # Slow client: drop it rather than stall ingestion. The WebSocket handler
                # sees "resync", closes, and the browser reconnects with a fresh snapshot.
                self._subscribers.discard(q)
                with contextlib.suppress(asyncio.QueueEmpty):
                    while True:
                        q.get_nowait()
                q.put_nowait({"type": "resync"})

    async def _status_loop(self) -> None:
        while True:
            await asyncio.sleep(STATUS_INTERVAL_S)
            self._broadcast({"type": "status", "status": self.status()})
