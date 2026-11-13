#!/usr/bin/env bash
# Start the ground station on the Raspberry Pi.
#
#   scripts/run-pi.sh            # backend only, open http://localhost:8000 yourself
#   scripts/run-pi.sh --kiosk    # also open Chromium fullscreen on the Pi's monitor
#   scripts/run-pi.sh --host 0.0.0.0   # let laptops on the same network open http://<pi>:8000
#
# First run creates backend/.venv and installs Python deps (needs internet once).
# The UI must already be built into frontend/dist (build on a laptop and copy it,
# or run `npm ci && npm run build` in frontend/ if Node is installed on the Pi).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -x backend/.venv/bin/python ]]; then
  echo "[setup] creating backend/.venv"
  python3 -m venv backend/.venv
  backend/.venv/bin/pip install --upgrade pip
  backend/.venv/bin/pip install -e backend
fi

EXISTING="$(pgrep -f '[.]venv/bin/python -m ground_station' || true)"
if [[ -n "$EXISTING" ]]; then
  echo "[error] The ground station is already running (PID $EXISTING), so port 8000 is taken."
  echo "        Open http://localhost:8000, or stop it first with:  kill $EXISTING"
  exit 1
fi

if [[ ! -f frontend/dist/index.html ]]; then
  echo "[warn] frontend/dist not found — the backend will run but the HUD page won't load."
fi

KIOSK=0
if [[ "${1:-}" == "--kiosk" ]]; then
  KIOSK=1
  shift
fi
# Anything else is passed to the backend, e.g. --host 0.0.0.0 to view from a laptop.

if [[ "$KIOSK" == 1 ]]; then
  (
    for _ in $(seq 1 30); do
      curl -fs http://127.0.0.1:8000/api/status >/dev/null 2>&1 && break
      sleep 1
    done
    BROWSER="$(command -v chromium-browser || command -v chromium || true)"
    if [[ -n "$BROWSER" ]]; then
      "$BROWSER" --kiosk --noerrdialogs --disable-infobars --incognito http://127.0.0.1:8000 >/dev/null 2>&1 &
    else
      echo "[warn] Chromium not found; open http://127.0.0.1:8000 manually."
    fi
  ) &
fi

exec backend/.venv/bin/python -m ground_station "$@"
