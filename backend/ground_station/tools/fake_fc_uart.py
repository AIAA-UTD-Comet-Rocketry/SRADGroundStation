"""Pretend to be the flight computer's radio receiver on a virtual serial port (macOS/Linux).

Lets you test LIVE mode and the fc_uart_v1 decoder with no hardware:

    # terminal 1
    backend/.venv/bin/python -m ground_station.tools.fake_fc_uart
    #   -> prints something like /dev/ttys012

    # terminal 2
    backend/.venv/bin/python -m ground_station --mode LIVE --serial-format fc_uart_v1 --serial-port /dev/ttys012

The HUD banner will say LIVE because the ground station really is reading a serial
port — but the data is synthetic. Use this for bench testing only.

Pretend to be a ground XBee in API mode (wraps each packet in a 0x90 frame and answers
the ground station's "DB" RSSI queries):

    ... -m ground_station.tools.fake_fc_uart --framing xbee_api
    ... -m ground_station --mode LIVE --serial-framing xbee_api --serial-port /dev/ttys012
"""

from __future__ import annotations

import argparse
import fcntl
import math
import os
import random
import struct
import time
import tty

from ..config import SimulationConfig
from ..schema import Phase
from ..sources.decoders import FC_UART_V1_FORMAT, FC_UART_V1_SIZE
from ..sources.simulation import G, SimFlight
from ..sources.xbee import AT_RESPONSE, RX_PACKET_64, XBeeFrameReader, build_frame

FAKE_ROCKET_ADDR = bytes.fromhex("0013A20041ABCDEF")
GROUND_OFFSET_M = 300.0

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


def send(fd: int, data: bytes) -> None:
    """Non-blocking write; if nobody is reading the port yet, drop it (like a radio would)."""
    try:
        os.write(fd, data)
    except BlockingIOError:
        pass


def answer_db_queries(master: int, reader: XBeeFrameReader, flight: SimFlight, rng: random.Random, escaped: bool) -> None:
    """Reply to local AT "DB" queries like a real ground XBee would (RSSI of last packet)."""
    try:
        incoming = os.read(master, 1024)
    except BlockingIOError:
        return
    s = flight.state
    slant = max(10.0, math.hypot(math.hypot(s.east + GROUND_OFFSET_M, s.north), s.alt))
    rssi = max(20, min(110, round(40 + 20 * math.log10(slant / 10.0) + rng.gauss(0, 1.5))))  # magnitude, -dBm
    for frame, _err in reader.feed(incoming):
        if frame and frame[0] == 0x08 and frame[2:4] == b"DB":
            send(master, build_frame(bytes([AT_RESPONSE, frame[1]]) + b"DB" + bytes([0, rssi]), escaped))


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--rate", type=float, default=10.0, help="packets per second")
    p.add_argument("--launch-after", type=float, default=10.0, help="seconds on the pad before liftoff")
    p.add_argument("--apogee-ft", type=float, default=10_000)
    p.add_argument("--speed", type=float, default=1.0, help="flight time multiplier")
    p.add_argument("--noise", type=float, default=0.0, help="probability of injecting garbage bytes per packet")
    p.add_argument("--corrupt", type=float, default=0.0, help="probability of corrupting a packet's altitude")
    p.add_argument("--seed", type=int, default=None)
    p.add_argument(
        "--framing",
        choices=["raw", "xbee_api", "xbee_api_escaped"],
        default="raw",
        help="raw = transparent radio; xbee_api = wrap packets as XBee API 0x90 frames and answer DB queries",
    )
    args = p.parse_args()

    master, slave = os.openpty()
    tty.setraw(slave)
    fcntl.fcntl(master, fcntl.F_SETFL, fcntl.fcntl(master, fcntl.F_GETFL) | os.O_NONBLOCK)
    xbee = args.framing != "raw"
    escaped = args.framing == "xbee_api_escaped"
    query_reader = XBeeFrameReader(escaped)
    print(os.ttyname(slave), flush=True)
    print(f"fake flight computer: fc_uart_v1 ({args.framing}) at {args.rate} Hz, liftoff in {args.launch_after}s. Ctrl+C to stop.", flush=True)

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
                send(master, bytes(rng.randrange(256) for _ in range(rng.randint(1, 12))))
            if xbee:
                frame = bytes([RX_PACKET_64]) + FAKE_ROCKET_ADDR + b"\xff\xfe" + b"\x01" + bytes(pkt)
                send(master, build_frame(frame, escaped))
                answer_db_queries(master, query_reader, flight, rng, escaped)
            else:
                send(master, bytes(pkt))
    except KeyboardInterrupt:
        pass
    finally:
        os.close(master)
        os.close(slave)


if __name__ == "__main__":
    main()
