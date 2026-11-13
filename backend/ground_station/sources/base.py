"""Telemetry source interface.

Every source (simulation, real LoRa receiver, log replay) yields the same
normalized :class:`FlightData`, so the hub, logger, and UI never care which
one is active.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from ..schema import FlightData, Mode


@dataclass
class SourcePacket:
    """A packet that decoded and validated successfully."""

    data: FlightData
    # Receiver-side link metrics, if the ground radio reports them.
    rssi_dbm: float | None = None
    snr_db: float | None = None


@dataclass
class RejectedPacket:
    """Bytes that arrived but failed decoding/validation (bad CRC, bad JSON, out of range...)."""

    reason: str
    raw: str


SourceEvent = SourcePacket | RejectedPacket


class TelemetrySource(ABC):
    mode: Mode
    name: str

    @abstractmethod
    def events(self) -> AsyncIterator[SourceEvent]:
        """Yield packets as they arrive. May run forever."""

    def status(self) -> dict[str, Any]:
        """Source-specific status for the UI (port state, sim state, replay progress...)."""
        return {}

    async def close(self) -> None:
        """Release hardware/files. Called when the hub switches away from this source."""
