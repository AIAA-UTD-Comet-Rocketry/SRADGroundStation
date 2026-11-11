# Telemetry schema — v1 DRAFT

> **Not agreed with avionics yet.** This is the ground station's internal, normalized
> format. The over-the-air packet will likely be a compact binary struct that the
> decoder converts into this.

Source of truth: `backend/ground_station/schema.py` (mirrored in `frontend/src/types.ts`).

## FlightData (from the rocket)

| Field | Type | Unit | Notes |
|---|---|---|---|
| `schema_version` | int | — | must equal 1 |
| `sequence` | int ≥ 0 | — | increments every transmitted packet, used for loss detection |
| `flight_time_s` | float? | s | since liftoff (0 on pad) — clock source TBD |
| `phase` | enum | — | UNKNOWN, PAD, BOOST, COAST, DROGUE, MAIN, LANDED — decided **onboard** |
| `altitude_agl_m` | float? | m | **barometric**, above pad |
| `vertical_velocity_mps` | float? | m/s | + up. Onboard estimate (method TBD) |
| `acceleration_mps2` | float? | m/s² | vertical; axis/frame TBD |
| `latitude_deg` / `longitude_deg` | float? | deg | WGS-84 |
| `gps_fix` | bool? | — | |
| `gps_altitude_msl_m` | float? | m | **GPS**, above mean sea level — not the same as AGL |
| `pressure_pa` | float? | Pa | |
| `temperature_c` | float? | °C | |

`?` = may be null ("no data"), never substituted with 0.

## Ground metadata (added by the ground station)

`mode`, `source`, `received_at_utc` (Pi clock), `rssi_dbm`, `snr_db` (from the ground radio, if it reports them).

## Bench format (`serial.format = "jsonl"`)

One JSON object per line over serial, using the field names above, optionally with
`rssi_dbm` / `snr_db`:

```json
{"sequence": 42, "flight_time_s": 4.2, "phase": "BOOST", "altitude_agl_m": 512.3, "rssi_dbm": -71}
```

## Open questions for avionics

- Packet rate? Binary layout and CRC type?
- Which sensor produces `altitude_agl_m` — and is it the same sensor as the official altimeter (IREC §2.5)?
- How is `phase` decided onboard, and is `flight_time_s` from liftoff detection or power-on?
- Accelerometer axis and whether gravity is removed.
