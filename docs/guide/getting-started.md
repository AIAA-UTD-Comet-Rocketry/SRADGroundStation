# Getting started on your laptop

About 10 minutes. You need **Python 3.11+**, **Node 18+** and **git**. Mac, Linux or Windows
(WSL) all work.

## 1. Get the code

```bash
git clone https://github.com/AIAA-UTD-Comet-Rocketry/SRADGroundStation.git
cd SRADGroundStation
```

## 2. Start the backend

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
.venv/bin/python -m ground_station
```

Leave this terminal running. It starts in **SIMULATION** mode.

## 3. Start the dashboard

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. Press **Sim launch** and watch a fake flight.

## 4. Check the tests pass

```bash
cd backend
.venv/bin/python -m pytest -q
```

## Optional: try LIVE mode without a radio

A fake flight computer pretends to be the radio:

```bash
# terminal A
cd backend && .venv/bin/python -m ground_station.tools.fake_fc_uart     # prints a port like /dev/ttys003

# terminal B (stop the backend from step 2 first)
cd backend && .venv/bin/python -m ground_station --mode LIVE --serial-port /dev/ttys003
```

## Something wrong?

| Problem | Fix |
|---|---|
| Banner says **BACKEND DISCONNECTED** | The backend (step 2) isn't running |
| `port 8000 already in use` | Another copy is running. Close it, or restart your terminal |
| Page is blank on port 8000 | Use 5173 during development. Port 8000 only serves the UI after `npm run build` |
| `python3: command not found` | Install Python 3.11 or newer |

Next: [Working on it](working-with-ai.md).
