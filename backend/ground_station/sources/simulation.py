"""Synthetic flight generator.

ILLUSTRATIVE ONLY. Drag-free boost/coast, fixed-rate parachute descent, constant wind.
It exists to exercise the UI and pipeline (phases, packet loss, dropouts, corrupt
packets), not to predict real flight performance. Use OpenRocket/RASAero for that.
"""

from __future__ import annotations

import asyncio
import math
import random
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from ..config import SimulationConfig
from ..schema import FlightData, Mode, Phase
from .base import RejectedPacket, SourceEvent, SourcePacket, TelemetrySource

G = 9.80665
FT_TO_M = 0.3048
SUBSTEP_S = 0.02
# Assumed horizontal offset between the pad and the ground station antenna.
GROUND_STATION_OFFSET_M = 300.0


def boost_accel_for_apogee(apogee_m: float, burn_time_s: float) -> float:
    """Net constant boost acceleration that reaches ``apogee_m`` with no drag.

    apogee = 0.5*a*tb^2 + (a*tb)^2 / (2g)  ->  quadratic in a.
    """
    tb = burn_time_s
    qa = tb * tb / (2 * G)
    qb = 0.5 * tb * tb
    return (-qb + math.sqrt(qb * qb + 4 * qa * apogee_m)) / (2 * qa)


@dataclass
class SimState:
    t: float = 0.0
    alt: float = 0.0
    vel: float = 0.0
    acc: float = 0.0
    east: float = 0.0
    north: float = 0.0
    phase: Phase = Phase.PAD


class SimFlight:
    """Deterministic flight model (no noise, no RF)."""

    def __init__(self, cfg: SimulationConfig, apogee_ft: float) -> None:
        self.cfg = cfg
        self.apogee_m = apogee_ft * FT_TO_M
        self.boost_accel = boost_accel_for_apogee(self.apogee_m, cfg.burn_time_s)
        self.state = SimState()
        self.max_alt = 0.0

    def launch(self) -> None:
        if self.state.phase == Phase.PAD:
            self.state.phase = Phase.BOOST

    def step(self, dt: float) -> None:
        remaining = dt
        while remaining > 1e-9:
            h = min(SUBSTEP_S, remaining)
            self._substep(h)
            remaining -= h

    def _approach(self, target_vel: float, h: float) -> None:
        s = self.state
        new_vel = s.vel + (target_vel - s.vel) * min(1.0, 1.5 * h)
        s.acc = (new_vel - s.vel) / h
        s.vel = new_vel

    def _substep(self, h: float) -> None:
        s, c = self.state, self.cfg
        if s.phase == Phase.PAD:
            s.acc = 0.0
            return
        if s.phase == Phase.LANDED:
            s.t += h
            return

        s.t += h
        drift = 0.3
        if s.phase == Phase.BOOST:
            s.acc = self.boost_accel
            s.vel += s.acc * h
            if s.t >= c.burn_time_s:
                s.phase = Phase.COAST
        elif s.phase == Phase.COAST:
            s.acc = -G
            s.vel += s.acc * h
            if s.vel <= 0:
                s.phase = Phase.DROGUE
        elif s.phase == Phase.DROGUE:
            drift = 1.0
            self._approach(-c.drogue_descent_mps, h)
            if s.alt <= c.main_deploy_agl_m:
                s.phase = Phase.MAIN
        elif s.phase == Phase.MAIN:
            drift = 1.0
            self._approach(-c.main_descent_mps, h)

        s.alt += s.vel * h
        s.east += c.wind_east_mps * drift * h
        s.north += c.wind_north_mps * drift * h
        self.max_alt = max(self.max_alt, s.alt)

        if s.alt <= 0 and s.phase in (Phase.DROGUE, Phase.MAIN):
            s.alt, s.vel, s.acc = 0.0, 0.0, 0.0
            s.phase = Phase.LANDED


def isa_pressure_pa(alt_msl_m: float) -> float:
    return 101_325.0 * (1 - 2.25577e-5 * alt_msl_m) ** 5.25588


