import { useMemo, useState } from "react";
import { api, useTelemetry } from "./useTelemetry";
import { useRocket } from "./rocket";
import { unitFmt, usePrefs } from "./prefs";
import { fmt } from "./format";
import { derive } from "./v3/derive";
import { Sidebar, TopBar, ModeStrip, VIEWS, type View } from "./v3/shell";
import { Card, KpiRow, RocketStatusCard, PHASE_TEXT, type DataState } from "./v3/cards";
import { FlightChart } from "./v3/Chart";
import { TrackMap } from "./v3/TrackMap";
import { MissionTimeline, SystemHealth, healthRows } from "./v3/panels";
import { Icon } from "./v3/icons";
import { Controls, EventLog, GpsPanel, ImuPanel, LinkPanel, RecordingPanel, VideoPane } from "./components/Panels";
import { RocketProfile } from "./components/RocketProfile";
import { AsciiRocket } from "./v3/AsciiRocket";

export default function App() {
  const t = useTelemetry();
  const rocket = useRocket();
  const { theme, setTheme, units, setUnits } = usePrefs();
  const [view, setView] = useState<View>("dashboard");
  const u = unitFmt(units);

  const derived = useMemo(() => derive(t.frames, t.status?.server_time_utc ?? null), [t.version, t.status?.server_time_utc]); // eslint-disable-line react-hooks/exhaustive-deps
  const state: DataState = !t.latest ? "nodata" : t.socket !== "OPEN" || t.status?.link.state !== "OK" ? "stale" : "ok";
  const d = t.latest?.data;
  const pred = rocket?.predicted;
  const isSim = t.status?.mode === "SIMULATION";

  // charts in display units; prediction shifted to line up with liftoff
  const charts = useMemo(() => {
    const live = (ys: (number | null)[], f: (v: number | null) => number | null) => ({ x: derived.x, y: ys.map(f) });
    const p = pred && derived.liftoffX != null ? { x: pred.t.map((v) => v + (derived.liftoffX as number)) } : null;
    return {
      alt: live(derived.alt, u.alt),
      vel: live(derived.vel, u.vel),
      altPred: p && pred ? { x: p.x, y: pred.altitude_m.map(u.alt) } : null,
      velPred: p && pred ? { x: p.x, y: pred.vertical_velocity_mps.map(u.vel) } : null,
    };
  }, [derived, pred, units]); // eslint-disable-line react-hooks/exhaustive-deps

  const health = healthRows(t.status, t.socket, t.latest, t.rejects, state);
  const head = (v: number | null, unit: string) => (v == null ? "—" : `${fmt(v)} ${unit}`);

  const altChart = (
    <FlightChart
      title="Altitude (AGL)"
      icon={Icon.mountain()}
      axisLabel={`Altitude (${u.altUnit})`}
      headline={head(u.alt(d?.altitude_agl_m), u.altUnit)}
      live={charts.alt}
      predicted={charts.altPred}
      colorVar="--c-alt"
      theme={theme}
      version={t.version}
    />
  );
  const velChart = (
    <FlightChart
      title="Velocity"
      icon={Icon.gauge()}
      axisLabel={`Velocity (${u.velUnit})`}
      headline={head(u.vel(d?.vertical_velocity_mps), u.velUnit)}
      live={charts.vel}
      predicted={charts.velPred}
      colorVar="--c-vel"
      theme={theme}
      version={t.version}
    />
  );
  const timeline = <MissionTimeline events={t.events} rocket={rocket} phase={d?.phase ?? null} hasData={!!t.latest} u={u} />;
  const map = (big = false) => <TrackMap derived={derived} rocket={rocket} u={u} big={big} isSim={isSim} />;

  let body;
  switch (view) {
    case "telemetry":
      body = (
        <div className="view view-telemetry">
          <div className="col-2">
            {altChart}
            {velChart}
          </div>
          <div className="col-side">
            <LatestPacket frame={t.latest} />
            <LinkPanel status={t.status} socket={t.socket} />
            <ImuPanel latest={t.latest} />
          </div>
        </div>
      );
      break;
    case "map":
      body = (
        <div className="view view-map">
          {map(true)}
          <div className="col-side">
            <GpsPanel frames={t.frames} status={t.status} />
            <Card title="About this map" icon={Icon.pin()}>
              <p className="dim small">
                Positions are plotted relative to the first GPS fix, north up, with no map tiles so it works offline at the launch site. The dashed line is
                OpenRocket's simulated drift for the design's wind settings — a reference, not a landing prediction.
              </p>
            </Card>
          </div>
        </div>
      );
      break;
    case "systems":
      body = (
        <div className="view view-systems">
          <SystemHealth rows={health} />
          <div className="col-side">
            <LinkPanel status={t.status} socket={t.socket} />
            <ImuPanel latest={t.latest} />
          </div>
          <div className="col-side">
            <RecordingPanel status={t.status} />
            <VideoPane />
          </div>
        </div>
      );
      break;
    case "mission":
      body = (
        <div className="view view-mission">
          <div className="wide">
            <RocketProfile rocket={rocket} phase={d?.phase ?? null} maxAltitudeM={derived.maxAltM} />
          </div>
          {timeline}
          <EventLog events={t.events} rejects={t.rejects} />
          <PredictionCard rocket={rocket} u={u} />
        </div>
      );
      break;
    case "logs":
      body = (
        <div className="view view-logs">
          <Controls status={t.status} />
          <RecordingPanel status={t.status} />
          <EventLog events={t.events} rejects={t.rejects} />
        </div>
      );
      break;
    case "settings":
      body = <Settings theme={theme} setTheme={setTheme} units={units} setUnits={setUnits} rocket={rocket} />;
      break;
    default:
      body = (
        <div className="view view-dash">
          {isSim && <SimBar status={t.status} />}
          <KpiRow latest={t.latest} derived={derived} u={u} state={state} />
          <div className="dash-row1">
            <RocketStatusCard rocket={rocket} latest={t.latest} u={u} state={state} />
            {altChart}
            {velChart}
          </div>
          <div className="dash-row2">
            {map()}
            {timeline}
            <SystemHealth rows={health} />
          </div>
        </div>
      );
  }

  return (
    <div className="shell">
      <Sidebar view={view} onView={setView} socket={t.socket} />
      <div className="main">
        <TopBar
          title={view === "dashboard" ? "Ground Station Dashboard" : (VIEWS.find((v) => v.id === view)?.label ?? "")}
          rocket={rocket}
          status={t.status}
          socket={t.socket}
          packetRate={derived.packetRate}
          theme={theme}
          setTheme={setTheme}
          units={units}
          setUnits={setUnits}
        />
        <ModeStrip status={t.status} socket={t.socket} />
        <main className="content">{body}</main>
      </div>
    </div>
  );
}

