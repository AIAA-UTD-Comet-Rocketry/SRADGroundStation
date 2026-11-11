# SRADGroundStation

Raspberry Pi-based ground control system for real-time rocket telemetry, GPS tracking,
flight visualization, and live video monitoring — UTD Comet Rocketry L3 SRAD.

**Status: M1 — simulation only.** The HUD, simulator, ground logging and replay work.
The real LoRa packet decoder and live video are **not implemented yet** (hardware TBD).
This is a monitoring display: it never transmits to the rocket, and it is not the
official altitude record (that's the COTS altimeter, IREC §2.5).

- Backend: Python (FastAPI + WebSocket) — `backend/`
- Frontend: React + TypeScript (Vite, uPlot charts) — `frontend/`
- Docs: [architecture](docs/architecture.md) · [telemetry schema](docs/telemetry-schema.md) · [hardware inventory](docs/hardware-inventory.md)

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
  sources/         simulation.py · serial_lora.py (skeleton) · replay.py
  hub.py           link stats, phase events, fan-out
  recorder.py      append-only CSV session logs
  server.py        FastAPI: /ws, /api/status, /api/mode, /api/sim, /api/sessions
frontend/src/      React HUD
config/            example config
scripts/run-pi.sh  Pi launcher
docs/              architecture, schema, hardware inventory
```