class SimulationSource(TelemetrySource):
    """Emits synthetic packets at ``rate_hz`` with configurable packet loss and dropouts."""

    mode = Mode.SIMULATION
    name = "simulation"

    def __init__(self, cfg: SimulationConfig) -> None:
        self.cfg = cfg
        self.rng = random.Random(cfg.seed)
        self.apogee_ft = cfg.apogee_ft
        self.packet_loss = cfg.packet_loss
        self.corrupt_rate = cfg.corrupt_rate
        self.speed = 1.0
        self.paused = False
        self.sequence = 0
        self.dropout_remaining_s = 0.0
        self.flight = SimFlight(cfg, self.apogee_ft)

    # ---- operator controls (affect the simulator only, never a rocket) ----
    def launch(self) -> None:
        self.paused = False
        self.flight.launch()

    def set_paused(self, paused: bool) -> None:
        self.paused = paused

    def reset(self) -> None:
        self.flight = SimFlight(self.cfg, self.apogee_ft)
        self.paused = False
        self.dropout_remaining_s = 0.0

    def set_speed(self, speed: float) -> None:
        self.speed = max(0.1, min(20.0, speed))

    def set_apogee_ft(self, apogee_ft: float) -> None:
        if not 1_000 <= apogee_ft <= 60_000:
            raise ValueError("apogee_ft must be between 1,000 and 60,000")
        self.apogee_ft = apogee_ft
        if self.flight.state.phase == Phase.PAD:
            self.flight = SimFlight(self.cfg, apogee_ft)

    def set_packet_loss(self, p: float) -> None:
        self.packet_loss = max(0.0, min(1.0, p))

    def set_corrupt_rate(self, p: float) -> None:
        self.corrupt_rate = max(0.0, min(1.0, p))

    def trigger_dropout(self, seconds: float) -> None:
        self.dropout_remaining_s = max(0.0, seconds)

    def status(self) -> dict[str, Any]:
        st = self.flight.state
        return {
            "paused": self.paused,
            "speed": self.speed,
            "apogee_target_ft": self.apogee_ft,
            "packet_loss": self.packet_loss,
            "corrupt_rate": self.corrupt_rate,
            "dropout_remaining_s": round(self.dropout_remaining_s, 1),
            "sim_phase": st.phase.value,
        }

    # ---- packet generation ----
    def make_packet(self) -> SourcePacket:
        st, c, rng = self.flight.state, self.cfg, self.rng
        alt_meas = st.alt + rng.gauss(0, 0.5)
        alt_msl = c.pad_elevation_m + st.alt
        lat0 = math.radians(c.origin_lat_deg)
        north = st.north + rng.gauss(0, 2.0)
        east = st.east + rng.gauss(0, 2.0)
        data = FlightData(
            sequence=self.sequence,
            flight_time_s=round(st.t, 3),
            phase=st.phase,
            altitude_agl_m=round(alt_meas, 2),
            vertical_velocity_mps=round(st.vel + rng.gauss(0, 0.3), 2),
            acceleration_mps2=round(st.acc + rng.gauss(0, 0.2), 2),
            latitude_deg=round(c.origin_lat_deg + north / 111_320.0, 7),
            longitude_deg=round(c.origin_lon_deg + east / (111_320.0 * math.cos(lat0)), 7),
            gps_fix=True,
            gps_altitude_msl_m=round(alt_msl + rng.gauss(0, 5.0), 1),
            pressure_pa=round(isa_pressure_pa(c.pad_elevation_m + alt_meas), 1),
            temperature_c=round(15.0 - 0.0065 * alt_msl + rng.gauss(0, 0.1), 2),
        )
        horiz = math.hypot(st.east + GROUND_STATION_OFFSET_M, st.north)
        slant = max(10.0, math.hypot(horiz, st.alt))
        rssi = -40.0 - 20.0 * math.log10(slant / 10.0) + rng.gauss(0, 1.5)
        snr = max(-20.0, min(12.0, 10.0 - 0.4 * (-rssi - 80.0) + rng.gauss(0, 0.8)))
        return SourcePacket(data=data, rssi_dbm=round(rssi, 1), snr_db=round(snr, 1))

    def tick(self, dt_wall: float) -> SourceEvent | None:
        """Advance by one wall-clock tick. Returns the packet "received", or None if lost."""
        if self.paused:
            return None
        dt = dt_wall * self.speed
        self.flight.step(dt)
        packet = self.make_packet()
        self.sequence += 1  # the rocket increments even when the packet is lost

        if self.dropout_remaining_s > 1e-6:
            self.dropout_remaining_s = max(0.0, self.dropout_remaining_s - dt)
            return None
        if self.rng.random() < self.packet_loss:
            return None
        if self.rng.random() < self.corrupt_rate:
            return RejectedPacket(reason="simulated CRC failure", raw="<corrupt>")
        return packet

    async def events(self) -> AsyncIterator[SourceEvent]:
        period = 1.0 / self.cfg.rate_hz
        loop = asyncio.get_running_loop()
        next_t = loop.time()
        while True:
            next_t += period
            await asyncio.sleep(max(0.0, next_t - loop.time()))
            ev = self.tick(period)
            if ev is not None:
                yield ev