function SimBar({ status }: { status: ReturnType<typeof useTelemetry>["status"] }) {
  const s = status?.source_status ?? {};
  const cmd = (body: Record<string, unknown>) => api("/api/sim", body).catch(() => {});
  return (
    <div className="simbar">
      <span className="simbar-label">Simulator</span>
      <button className="btn primary" disabled={s.sim_phase !== "PAD"} onClick={() => cmd({ action: "launch" })}>
        Sim launch
      </button>
      <button className="btn" onClick={() => cmd({ action: s.paused ? "resume" : "pause" })}>
        {s.paused ? "Resume" : "Pause"}
      </button>
      <button className="btn" onClick={() => cmd({ action: "reset" })}>
        Reset
      </button>
      <span className="simbar-sep" />
      {[1, 2, 5, 10].map((v) => (
        <button key={v} className={`btn ${s.speed === v ? "active" : ""}`} onClick={() => cmd({ action: "configure", speed: v })}>
          {v}×
        </button>
      ))}
      <button className="btn" onClick={() => cmd({ action: "dropout", dropout_s: 5 })}>
        5 s dropout
      </button>
      <span className="dim small">More options in Data &amp; Logs</span>
    </div>
  );
}

function LatestPacket({ frame }: { frame: ReturnType<typeof useTelemetry>["latest"] }) {
  const rows = frame ? Object.entries(frame.data) : [];
  return (
    <Card title="Latest packet (raw fields)" icon={Icon.pulse()}>
      {!frame ? (
        <div className="dim small">No packets received.</div>
      ) : (
        <dl className="kv">
          {rows.map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt className="mono">{k}</dt>
              <dd className={`mono ${v === null ? "dim" : ""}`}>{v === null ? "null" : typeof v === "number" ? fmt(v, Number.isInteger(v) ? 0 : 3) : String(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

function PredictionCard({ rocket, u }: { rocket: ReturnType<typeof useRocket>; u: ReturnType<typeof unitFmt> }) {
  const p = rocket?.predicted;
  return (
    <Card title="OpenRocket prediction" icon={Icon.rocket()}>
      {!p ? (
        <div className="dim small">No simulation in the rocket file.</div>
      ) : (
        <dl className="kv">
          <dt>Simulation</dt>
          <dd>{p.simulation}</dd>
          <dt>Apogee</dt>
          <dd>{p.max_altitude_m != null ? `${fmt(u.alt(p.max_altitude_m))} ${u.altUnit}` : "—"}</dd>
          <dt>Time to apogee</dt>
          <dd>{p.time_to_apogee_s != null ? `${fmt(p.time_to_apogee_s, 1)} s` : "—"}</dd>
          <dt>Max velocity</dt>
          <dd>{p.max_velocity_mps != null ? `${fmt(u.vel(p.max_velocity_mps))} ${u.velUnit} (M${fmt(p.max_mach, 2)})` : "—"}</dd>
          <dt>Flight time</dt>
          <dd>{p.flight_time_s != null ? `${fmt(p.flight_time_s, 0)} s` : "—"}</dd>
          <dt>Ground hit</dt>
          <dd>{p.ground_hit_velocity_mps != null ? `${fmt(u.vel(p.ground_hit_velocity_mps), 1)} ${u.velUnit}` : "—"}</dd>
          <dt>Motor (in .ork)</dt>
          <dd>{rocket?.motor ?? "—"}</dd>
        </dl>
      )}
      <div className="foot-note">Design-team model, shown for reference. Not a measurement.</div>
    </Card>
  );
}

function Settings({
  theme,
  setTheme,
  units,
  setUnits,
  rocket,
}: {
  theme: ReturnType<typeof usePrefs>["theme"];
  setTheme: ReturnType<typeof usePrefs>["setTheme"];
  units: ReturnType<typeof usePrefs>["units"];
  setUnits: ReturnType<typeof usePrefs>["setUnits"];
  rocket: ReturnType<typeof useRocket>;
}) {
  const rocketFile = rocket?.source_file ?? null;
  return (
    <div className="view view-settings">
      <Card title="Display" icon={Icon.gear()}>
        <div className="setting">
          <span>Theme</span>
          <div className="seg">
            <button className={theme === "light" ? "on" : ""} onClick={() => setTheme("light")}>
              {Icon.sun(16)} Light
            </button>
            <button className={theme === "dark" ? "on" : ""} onClick={() => setTheme("dark")}>
              {Icon.moon(16)} Dark
            </button>
          </div>
        </div>
        <div className="setting">
          <span>Units</span>
          <div className="seg">
            <button className={units === "imperial" ? "on" : ""} onClick={() => setUnits("imperial")}>
              ft · ft/s · °F
            </button>
            <button className={units === "metric" ? "on" : ""} onClick={() => setUnits("metric")}>
              m · m/s · °C
            </button>
          </div>
        </div>
        <div className="foot-note">Saved in this browser only. Recorded data is always stored in SI units.</div>
      </Card>
      <Card title="Ground station" icon={Icon.antenna()}>
        <dl className="kv">
          <dt>Vehicle file</dt>
          <dd>{rocketFile ?? "none"}</dd>
          <dt>Radio / packet format</dt>
          <dd>set in config/ground_station.toml</dd>
          <dt>Uplink</dt>
          <dd>none — monitoring only</dd>
        </dl>
        <div className="foot-note">Phase names: {Object.values(PHASE_TEXT).join(" · ")}</div>
      </Card>
      {rocket && (
        <Card title="About" icon={Icon.rocket()} className="about-card">
          <div className="about-body">
            <AsciiRocket rocket={rocket} cols={120} rows={46} className="ar-about" />
            <div className="about-text">
              <b>UTD Comet Rocketry · SRAD Ground Station</b>
              <span className="dim">{rocket.name}</span>
              <span className="dim small">
                Rocket shape from {rocket.source_file} (radius widened so it reads at character size), Temoc watching from the corner. ASCII
                rendering idea from alishsharma17/Ascii-Flower-Bouquet-.
              </span>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
