import { useEffect, useState, type ReactNode } from "react";
import type { SocketState } from "../useTelemetry";
import type { Status } from "../types";
import { teamLine, type MissionInfo, type RocketModel } from "../rocket";
import type { Theme, Units } from "../prefs";
import { fmt } from "../format";
import { Icon, SignalBars } from "./icons";
import { SidebarRocket } from "./SidebarRocket";

export type View = "dashboard" | "telemetry" | "map" | "video" | "systems" | "mission" | "logs" | "settings";

export const VIEWS: { id: View; label: string; icon: () => ReactNode }[] = [
  { id: "dashboard", label: "Mission Dashboard", icon: () => Icon.home() },
  { id: "telemetry", label: "Telemetry", icon: () => Icon.pulse() },
  { id: "map", label: "Map & Tracking", icon: () => Icon.pin() },
  { id: "video", label: "Video", icon: () => Icon.video() },
  { id: "systems", label: "Systems Health", icon: () => Icon.shield() },
  { id: "mission", label: "Mission Timeline", icon: () => Icon.list() },
  { id: "logs", label: "Data & Logs", icon: () => Icon.db() },
  { id: "settings", label: "Configuration", icon: () => Icon.gear() },
];

export const APP_VERSION = "v0.3";

export function Sidebar({
  view,
  onView,
  socket,
  collapsed,
  onToggle,
  rocket,
}: {
  rocket: RocketModel | null;
  view: View;
  onView: (v: View) => void;
  socket: SocketState;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const online = socket === "OPEN";
  const statusText = online ? "Ground Station Online" : "Backend Offline";
  return (
    <nav className={`side ${collapsed ? "collapsed" : ""}`}>
      <div className="side-brand">
        <img src="/comet-logo.png" alt="" className="side-logo" />
        <div className="side-brand-text">
          <div className="side-name">COMET ROCKETRY</div>
          <div className="side-org">AIAA UT DALLAS</div>
        </div>
      </div>
      <button
        className="side-toggle"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? Icon.expand() : Icon.collapse()}
        <span>Collapse</span>
      </button>
      <ul className="side-nav">
        {VIEWS.map((v) => (
          <li key={v.id}>
            <button
              className={`side-item ${view === v.id ? "active" : ""}`}
              onClick={() => onView(v.id)}
              aria-current={view === v.id ? "page" : undefined}
              aria-label={collapsed ? v.label : undefined}
              title={collapsed ? v.label : undefined}
            >
              {v.icon()}
              <span>{v.label}</span>
            </button>
          </li>
        ))}
      </ul>
      {rocket ? <SidebarRocket rocket={rocket} collapsed={collapsed} /> : <div className="side-art" />}
      <div className="side-foot">
        <div className={`side-status ${online ? "ok" : "bad"}`} title={collapsed ? statusText : undefined}>
          <span className="dot" /> <span className="side-status-text">{statusText}</span>
        </div>
        <div className="side-ver">UTD SRAD Ground Station · {APP_VERSION}</div>
      </div>
    </nav>
  );
}

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 500);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function rssiBars(rssi: number | null | undefined) {
  if (rssi == null) return 0;
  if (rssi > -70) return 4;
  if (rssi > -85) return 3;
  if (rssi > -100) return 2;
  return 1;
}

export function TopBar({
  title,
  rocket,
  mission,
  status,
  socket,
  packetRate,
  theme,
  setTheme,
  units,
  setUnits,
}: {
  title: string;
  rocket: RocketModel | null;
  mission: MissionInfo | null;
  status: Status | null;
  socket: SocketState;
  packetRate: number | null;
  theme: Theme;
  setTheme: (t: Theme) => void;
  units: Units;
  setUnits: (u: Units) => void;
}) {
  const now = useNow();
  const mode = socket !== "OPEN" ? "OFFLINE" : (status?.mode ?? "—");
  const link = status?.link;
  const linkState = socket !== "OPEN" ? "bad" : !link || link.state === "NO_DATA" ? "off" : link.state === "OK" ? "ok" : "bad";
  const linkText = socket !== "OPEN" ? "Backend down" : !link || link.state === "NO_DATA" ? "No data" : link.state === "OK" ? "Live" : "NO SIGNAL";

  return (
    <header className="top">
      <div className="top-title">
        <h1>{title}</h1>
        <div className="top-crumb">
          {mission?.team_name ?? "Comet Rocketry"}
          {teamLine(mission) ? ` · ${teamLine(mission)}` : ""} — Mission Operations
        </div>
      </div>
      <div className="top-right">
        <div className="chip vehicle-chip" title={rocket ? `OpenRocket file: ${rocket.source_file}` : "No OpenRocket file loaded"}>
          {Icon.rocket(16)} <span>{rocket?.name ?? "No vehicle file"}</span>
        </div>
        <div className={`mode-pill mode-${mode.toLowerCase()}`}>
          <span className="dot" /> {mode}
        </div>
        <div className={`chip link-chip link-${linkState}`}>
          <span className="dot" /> Link: {linkText} <SignalBars level={linkState === "ok" ? rssiBars(link?.rssi_dbm) || 2 : 0} />
        </div>
        <div className="chip stat-chip">
          <div>
            <div className="chip-label">Downlink</div>
            <div className="chip-value">{packetRate != null ? `${fmt(packetRate, 1)} pkt/s` : "—"}</div>
          </div>
          <div>
            <div className="chip-label">Uplink</div>
            <div className="chip-value dim">none</div>
          </div>
        </div>
        <div className="chip clock-chip">
          <div className="chip-label">UTC</div>
          <div className="chip-value mono">{now.toISOString().slice(11, 19)}</div>
          <div className="chip-label">{now.toISOString().slice(0, 10)}</div>
        </div>
        <div className="toggles">
          <button className="icon-btn" onClick={() => setUnits(units === "imperial" ? "metric" : "imperial")} title="Switch units">
            {units === "imperial" ? "ft" : "m"}
          </button>
          <button className="icon-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
            {theme === "dark" ? Icon.sun() : Icon.moon()}
          </button>
        </div>
      </div>
    </header>
  );
}

/** Never let simulated or replayed data look like a live flight. */
export function ModeStrip({ status, socket }: { status: Status | null; socket: SocketState }) {
  if (socket !== "OPEN") return <div className="strip strip-down">BACKEND DISCONNECTED — DATA ON SCREEN IS NOT UPDATING</div>;
  if (status?.mode === "SIMULATION")
    return (
      <div className="strip strip-sim">
        SIMULATION — SYNTHETIC DATA, NOT A REAL FLIGHT{status.source_status?.paused === true ? " · PAUSED" : ""}
        <span>MONITORING ONLY · NO UPLINK</span>
      </div>
    );
  if (status?.mode === "REPLAY")
    return (
      <div className="strip strip-replay">
        REPLAY — {String(status.source_status?.session ?? "")}
        <span>MONITORING ONLY · NO UPLINK</span>
      </div>
    );
  return null;
}
