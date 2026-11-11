# Architecture

Status: **M1 (software-only)**. Simulation, logging, replay, and the HUD work. Real LoRa
decoding and video are not implemented — see [hardware-inventory.md](hardware-inventory.md).

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
2. Write `decode_<name>(line_or_frame: bytes) -> SourcePacket` in `sources/serial_lora.py`,
   raising `PacketError` on any failure, and add it to `DECODERS`.
3. If the receiver isn't line-oriented (e.g. length-prefixed binary, or SPI on the Pi's GPIO),
   add a new `TelemetrySource` subclass instead. The hub and UI don't change.
4. Add fixture packets under `backend/tests/` and a decoder test.

## Video (not started)

Planned as a separate path from telemetry: VRX → capture device → Pi. Until the hardware is
known the HUD shows "NO VIDEO SOURCE". See the handoff's M4 bench-test plan.
