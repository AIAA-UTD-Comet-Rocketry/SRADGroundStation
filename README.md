# SRADGroundStation

[![CI](https://github.com/AIAA-UTD-Comet-Rocketry/SRADGroundStation/actions/workflows/ci.yml/badge.svg)](https://github.com/AIAA-UTD-Comet-Rocketry/SRADGroundStation/actions/workflows/ci.yml)

Raspberry Pi-based ground control system for real-time rocket telemetry, GPS tracking,
flight visualization, and live video monitoring — UTD Comet Rocketry L3 SRAD.

**Status: M1.** The HUD, simulator, ground logging and replay work. LIVE mode decodes
the flight computer's binary UART packet (`fc_uart_v1`, taken from the club's
python-ground-station repo — not yet confirmed for L3). Live video is **not implemented yet**.
This is a monitoring display: it never transmits to the rocket, and it is not the
official altitude record (that's the COTS altimeter, IREC §2.5).

- Backend: Python (FastAPI + WebSocket) — `backend/`
- Frontend: React + TypeScript (Vite, uPlot charts) — `frontend/`
- Docs: [architecture](docs/architecture.md) · [telemetry schema](docs/telemetry-schema.md) · [hardware inventory](docs/hardware-inventory.md) · [maintainers & handoff](docs/maintainers.md)

## Quick start (laptop, for development)

Needs Python ≥ 3.11 and Node ≥ 18.

```bash
# backend
cd backend
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
.venv/bin/python -m pytest          # run tests
.venv/bin/python -m ground_station  # http://127.0.0.1:8000

# frontend, in a second terminal (hot reload on http://localhost:5173)
cd frontend
npm install
npm run dev
```

## Running on the Raspberry Pi

The Pi only needs Python. Build the UI on a laptop and copy it over:

```bash
cd frontend && npm install && npm run build     # creates frontend/dist
```

Copy the repo to the Pi (excluding `node_modules`, `.venv`, `data`), then on the Pi:

```bash
cd ~/SRADGroundStation
scripts/run-pi.sh --kiosk     # first run installs Python deps (needs internet once)
```

`--kiosk` opens Chromium fullscreen on the Pi's monitor. To view from other laptops
on the same network, set `host = "0.0.0.0"` in `config/ground_station.toml`.

## Testing LIVE mode without hardware

```bash
# terminal 1: fake flight computer on a virtual serial port (prints e.g. /dev/ttys003)
cd backend && .venv/bin/python -m ground_station.tools.fake_fc_uart

# terminal 2: ground station reading that port
cd backend && .venv/bin/python -m ground_station --mode LIVE --serial-port /dev/ttys003
```

Add `--framing xbee_api` to the fake and `--serial-framing xbee_api` to the ground station
to test a Digi XBee receiver in API mode (including RSSI).

## Just for fun: ASCII rocket

A spinning ASCII-art version of the rocket, generated from the OpenRocket file:

```bash
backend/.venv/bin/python -m ground_station.tools.ascii_rocket          # Ctrl+C to stop
backend/.venv/bin/python -m ground_station.tools.ascii_rocket --once   # single frame
```

In the dashboard, Configuration → About shows the Comet Rocketry logo as a live ASCII scene: the
globe spins while our rocket (shape from the `.ork`) orbits it with a flame and a fading trail,
Temoc riding on top. It is decorative only, runs only while that page is open, and never appears
on the flight-data screens. The globe uses a coarse hand-drawn land map (`frontend/src/v3/worldMap.ts`).
`scripts/run-pi.sh` plays the terminal version for 4 s at startup (skip with `GS_NO_SPLASH=1`).

Temoc and the Comet Rocketry logo are pre-converted to colour ASCII by
`scripts/make_ascii_art.py` (needs Pillow, only when regenerating). The Temoc source image is
UT Dallas artwork and is not stored in this repo; only the generated text is.
Idea from [alishsharma17/Ascii-Flower-Bouquet-](https://github.com/alishsharma17/Ascii-Flower-Bouquet-).

## Continuous integration

Every pull request and every push to `main` runs [GitHub Actions](.github/workflows/ci.yml):
backend tests on Python 3.11 and 3.13 (the Pi's version), and the frontend type-check +
build. The built UI is attached to each run as the `frontend-dist` artifact. Please wait for
the checks to go green before merging.

## Configuration

`cp config/ground_station.example.toml config/ground_station.toml` and edit. The local
file is git-ignored. Recorded sessions go to `data/sessions/<UTC time>_<mode>/`.

## Using the HUD

- The top banner always shows the mode: **SIMULATION** (striped amber), **LIVE** (green),
  **REPLAY** (blue), or **BACKEND DISCONNECTED** (red).
- Values show **NO DATA** when a field has never been received and **STALE** when the last
  packet is older than `stale_after_s`.
- Simulator: *Sim launch*, pause/reset, 1–10× speed, 10k/30k/45k ft apogee, packet loss,
  corrupt packets, and a 5 s dropout to test link-loss handling.
- Replay: pick a recorded session and press **REPLAY**.

## Layout

```
backend/ground_station/
  schema.py        normalized telemetry model (DRAFT v1)
  sources/         simulation.py · serial_lora.py · decoders.py · xbee.py · replay.py
  tools/           fake_fc_uart.py (virtual serial port for bench tests)
  hub.py           link stats, phase events, fan-out
  recorder.py      append-only CSV session logs
  server.py        FastAPI: /ws, /api/status, /api/mode, /api/sim, /api/sessions
frontend/src/      React HUD
config/            example config
scripts/run-pi.sh  Pi launcher
docs/              architecture, schema, hardware inventory, maintainers & handoff
```
