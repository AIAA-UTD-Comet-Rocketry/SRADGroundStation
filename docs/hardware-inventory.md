# Hardware inventory

Fill in as parts are confirmed. "TBD" items block the milestone listed.

| Item | Model / details | Interface to Pi | Status | Blocks |
|---|---|---|---|---|
| Ground computer | Raspberry Pi, 8 GB RAM (model TBD) | — | have | — |
| Pi OS | TBD (Raspberry Pi OS Bookworm?) | — | set up | — |
| Pi storage | microSD (size TBD); SSD? | — | have | M2 |
| Monitor | resolution TBD | HDMI | ? | — |
| Rocket radio | TBD — must match ground (XBee SX if selected) | — | TBD | M3 |
| Ground radio receiver | **Candidate: Digi XBee SX 900** (e.g. enclosed modem XM-X9-3P-U — interface to confirm). Alt: XBee-PRO 900HP. Research 2026-10-22. | USB serial expected; run in API mode (`framing = xbee_api`) | not purchased | M3 |
| Ground antenna | Yagi (model TBD), 900 MHz | — | ? | M3 |
| Camera | "RunCam V2" — exact SKU and output TBD | — | TBD | M4 |
| Video TX (VTX) | TBD, 1240–1300 MHz student video band | — | TBD | M4 |
| Video RX (VRX) | TBD | HDMI / composite / USB? | TBD | M4 |
| Capture device | TBD (USB UVC capture?) | USB → /dev/video* | TBD | M4 |
| Official altimeter | COTS, TBD | — (not connected to ground station) | TBD | — |

RF: XBee SX/900HP hop across 902–928 MHz by default; confining them to the IREC SRAD band
(902–909 MHz) via the channel mask must be checked against Digi's minimum-channel rules,
FCC Part 15 and the IREC 33 cm mode rules (check the 2027 band plan). Frequencies come from the team's IREC assignment (Band Plan Rev D: SRAD 33 cm
902.0–909.0 MHz; video 1240–1300 MHz with callsign). Nothing in the software hardcodes a frequency.
