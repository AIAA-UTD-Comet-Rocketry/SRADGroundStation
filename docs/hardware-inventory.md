# Hardware inventory

Fill in as parts are confirmed. "TBD" items block the milestone listed.

| Item | Model / details | Interface to Pi | Status | Blocks |
|---|---|---|---|---|
| Ground computer | Raspberry Pi, 8 GB RAM (model TBD) | — | have | — |
| Pi OS | TBD (Raspberry Pi OS Bookworm?) | — | set up | — |
| Pi storage | microSD (size TBD); SSD? | — | have | M2 |
| Monitor | resolution TBD | HDMI | ? | — |
| Rocket LoRa radio | TBD | — | TBD | M3 |
| Ground LoRa receiver | TBD | USB serial / UART / SPI TBD | TBD | M3 |
| Ground antenna | Yagi (model TBD), 900 MHz | — | ? | M3 |
| Camera | "RunCam V2" — exact SKU and output TBD | — | TBD | M4 |
| Video TX (VTX) | TBD, 1240–1300 MHz student video band | — | TBD | M4 |
| Video RX (VRX) | TBD | HDMI / composite / USB? | TBD | M4 |
| Capture device | TBD (USB UVC capture?) | USB → /dev/video* | TBD | M4 |
| Official altimeter | COTS, TBD | — (not connected to ground station) | TBD | — |

RF: frequencies come from the team's IREC assignment (Band Plan Rev D: SRAD 33 cm
902.0–909.0 MHz; video 1240–1300 MHz with callsign). Nothing in the software hardcodes a frequency.
