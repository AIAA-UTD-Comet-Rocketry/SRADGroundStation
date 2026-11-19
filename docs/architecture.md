# Architecture

Simulation, logging, replay, the HUD and LIVE decoding of `fc_uart_v1` work; the real radio
hasn't been tested end to end yet and video is live-view only. See [roadmap.md](roadmap.md) and
[hardware-inventory.md](hardware-inventory.md). Plain-English version: [guide/how-it-works.md](guide/how-it-works.md).

```
                   ┌──────────────────────────── backend (Python) ───────────────────────────┐
SimulationSource ─┐│                                                                          │
SerialLoRaSource ─┼┼─► TelemetrySource.events() ─► TelemetryHub ─┬─► SessionRecorder (CSV)   │
ReplaySource ─────┘│   (FlightData + RSSI/SNR)     link stats,     └─► WebSocket /ws ──────────┼──► React HUD
                   │                               phase events,                              │    (Chromium)
                   │                               history buffer    REST /api/*  ◄───────────┼─── mode / sim controls
                   └──────────────────────────────────────────────────────────────────────────┘
```

## Key rules

- **One source at a time.** Switching SIMULATION / LIVE / REPLAY clears the in-memory
  history and starts a new recording session. Modes are never mixed on screen or in a log.
- **Same schema for every source.** `FlightData` in `backend/ground_station/schema.py`.
  The UI only ever sees `TelemetryFrame` (FlightData + ground metadata), so swapping the
  simulator for the real radio needs no UI change.
- **`None` ≠ 0.** Missing fields are `null` in JSON and empty in CSV; the UI shows "NO DATA".
- **Events come from the packet's `phase` field.** The hub names transitions
  (PAD→BOOST = "Liftoff"); it never infers apogee or deployments itself.
- **Monitoring only.** No endpoint transmits anything to the rocket. The only controls
  switch the ground data source or drive the simulator.
- **Ground log ≠ flight log.** `data/sessions/*` is what the ground radio received. The onboard
  SD log and the official COTS altimeter log are separate and authoritative.

## Link health

| Metric | Meaning |
|---|---|
| `received` | packets that decoded and validated |
| `missed` | gaps in `sequence` (rocket increments it for every packet it sends) |
| `rejected` | arrived but failed decode/validation (bad JSON, out-of-range, future: CRC) |
| `sequence_resets` | sequence went backwards (flight computer reboot / duplicate) |
| `last_packet_age_s` | seconds since the last good packet; > `stale_after_s` ⇒ **STALE** |

## Adding the real radio

1. Define the flight packet (binary layout, CRC, rate) with avionics → `docs/telemetry-schema.md`.
2. Write a `StreamDecoder` subclass in `sources/decoders.py` whose `feed(bytes)` returns
   `SourcePacket`s / `RejectedPacket`s, and add it to `DECODERS`.
3. If the receiver isn't line-oriented (e.g. length-prefixed binary, or SPI on the Pi's GPIO),
   add a new `TelemetrySource` subclass instead. The hub and UI don't change.
4. Add fixture packets under `backend/tests/` and a decoder test.

## Video (live view only)

A separate path from telemetry: VTX → VRX → capture device → Pi (IREC student video band,
1240–1300 MHz; the frequency is set on the VTX/VRX, not in this software). The VTX, VRX and
capture hardware are still TBD; see the handoff's M4 bench-test plan.

The dashboard's **Video** page (`frontend/src/v3/VideoView.tsx`) shows any capture device the
browser sees as a camera (a USB UVC capture device does), picked from a list and remembered per
browser. It runs entirely in the browser: the backend never touches video and nothing is
recorded. Browsers only allow capture on a secure page, so open it at `http://localhost:8000` on
the machine the capture device is plugged into. Until a device is connected it shows "NO VIDEO
SOURCE".
