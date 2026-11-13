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
| `fc_time_s` | float? | s | flight computer clock (e.g. since power-on) — **not** time since liftoff |
| `fc_state` | str? | — | raw FC state name before mapping to `phase` |
| `accel_x/y/z_mps2` | float? | m/s² | body frame, as reported; axes and gravity handling TBC |
| `pitch/roll/yaw_deg` | float? | deg | angle vs. rate TBC |
| `status_flags`, `pyro_status` | int? | — | raw bitfields |

`sequence` may be null when the over-the-air format has no packet counter; packet loss
is then shown as "n/a" and only staleness is tracked.

`?` = may be null ("no data"), never substituted with 0.

## Ground metadata (added by the ground station)

`mode`, `source`, `received_at_utc` (Pi clock), `rssi_dbm`, `snr_db` (from the ground radio, if it reports them).

## Flight-computer UART packet (`serial.format = "fc_uart_v1"`, default)

Source: the club's `python-ground-station` repo, `uart_to_can.py`, commit 016b29d
(2026-06-14). **Not confirmed for the L3 flight computer** — verify with avionics.

29 bytes, little-endian, struct `<BBHIfhhhhhhhBBB`:

| Offset | Type | Field | Decoded as |
|---|---|---|---|
| 0 | u8 ×2 | sync `0xAA 0xBB` | — |
| 2 | u16 | size | ignored (meaning unconfirmed) |
| 4 | u32 | time, ms | `fc_time_s` |
| 8 | f32 | altitude, ft | `altitude_agl_m` (assumed zeroed at pad) |
| 12 | i16 | vertical velocity, ft/s ×10 | `vertical_velocity_mps` |
| 14 | i16 ×3 | accel x/y/z, g ×1000 | `accel_*_mps2` |
| 20 | i16 ×3 | pitch/roll/yaw, deg | `*_deg` |
| 26 | u8 | FSM state | `fc_state` → `phase` |
| 27 | u8 | status flags | `status_flags` (bit0 SD logging, bit4 armed — from old test script) |
| 28 | u8 | pyro status | `pyro_status` |

FSM → phase: IDLE/ARMED/DISARM → PAD, BURNING → BOOST, RISING → COAST, APOGEE → APOGEE,
DROGUE_DESCENT → DROGUE, MAIN_DESCENT → MAIN, LANDED → LANDED, anything else → UNKNOWN.

**No CRC and no packet counter.** The decoder re-syncs on `0xAA 0xBB` and rejects
non-finite or > 200,000 ft altitudes, but other corruption can pass. Asking avionics
to add a sequence number and a CRC-16 would let the ground station detect loss and
corruption properly. There is also no GPS in this packet.

Test without hardware: `python -m ground_station.tools.fake_fc_uart` creates a virtual
serial port and streams these packets (see the module docstring).

## Serial framing (`serial.framing`)

How packets are wrapped on the serial line, independent of the packet format above:

| framing | Use when | Notes |
|---|---|---|
| `raw` (default) | radio in transparent mode | serial bytes = flight computer bytes; no RSSI |
| `xbee_api` | Digi XBee ground module, `AP=1` | unwraps 0x90 / 0x80 / 0x81 receive frames, checks the frame checksum |
| `xbee_api_escaped` | Digi XBee ground module, `AP=2` | same, with 0x7D escaping |

With XBee framing the ground station asks the ground module for the last packet's RSSI
every `xbee_rssi_interval_s` using the local `DB` AT command. Local AT commands are
answered by the module itself and are not transmitted; the code refuses to build any
command other than read-only queries. Only the **ground** XBee needs API mode — the rocket
side can stay transparent, and the decoder copes with a flight packet split across frames.

Test: `python -m ground_station.tools.fake_fc_uart --framing xbee_api` then run the ground
station with `--serial-framing xbee_api`.

## Bench format (`serial.format = "jsonl"`)

One JSON object per line over serial, using the field names above, optionally with
`rssi_dbm` / `snr_db`:

```json
{"sequence": 42, "flight_time_s": 4.2, "phase": "BOOST", "altitude_agl_m": 512.3, "rssi_dbm": -71}
```

## Open questions for avionics

- Is `fc_uart_v1` still the L3 format? Can we add a sequence counter + CRC + GPS?
- Is the altitude field AGL (zeroed at the pad) or pressure altitude MSL?
- What does the `size` field count?
- Body axes: which accel axis is along the rocket, and is gravity included?
- Are pitch/roll/yaw angles or rates?
- Packet rate over the radio?
- Which sensor produces the altitude — and is it the same sensor as the official altimeter (IREC §2.5)?
- How is the FSM state decided onboard? Can the packet carry time since liftoff?
