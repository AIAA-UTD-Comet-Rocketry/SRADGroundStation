# Where things stand

Last updated: 2026-11-19. Update this when something moves.

## Done ✅

- Dashboard: 8 pages, light/dark theme, metric/imperial units, collapsible sidebar
- Simulator with launch, pause, speed, packet loss, corrupt packets and dropout testing
- LIVE mode: serial reader, `fc_uart_v1` binary decoder, JSON-lines bench format
- XBee API-mode support with RSSI
- Ground logging to CSV (crash-safe, non-fatal on disk errors) and REPLAY of past sessions
- Link health: received / missed / rejected packets, staleness
- Flight events from the rocket's state changes
- OpenRocket `.ork` view and predicted-flight overlay
- Video page (any USB capture device, live view only)
- Raspberry Pi launcher with kiosk mode
- CI on every pull request
- Team 1100 / Hestia / RANGER-1 info in the dashboard and splash (`[mission]` config)

## Blocked on avionics / hardware 🚧

| What | Waiting on |
|---|---|
| Confirm the L3 packet format | Avionics: is `fc_uart_v1` still right? Add sequence number, CRC, GPS? |
| Real radio test | Ground radio + antenna purchase (XBee SX 900 candidate), see hardware-inventory.md |
| Video | Choosing the VTX, VRX and capture device (1240–1300 MHz band) |
| GPS on the map in LIVE | The packet needs GPS fields |

## Next up 📋

- Turn on branch protection for `main` (steps in maintainers.md)
- Fix Chromium loading `localhost` on the Pi (workaround: use `127.0.0.1`)
- End-to-end bench test: flight computer → radio → Pi → dashboard, with Wi-Fi off
- Fill in the Pi model, OS and storage in hardware-inventory.md
- Set up GitHub teams for the ground station (maintainers.md)

## Ideas (not committed to) 💡

- Offline map tiles of the launch area
- Audio callouts for events (liftoff, apogee, main)
- Export a session to a one-page flight summary
