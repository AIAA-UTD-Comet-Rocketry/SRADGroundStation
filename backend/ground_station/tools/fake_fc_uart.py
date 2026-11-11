"""Pretend to be the flight computer's radio receiver on a virtual serial port (macOS/Linux).

Lets you test LIVE mode and the fc_uart_v1 decoder with no hardware:

    # terminal 1
    backend/.venv/bin/python -m ground_station.tools.fake_fc_uart
    #   -> prints something like /dev/ttys012

    # terminal 2
    backend/.venv/bin/python -m ground_station --mode LIVE --serial-format fc_uart_v1 --serial-port /dev/ttys012

The HUD banner will say LIVE because the ground station really is reading a serial
port — but the data is synthetic. Use this for bench testing only.
"""

from __future__ import annotations

import argparse
import os
import random
import struct
import time
import tty

from ..config import SimulationConfig
from ..schema import Phase
from ..sources.decoders import FC_UART_V1_FORMAT, FC_UART_V1_SIZE
from ..sources.simulation import G, SimFlight

M_TO_FT = 1 / 0.3048
PHASE_TO_FSM = {
    Phase.PAD: 1,  # ARMED
    Phase.BOOST: 3,  # BURNING
    Phase.COAST: 4,  # RISING
    Phase.DROGUE: 6,  # DROGUE_DESCENT
    Phase.MAIN: 7,  # MAIN_DESCENT
    Phase.LANDED: 8,  # LANDED
}


def i16(v: float) -> int:
    return max(-32768, min(32767, round(v)))


BOOT = time.monotonic()  # fake "flight computer power-on"


def build_packet(flight: SimFlight, fsm: int, rng: random.Random) -> bytes:
    s = flight.state
    proper_accel_g = (s.acc + G) / G if s.phase not in (Phase.PAD, Phase.LANDED) else 1.0
    return struct.pack(
        FC_UART_V1_FORMAT,
        0xAA,
        0xBB,
        FC_UART_V1_SIZE,
        int((time.monotonic() - BOOT) * 1000) & 0xFFFFFFFF,
        s.alt * M_TO_FT + rng.gauss(0, 1.5),
        i16(s.vel * M_TO_FT * 10),
        i16(rng.gauss(0, 0.02) * 1000),
        i16(rng.gauss(0, 0.02) * 1000),
        i16(proper_accel_g * 1000 + rng.gauss(0, 20)),
        i16(88 + rng.gauss(0, 1)),
        i16((s.t * 90) % 360 - 180),
        i16(rng.gauss(0, 2)),
        fsm,
        0x11,  # SD logging + armed (bit meanings per old test_UART.py)
        0x00,
    )


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--rate", type=float, default=10.0, help="packets per second")
    p.add_argument("--launch-after", type=float, default=10.0, help="seconds on the pad before liftoff")
    p.add_argument("--apogee-ft", type=float, default=10_000)
    p.add_argument("--speed", type=float, default=1.0, help="flight time multiplier")
    p.add_argument("--noise", type=float, default=0.0, help="probability of injecting garbage bytes per packet")
    p.add_argument("--corrupt", type=float, default=0.0, help="probability of corrupting a packet's altitude")
    p.add_argument("--seed", type=int, default=None)
    args = p.parse_args()

    master, slave = os.openpty()
    tty.setraw(slave)
    print(os.ttyname(slave), flush=True)
    print(f"fake flight computer: fc_uart_v1 at {args.rate} Hz, liftoff in {args.launch_after}s. Ctrl+C to stop.", flush=True)

    rng = random.Random(args.seed)
    flight = SimFlight(SimulationConfig(), args.apogee_ft)
    period = 1.0 / args.rate
    start = time.monotonic()
    apogee_at: float | None = None
    next_t = start
    try:
        while True:
            next_t += period
            time.sleep(max(0.0, next_t - time.monotonic()))
            if flight.state.phase == Phase.PAD and time.monotonic() - start >= args.launch_after:
                flight.launch()
            flight.step(period * args.speed)

            fsm = PHASE_TO_FSM.get(flight.state.phase, 0)
            if flight.state.phase == Phase.DROGUE:
                apogee_at = apogee_at if apogee_at is not None else flight.state.t
                if flight.state.t - apogee_at < 1.0:
                    fsm = 5  # APOGEE for ~1 s, like a real FSM would

            pkt = bytearray(build_packet(flight, fsm, rng))
            if rng.random() < args.corrupt:
                pkt[8:12] = struct.pack("<f", float("nan"))  # altitude field
            if rng.random() < args.noise:
                os.write(master, bytes(rng.randrange(256) for _ in range(rng.randint(1, 12))))
            os.write(master, bytes(pkt))
    except KeyboardInterrupt:
        pass
    finally:
        os.close(master)
        os.close(slave)


if __name__ == "__main__":
    main()
