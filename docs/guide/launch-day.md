# Launch day checklist

The launch site may have **no internet**. Everything below marked 🌐 must be done before you
leave.

## The week before (with internet) 🌐

- [ ] On the Pi: `cd ~/SRADGroundStation && git switch main && git pull`
- [ ] Build the dashboard: `cd frontend && npm ci && npm run build`
      (or build on a laptop and copy `frontend/dist` to the Pi)
- [ ] Run `scripts/run-pi.sh` once so it installs everything it needs
- [ ] Copy `config/ground_station.example.toml` to `config/ground_station.toml` and set:
      `default_mode = "LIVE"`, the radio's `port`, `baud`, `format` and `framing`
- [ ] Dress rehearsal **with Wi-Fi off**: start it, check every page loads
- [ ] Test the real radio link with the flight computer on the bench, and check the numbers
      look right
- [ ] Plug in the video capture device and check the Video page shows it
- [ ] Check the Pi has plenty of free disk space for recordings

## At the site

- [ ] Power the Pi, radio and monitor. Connect the antenna before powering the radio.
- [ ] Start it: `scripts/run-pi.sh --kiosk`
      (if the page doesn't load, open **http://127.0.0.1:8000** in Chromium)
- [ ] Banner says **LIVE** (green), not SIMULATION
- [ ] Systems Health: packets arriving, link not STALE, **recording OK** (not "RECORDING FAILED")
- [ ] Rocket on the pad shows state **PAD** and sensible altitude near 0

## During the flight

- Watch the banner and Systems Health. **STALE** = no packets for a couple of seconds; usually
  the link recovers.
- Everything is being saved automatically. Don't switch modes during the flight: switching
  starts a new recording.

## After

- [ ] Leave it running until the rocket is recovered (the Map page shows its last GPS position, once the packet carries GPS: `fc_uart_v1` has none yet)
- [ ] Copy `data/sessions/` to a USB stick or laptop (each run is a folder named by UTC time)
- [ ] Use **REPLAY** on the Data & Logs page to review the flight
- [ ] Remember: the official data is the rocket's SD card and the competition altimeter, not
      this log

## If something goes wrong

| Symptom | Try |
|---|---|
| Page won't load | Use `http://127.0.0.1:8000`; check the terminal shows the server running |
| "already running" error | Another copy is open. `pkill -f ground_station`, then start again |
| LIVE but no packets | Radio USB plugged in? Right `port` in config? Flight computer on? |
| RECORDING FAILED | Disk full or SD card problem. Data still shows on screen; fix after the flight |
| Banner says SIMULATION | Set `default_mode = "LIVE"` in config, or switch modes on Data & Logs |
