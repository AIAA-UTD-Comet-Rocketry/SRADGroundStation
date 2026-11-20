# How the ground station works

## The one-sentence version

The rocket radios its data down, a Raspberry Pi on the ground saves it and shows it on a
screen.

## Our mission

IREC 2027, **Team 1100**, **10K Liquid** category. The rocket is **Hestia**, flown on our own
liquid engine **RANGER-1**: nitrous oxide (oxidizer) and isopropyl alcohol (fuel), fed by the
nitrous's own pressure. Aiming for 10,000 ft.

## The pieces

```
  ROCKET                          GROUND
  ┌──────────────┐   radio   ┌───────────┐  USB  ┌──────────────────────────────┐
  │ flight       │ ~~~~~~~~► │ ground    │ ────► │ Raspberry Pi                 │
  │ computer     │           │ radio     │       │  ┌─────────┐   ┌──────────┐  │
  │ (sensors,    │           │ + antenna │       │  │ backend │──►│ browser  │  │──► monitor
  │ GPS, state)  │           └───────────┘       │  │ (Python)│   │ dashboard│  │
  └──────────────┘                               │  └────┬────┘   └──────────┘  │
                                                 │       ▼                      │
                                                 │  saved to disk (CSV files)   │
                                                 └──────────────────────────────┘
```

1. **The flight computer** on the rocket reads its sensors and sends a small packet many times
   a second: altitude, speed, acceleration, angles, and its **state** (on the pad, boosting,
   coasting, descending...). The rocket decides its own state, not the ground.
2. **The ground radio** receives the packets and passes the bytes to the Pi over USB.
3. **The backend** (Python, in `backend/`) turns the bytes into readable numbers, **saves them
   to disk first**, then sends them to the screen.
4. **The dashboard** (React, in `frontend/`) is a web page that shows the numbers, charts, map
   and video. It runs in Chromium on the Pi. No internet needed.

## Three modes

The top banner always says which one you're in:

| Mode | Data comes from | Use it for |
|---|---|---|
| **SIMULATION** (striped amber) | A built-in fake flight | Practice, demos, development |
| **LIVE** (green) | The real ground radio | Launch day |
| **REPLAY** (blue) | A flight saved earlier | Reviewing what happened |

## Things it will never do

- **Talk to the rocket.** It only listens. No button sends commands up.
- **Make up data.** If a value hasn't arrived it says **NO DATA**; if it's old it says
  **STALE**. It never fills in zero.
- **Replace the official records.** The rocket's own SD card and the competition altimeter are
  the official data. The ground log is a backup of what the radio heard.

## The dashboard pages

Mission Dashboard (overview) · Telemetry (charts) · Map & Tracking · Video · Systems Health
(radio link, recording) · Mission Timeline (flight events) · Data & Logs (recordings, replay) ·
Configuration (theme, units, about).

Want more detail? See [architecture.md](../architecture.md).
