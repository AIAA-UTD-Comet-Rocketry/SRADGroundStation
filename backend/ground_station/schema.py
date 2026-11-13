"""Normalized telemetry schema shared by every source, the logger, and the UI.

DRAFT — schema_version 1 is a placeholder agreed by nobody yet. Units, frames and
field list must be confirmed with the avionics team before flight.

Conventions:
* ``None`` means "no data" (field not present in the packet). It is never the same as 0.
* Altitudes are metres. ``altitude_agl_m`` is barometric altitude above the pad;
  ``gps_altitude_msl_m`` is GPS altitude above mean sea level. They are not interchangeable.
* ``acceleration_mps2`` is vertical acceleration as reported by the flight computer.
* Rocket-side fields live in :class:`FlightData`. Ground-side metadata (receive time,
  RSSI/SNR measured by the ground radio) lives in :class:`TelemetryFrame`.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION = 1


class Mode(str, Enum):
    SIMULATION = "SIMULATION"
    LIVE = "LIVE"
    REPLAY = "REPLAY"


class Phase(str, Enum):
    UNKNOWN = "UNKNOWN"
    PAD = "PAD"
    BOOST = "BOOST"
    COAST = "COAST"
    APOGEE = "APOGEE"
    DROGUE = "DROGUE"
    MAIN = "MAIN"
    LANDED = "LANDED"


class FlightData(BaseModel):
    """Fields that originate on the rocket (one decoded packet)."""

    model_config = ConfigDict(extra="ignore")

    schema_version: int = SCHEMA_VERSION
    # Packet counter set by the rocket. None when the packet format has no counter,
    # in which case packet-loss can't be measured (only staleness).
    sequence: int | None = Field(default=None, ge=0)
    flight_time_s: float | None = None
    # Flight computer's own clock (e.g. ms since power-on), when the packet carries one.
    fc_time_s: float | None = None
    phase: Phase = Phase.UNKNOWN
    # Raw state name as the flight computer reports it (e.g. "ARMED"), before mapping to Phase.
    fc_state: str | None = None

    altitude_agl_m: float | None = None
    vertical_velocity_mps: float | None = None
    acceleration_mps2: float | None = None

    latitude_deg: float | None = Field(default=None, ge=-90, le=90)
    longitude_deg: float | None = Field(default=None, ge=-180, le=180)
    gps_fix: bool | None = None
    gps_altitude_msl_m: float | None = None

    pressure_pa: float | None = Field(default=None, ge=0)
    temperature_c: float | None = None

    # Body-frame IMU values as reported. Axis orientation and whether gravity is
    # included are NOT confirmed — don't treat any of these as "vertical".
    accel_x_mps2: float | None = None
    accel_y_mps2: float | None = None
    accel_z_mps2: float | None = None
    pitch_deg: float | None = None
    roll_deg: float | None = None
    yaw_deg: float | None = None

    # Raw flight-computer bitfields (meaning per flight software).
    status_flags: int | None = Field(default=None, ge=0)
    pyro_status: int | None = Field(default=None, ge=0)


class TelemetryFrame(BaseModel):
    """A decoded packet plus metadata attached on the ground."""

    mode: Mode
    source: str
    received_at_utc: datetime
    rssi_dbm: float | None = None
    snr_db: float | None = None
    data: FlightData

    def to_row(self) -> dict[str, object]:
        """Flatten to a single dict for CSV logging."""
        row: dict[str, object] = {
            "received_at_utc": self.received_at_utc.isoformat(),
            "mode": self.mode.value,
            "source": self.source,
            "rssi_dbm": self.rssi_dbm,
            "snr_db": self.snr_db,
        }
        for key, value in self.data.model_dump().items():
            row[key] = value.value if isinstance(value, Enum) else value
        return row


CSV_COLUMNS: list[str] = [
    "received_at_utc",
    "mode",
    "source",
    "rssi_dbm",
    "snr_db",
    *FlightData.model_fields.keys(),
]


class FlightEvent(BaseModel):
    """An event derived from a phase transition in the received telemetry."""

    received_at_utc: datetime
    flight_time_s: float | None
    sequence: int | None
    name: str
    from_phase: Phase
    to_phase: Phase


# Labels for phase transitions. The phase itself always comes from the packet;
# the ground station only names the transition, it never infers one.
TRANSITION_NAMES: dict[tuple[Phase, Phase], str] = {
    (Phase.PAD, Phase.BOOST): "Liftoff",
    (Phase.BOOST, Phase.COAST): "Burnout",
    (Phase.COAST, Phase.DROGUE): "Apogee / drogue deploy",
    (Phase.COAST, Phase.APOGEE): "Apogee",
    (Phase.APOGEE, Phase.DROGUE): "Drogue deploy",
    (Phase.APOGEE, Phase.MAIN): "Main deploy",
    (Phase.DROGUE, Phase.MAIN): "Main deploy",
    (Phase.MAIN, Phase.LANDED): "Landed",
    (Phase.DROGUE, Phase.LANDED): "Landed",
}


def transition_name(prev: Phase, new: Phase) -> str:
    return TRANSITION_NAMES.get((prev, new), f"Phase {prev.value} -> {new.value}")
