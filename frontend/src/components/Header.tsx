import { useEffect, useState } from "react";
import type { RocketModel } from "../rocket";
import type { SocketState } from "../useTelemetry";
import type { Status, TelemetryFrame } from "../types";
import { fmt, fmtTime } from "../format";

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 250);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function Clock({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="clock">
      <div className="clock-label">{label}</div>
      <div className={`clock-value mono ${accent ? "accent" : ""}`}>{value}</div>
    </div>
  );
}

export function Header({
  rocket,
  status,
  socket,
  latest,
}: {
  rocket: RocketModel | null;
  status: Status | null;
  socket: SocketState;
  latest: TelemetryFrame | null;
}) {
  const now = useClock();
  const mode = socket !== "OPEN" ? "OFFLINE" : (status?.mode ?? "—");
  const d = latest?.data;
  const missionClock =
    d?.flight_time_s != null
      ? { label: "MISSION", value: fmtTime(d.flight_time_s) }
      : d?.fc_time_s != null
        ? { label: "FC CLOCK", value: `${fmt(d.fc_time_s, 1)} s` }
        : { label: "MISSION", value: "T+--:--.-" };

  return (
    <header className="hdr">
      <div className="hdr-brand">
        <img src="/comet-logo.png" alt="Comet Rocketry logo" className="hdr-logo" />
        <div>
          <div className="hdr-title">COMET ROCKETRY</div>
          <div className="hdr-sub">AIAA UTD · SRAD Ground Station</div>
        </div>
      </div>
      <div className="hdr-vehicle">
        <div className="hdr-vehicle-name">{rocket?.name ?? "No rocket file loaded"}</div>
        <div className="hdr-sub">
          {rocket
            ? `${fmt(rocket.length_m, 2)} m · Ø ${fmt(rocket.diameter_m * 1000)} mm${rocket.motor ? ` · ${rocket.motor} (OpenRocket)` : ""}`
            : "set [rocket].ork_file in config"}
        </div>
      </div>
      <div className="hdr-clocks">
        <Clock label="LOCAL" value={now.toLocaleTimeString([], { hour12: false })} />
        <Clock label="UTC" value={now.toISOString().slice(11, 19)} />
        <Clock label={missionClock.label} value={missionClock.value} accent />
        <div className={`mode-pill mode-${mode.toLowerCase()}`}>{mode}</div>
      </div>
    </header>
  );
}
