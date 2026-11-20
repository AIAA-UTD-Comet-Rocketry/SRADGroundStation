"""Simulated RANGER-1 propellant system for the Pad Ops page (PROTOTYPE).

ILLUSTRATIVE ONLY. A few lines of physics so the Pad Ops page has something believable to show
before the prop team has chosen sensors: N2O fill, hold, and a ~4 s blowdown burn. Numbers come
from the 2027 PDR (RANGER-1: 4.0 s burn, 318 psia initial chamber pressure, nitrous turning to
gas near 3.8 s, ~13 lbm of N2O) and the standard nitrous vapour-pressure curve. It is not a
propulsion model and must never be used to judge real hardware: use the prop team's HCR sim.

Self-pressurizing nitrous: while liquid is present, tank pressure is the vapour pressure at the
liquid temperature, whatever the fill level. That's why fill level needs a load cell (or similar),
not a pressure sensor.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

PSI = 6894.757

# N2O vapour pressure (ESDU 91022 correlation). Valid ~183-309.57 K.
N2O_TC_K = 309.57
N2O_PC_PA = 7.251e6


def n2o_vapor_pressure_pa(temp_c: float) -> float:
    t = temp_c + 273.15
    tr = min(t / N2O_TC_K, 1.0)
    x = 1 - tr
    ln = (1 / tr) * (-6.71893 * x + 1.35966 * x**1.5 - 1.3779 * x**2.5 - 4.051 * x**5)
    return N2O_PC_PA * math.exp(ln)


@dataclass
class PropParams:
    ox_target_kg: float = 5.9  # ~13 lbm: PDR NOS mass flow 3.24 lbm/s x 4.0 s burn
    fill_time_s: float = 420.0  # PDR: remote fill ~7 min
    ambient_c: float = 25.0
    fill_cooling_c: float = 8.0  # tank cools while the static vent boils off gas during fill
    vent_loss_kg_s: float = 0.0015  # boil-off through the static vent while holding (assumed)
    liquid_out_s: float = 3.8  # PDR: tank model switches to gas near 3.8 s
    burn_cooling_c: float = 14.0  # liquid cools as it boils to keep the tank pressurised
    chamber_psia_0: float = 318.4  # PDR initial chamber pressure
    piston_drop_psi: float = 15.0  # fuel side reads a little lower than the ox side (assumed)


# States (strings so they serialise straight to the UI)
EMPTY, FILLING, HOLD, BURN, SPENT = "EMPTY", "FILLING", "HOLD", "BURN", "SPENT"


class PropulsionSim:
    def __init__(self, p: PropParams | None = None) -> None:
        self.p = p or PropParams()
        self.state = EMPTY
        self.state_t = 0.0  # seconds in the current state (sim time)
        self.ox_kg = 0.0
        self.temp_c = self.p.ambient_c
        self.burn_t = 0.0
        self.ox_at_ignition = 0.0
        self.temp_at_ignition = self.p.ambient_c
        self.gas_p_pa = 0.0  # tank pressure once the liquid is gone

    # ---- simulator controls ----
    def start_fill(self) -> None:
        if self.state in (EMPTY, HOLD):
            self._set(FILLING)

    def stop_fill(self) -> None:
        if self.state == FILLING:
            self._set(HOLD)

    def ignite(self) -> None:
        if self.state in (BURN, SPENT):
            return
        if self.ox_kg < 0.05 * self.p.ox_target_kg:
            # Launched without a fill (e.g. from the Mission Dashboard): assume a nominal load.
            self.ox_kg = self.p.ox_target_kg
            self.temp_c = self.p.ambient_c - 4
        self.ox_at_ignition = self.ox_kg
        self.temp_at_ignition = self.temp_c
        self.burn_t = 0.0
        self._set(BURN)

    def _set(self, state: str) -> None:
        self.state = state
        self.state_t = 0.0

    # ---- physics ----
    def step(self, dt: float) -> None:
        p = self.p
        self.state_t += dt
        if self.state == FILLING:
            self.ox_kg = min(p.ox_target_kg, self.ox_kg + p.ox_target_kg / p.fill_time_s * dt)
            self._relax_temp(p.ambient_c - p.fill_cooling_c, 60.0, dt)
        elif self.state == HOLD:
            self.ox_kg = max(0.0, self.ox_kg - p.vent_loss_kg_s * dt)
            self._relax_temp(p.ambient_c - 3.0, 300.0, dt)
        elif self.state == BURN:
            self.burn_t += dt
            frac = min(1.0, self.burn_t / p.liquid_out_s)
            self.ox_kg = self.ox_at_ignition * (1 - frac)
            self.temp_c = self.temp_at_ignition - p.burn_cooling_c * frac
            if frac >= 1.0:
                tg = self.burn_t - p.liquid_out_s
                self.gas_p_pa = n2o_vapor_pressure_pa(self.temp_c) * math.exp(-tg / 0.25)
                if tg > 1.5:
                    self._set(SPENT)
                    self.gas_p_pa = 0.0
        elif self.state == SPENT:
            self._relax_temp(self.p.ambient_c, 120.0, dt)

    def _relax_temp(self, target: float, tau: float, dt: float) -> None:
        self.temp_c += (target - self.temp_c) * min(1.0, dt / tau)

    # ---- readings (what sensors would report) ----
    def tank_pressure_pa(self) -> float:
        if self.state == SPENT:
            return 0.0
        if self.state == BURN and self.burn_t >= self.p.liquid_out_s:
            return self.gas_p_pa
        if self.ox_kg <= 0:
            return 0.0
        # A nearly empty tank is still filling with vapour; ramp up over the first ~0.2 kg.
        return n2o_vapor_pressure_pa(self.temp_c) * min(1.0, self.ox_kg / 0.2)

    def chamber_pressure_pa(self) -> float:
        if self.state != BURN:
            return 0.0
        p0 = n2o_vapor_pressure_pa(self.temp_at_ignition)
        ramp = min(1.0, self.burn_t / 0.15)  # igniter + valve opening
        return self.p.chamber_psia_0 * PSI * ramp * self.tank_pressure_pa() / p0

    def fuel_pressure_pa(self) -> float:
        tank = self.tank_pressure_pa()
        return max(0.0, tank - self.p.piston_drop_psi * PSI) if tank > 0 else 0.0

    @property
    def fill_valve_open(self) -> bool:
        return self.state == FILLING

    @property
    def main_valves_open(self) -> bool:
        return self.state in (BURN, SPENT)
