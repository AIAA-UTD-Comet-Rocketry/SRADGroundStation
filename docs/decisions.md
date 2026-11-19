# Decisions: why it's built this way

Short entries, newest at the bottom. Add one whenever you decide something a future maintainer
would ask "why?" about. Format: what we decided, why, and what we gave up.

---

**Monitoring only, no uplink** (2026-11)
The ground station never transmits to the rocket. Why: a ground bug or a mis-click must not be
able to affect a flight, and it keeps the RF and safety story simple. Gave up: arming or
commanding from the ground (that stays on the rocket's own hardware).

**Python backend + browser dashboard** (2026-11)
FastAPI on the Pi, React UI in Chromium. Why: Python is what most club members know and is
good at serial/byte parsing; a browser UI is easy to make look good, and other laptops can view
it over the network. Gave up: a single native app (more pieces to start).

**One normalized schema for every source** (2026-11)
Simulation, live radio and replay all produce the same `FlightData`. Why: the UI and recorder
never care where data came from, and swapping the simulator for the real radio needs no UI
change. Gave up: source-specific fields need a schema change.

**The rocket decides its flight phase** (2026-11)
The phase comes from the flight computer's FSM state byte; the ground only names
transitions. Why: the flight computer has all the sensors at full rate; the ground sees a
lossy radio stream and would guess wrong. Gave up: a ground-side backup detector.

**Record before display; recording failures are non-fatal** (2026-11)
Each packet is written to CSV (fsync every second) before it is sent to the screen. If the
disk fails, the UI shows RECORDING FAILED and keeps displaying. Why: the log is the backup if
the screen or browser dies, but losing the display because of an SD card error mid-flight would
be worse. Gave up: nothing significant.

**CSV for ground logs** (2026-11)
Plain CSV per session (`telemetry.csv`, `events.csv`, `rejected.csv`). Why: opens in Excel,
Python or anything else with no tools, survives a crash (append-only), easy to diff. Gave up:
compactness and query speed of a database.

**`null` is never `0`** (2026-11)
Missing values stay empty and show NO DATA. Why: a zero altitude or velocity that was really
"no data" is dangerous to misread at a launch.

**`fc_uart_v1` as the default packet** (2026-11)
Taken from the club's older python-ground-station repo. Not yet confirmed for the L3 flight
computer; it has no CRC, no sequence counter and no GPS (see open questions in
telemetry-schema.md). Why: it's the best known format today, and decoders are pluggable.

**XBee API mode on the ground radio** (2026-11)
Supported alongside transparent mode. Why: API mode gives per-packet RSSI and checksums. Only
read-only local AT queries are allowed (keeps rule 1).

**Fully offline at runtime** (2026-11)
No CDNs, web fonts or map tiles; the world map is a hand-drawn land mask. Why: IREC launch
sites may have no internet. Gave up: real map tiles (could be added later as pre-downloaded
offline tiles).

**Video is browser-only and not recorded** (2026-11)
The Video page reads a USB (UVC) capture device with `getUserMedia`. Why: zero backend work and
low latency; recording video would compete with telemetry for disk and CPU. Gave up: a saved
video file (record on the VRX or a separate recorder if needed). Needs a secure context, so it
works at `localhost` on the Pi only.

**GitHub Flow with CI** (2026-11)
Branch per change, pull request, tests on Python 3.11 and 3.13 plus the frontend build, merge
when green. Why: `main` is what goes to the launch, so it must always work. See maintainers.md.

**Docs in the repo, including AGENTS.md for AI tools** (2026-11)
Plain-English guides in `docs/guide/` for people, and `AGENTS.md` (imported by `CLAUDE.md`) for
AI coding agents. Why: students graduate and most work is done with AI agents; knowledge that
only lives in someone's chat history is lost at handoff.

**Decorative ASCII art** (2026-11)
A spinning ASCII rocket from the `.ork` file: terminal splash, About-page logo scene, sidebar.
Why: club identity and morale. Kept off the flight screens, paused when hidden, and it respects
reduced-motion. Temoc art is used with UTD's permission; source images are not committed.
