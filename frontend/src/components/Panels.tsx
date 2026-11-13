import { useEffect, useState } from "react";
import { api, type SocketState } from "../useTelemetry";
import { fmt, fmtClock, fmtTime, M_TO_FT, type ValueState } from "../format";
import type { FlightEvent, Mode, Status, TelemetryFrame } from "../types";

// ---------------------------------------------------------------- mode banner
export function ModeBanner({ status, socket }: { status: Status | null; socket: SocketState }) {
  const mode = status?.mode ?? null;
  const paused = mode === "SIMULATION" && status?.source_status?.paused === true;
  const label =
    socket !== "OPEN"
      ? "BACKEND DISCONNECTED"
      : mode === "SIMULATION"
        ? "SIMULATION — SYNTHETIC DATA, NOT A REAL FLIGHT"
        : mode === "REPLAY"
          ? `REPLAY — ${String(status?.source_status?.session ?? "")}`
          : mode === "LIVE"
            ? "LIVE TELEMETRY"
            : "NO SOURCE";
  const cls = socket !== "OPEN" ? "banner-down" : `banner-${(mode ?? "none").toLowerCase()}`;
  return (
    <header className={`banner ${cls}`}>
      <span className="banner-mode">{label}</span>
      {paused && <span className="banner-tag">SIM PAUSED</span>}
      <span className="banner-right">MONITORING ONLY · NO UPLINK</span>
    </header>
  );
}

// ---------------------------------------------------------------- readouts
function Tile({ label, value, unit, sub, state }: { label: string; value: string; unit?: string; sub?: string; state: ValueState }) {
  return (
    <div className={`tile tile-${state}`}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">
        {state === "nodata" ? "NO DATA" : value}
        {state !== "nodata" && unit && <span className="tile-unit">{unit}</span>}
      </div>
      <div className="tile-sub">{state === "stale" ? "STALE" : (sub ?? " ")}</div>
    </div>
  );
}

export function Readouts({ latest, dataState }: { latest: TelemetryFrame | null; dataState: ValueState }) {
  const d = latest?.data;
  const st = (v: number | null | undefined | string): ValueState => (v === null || v === undefined ? "nodata" : dataState);
  return (
    <div className="readouts">
      <Tile label="Altitude AGL (baro)" value={fmt(d?.altitude_agl_m)} unit="m" sub={`${fmt(d?.altitude_agl_m != null ? d.altitude_agl_m * M_TO_FT : null)} ft`} state={st(d?.altitude_agl_m)} />
      <Tile label="Vertical velocity" value={fmt(d?.vertical_velocity_mps, 1)} unit="m/s" state={st(d?.vertical_velocity_mps)} />
      {d?.acceleration_mps2 == null && d?.accel_z_mps2 != null ? (
        <Tile label="Body Z accel (axis TBC)" value={fmt(d.accel_z_mps2, 1)} unit="m/s²" sub={`${fmt(d.accel_z_mps2 / 9.80665, 2)} g, as reported`} state={dataState} />
      ) : (
        <Tile label="Vertical accel" value={fmt(d?.acceleration_mps2, 1)} unit="m/s²" sub={d?.acceleration_mps2 != null ? `${fmt(d.acceleration_mps2 / 9.80665, 2)} g` : undefined} state={st(d?.acceleration_mps2)} />
      )}
      {d?.flight_time_s == null && d?.fc_time_s != null ? (
        <Tile label="FC clock" value={fmt(d.fc_time_s, 1)} unit="s" sub="since FC power-on (not T+)" state={dataState} />
      ) : (
        <Tile label="Flight time" value={fmtTime(d?.flight_time_s)} state={st(d?.flight_time_s)} />
      )}
      <Tile
        label="Phase (from packet)"
        value={d?.phase ?? ""}
        state={d ? dataState : "nodata"}
        sub={d ? (d.fc_state ? `FC: ${d.fc_state}` : d.sequence != null ? `seq ${d.sequence}` : undefined) : undefined}
      />
      <Tile label="Pressure / Temp" value={fmt(d?.pressure_pa != null ? d.pressure_pa / 100 : null, 1)} unit="hPa" sub={d?.temperature_c != null ? `${fmt(d.temperature_c, 1)} °C` : "temp: no data"} state={st(d?.pressure_pa)} />
    </div>
  );
}

// ---------------------------------------------------------------- link health
export function LinkPanel({ status, socket }: { status: Status | null; socket: SocketState }) {
  const l = status?.link;
  const state = socket !== "OPEN" ? "BACKEND DOWN" : (l?.state ?? "NO_DATA").replace("_", " ");
  const cls = socket !== "OPEN" || !l || l.state === "NO_DATA" ? "bad" : l.state === "STALE" ? "warn" : "good";
  return (
    <div className="panel">
      <div className="panel-title">Telemetry link</div>
      <div className={`link-state link-${cls}`}>{state}</div>
      <dl className="kv">
        <dt>Last packet age</dt>
        <dd>{l?.last_packet_age_s != null ? `${fmt(l.last_packet_age_s, 1)} s` : "—"}</dd>
        <dt>RSSI</dt>
        <dd>{l?.rssi_dbm != null ? `${fmt(l.rssi_dbm, 0)} dBm` : "no data"}</dd>
        <dt>SNR</dt>
        <dd>{l?.snr_db != null ? `${fmt(l.snr_db, 1)} dB` : "no data"}</dd>
        <dt>Received</dt>
        <dd>{fmt(l?.received)}</dd>
        <dt>Missed (seq gaps)</dt>
        <dd>
          {l && !l.sequence_tracking ? (
            <span className="dim">n/a (no packet counter)</span>
          ) : (
            <>
              {fmt(l?.missed)} {l?.loss_pct != null && <span className="dim">({fmt(l.loss_pct, 1)}%)</span>}
            </>
          )}
        </dd>
        <dt>Rejected (invalid)</dt>
        <dd className={l && l.rejected > 0 ? "warn-text" : ""}>{fmt(l?.rejected)}</dd>
        <dt>Seq resets</dt>
        <dd>{fmt(l?.sequence_resets)}</dd>
      </dl>
      {status?.source_error && <div className="error-box">Source error: {status.source_error}</div>}
      {status?.mode === "LIVE" && (
        <div className="dim small">
          Port {String(status.source_status.port)} · {String(status.source_status.port_state)}
          {status.source_status.last_error ? ` · ${String(status.source_status.last_error)}` : ""}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- GPS
export function GpsPanel({ frames, status }: { frames: TelemetryFrame[]; status: Status | null }) {
  let lastFix: TelemetryFrame | null = null;
  for (let i = frames.length - 1; i >= 0; i--) {
    if (frames[i].data.latitude_deg != null && frames[i].data.longitude_deg != null) {
      lastFix = frames[i];
      break;
    }
  }
  const latest = frames.at(-1)?.data;
  const age =
    lastFix && status
      ? Math.max(0, (Date.parse(status.server_time_utc) - Date.parse(lastFix.received_at_utc)) / 1000)
      : null;
  return (
    <div className="panel">
      <div className="panel-title">
        GPS {status?.mode === "SIMULATION" && <span className="tag-sim">SYNTHETIC POSITION</span>}
      </div>
      <dl className="kv">
        <dt>Fix (latest packet)</dt>
        <dd>{latest?.gps_fix == null ? "no data" : latest.gps_fix ? "YES" : <span className="warn-text">NO FIX</span>}</dd>
        <dt>Last-known lat</dt>
        <dd className="mono">{fmt(lastFix?.data.latitude_deg, 6)}</dd>
        <dt>Last-known lon</dt>
        <dd className="mono">{fmt(lastFix?.data.longitude_deg, 6)}</dd>
        <dt>GPS alt (MSL)</dt>
        <dd>{lastFix?.data.gps_altitude_msl_m != null ? `${fmt(lastFix.data.gps_altitude_msl_m)} m` : "—"}</dd>
        <dt>Position age</dt>
        <dd className={age != null && age > 5 ? "warn-text" : ""}>{age != null ? `${fmt(age, 1)} s` : "—"}</dd>
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------- flight computer / IMU
export function ImuPanel({ latest }: { latest: TelemetryFrame | null }) {
  const d = latest?.data;
  const hasImu = d && (d.accel_x_mps2 != null || d.pitch_deg != null || d.status_flags != null);
  if (!hasImu) return null; // only shown when the source actually sends these fields
  const g = (v: number | null) => (v == null ? "—" : `${fmt(v / 9.80665, 2)} g`);
  const flags = d.status_flags;
  return (
    <div className="panel">
      <div className="panel-title">Flight computer (raw, axes TBC)</div>
      <dl className="kv">
        <dt>Accel X / Y / Z</dt>
        <dd className="mono">
          {g(d.accel_x_mps2)} / {g(d.accel_y_mps2)} / {g(d.accel_z_mps2)}
        </dd>
        <dt>Pitch / Roll / Yaw</dt>
        <dd className="mono">
          {fmt(d.pitch_deg)}° / {fmt(d.roll_deg)}° / {fmt(d.yaw_deg)}°
        </dd>
        <dt>FC state</dt>
        <dd>{d.fc_state ?? "—"}</dd>
        <dt>Status flags</dt>
        <dd className="mono">
          {flags == null ? "—" : `0x${flags.toString(16).padStart(2, "0").toUpperCase()}`}
          {flags != null && <span className="dim"> SD {flags & 0x01 ? "on" : "off"} · armed {flags & 0x10 ? "yes" : "no"}</span>}
        </dd>
        <dt>Pyro status</dt>
        <dd className="mono">{d.pyro_status == null ? "—" : `0x${d.pyro_status.toString(16).padStart(2, "0").toUpperCase()}`}</dd>
      </dl>
      <div className="dim small">Flag bit meanings from an older club test script — confirm with avionics.</div>
    </div>
  );
}

// ---------------------------------------------------------------- recording
export function RecordingPanel({ status }: { status: Status | null }) {
  const r = status?.recording;
  return (
    <div className="panel">
      <div className="panel-title">Ground recording</div>
      <div className={`link-state ${r?.active ? "link-good" : "link-warn"}`}>{r?.active ? "● RECORDING" : "NOT RECORDING"}</div>
      <div className="dim small mono path">{r?.path ?? (status?.mode === "REPLAY" ? "replays are not re-recorded" : "—")}</div>
      {r?.active && <div className="dim small">{fmt(r.rows)} rows written</div>}
      <div className="dim small">Ground log only — not the onboard SD or official altimeter record.</div>
    </div>
  );
}

// ---------------------------------------------------------------- video
export function VideoPane() {
  return (
    <div className="panel video">
      <div className="panel-title">Video</div>
      <div className="video-empty">
        <div className="video-empty-title">NO VIDEO SOURCE</div>
        <div className="dim small">Video capture path not configured yet (camera / VTX / VRX / capture device TBD).</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- events
export function EventLog({ events, rejects }: { events: FlightEvent[]; rejects: { received_at_utc: string; reason: string }[] }) {
  return (
    <div className="panel events">
      <div className="panel-title">Event log</div>
      <ul className="event-list">
        {events.length === 0 && <li className="dim">No phase transitions received yet.</li>}
        {[...events].reverse().map((e) => (
          <li key={`${e.sequence}-${e.name}`}>
            <span className="mono dim">{fmtClock(e.received_at_utc)}</span>
            <span className="mono">{fmtTime(e.flight_time_s)}</span>
            <span className="event-name">{e.name}</span>
            <span className="dim small">{e.sequence != null ? `seq ${e.sequence}` : ""}</span>
          </li>
        ))}
      </ul>
      {rejects.length > 0 && (
        <div className="rejects">
          <div className="dim small">Recent rejected packets</div>
          {rejects.slice(0, 3).map((r, i) => (
            <div key={i} className="small warn-text mono">
              {fmtClock(r.received_at_utc)} {r.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- controls
export function Controls({ status }: { status: Status | null }) {
  const [sessions, setSessions] = useState<{ name: string; size_bytes: number }[]>([]);
  const [session, setSession] = useState("");
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const mode = status?.mode ?? null;
  const sim = status?.source_status ?? {};

  const refreshSessions = () =>
    api<{ name: string; size_bytes: number }[]>("/api/sessions")
      .then((s) => {
        setSessions(s);
        setSession((cur) => cur || s[0]?.name || "");
      })
      .catch(() => {});
  useEffect(() => {
    refreshSessions();
  }, [mode]);

  const run = (p: Promise<unknown>) => {
    setError(null);
    p.catch((e: Error) => setError(e.message));
  };
  const switchMode = (m: Mode) => {
    if (mode === "LIVE" && m !== "LIVE" && !confirm("Leave LIVE mode? Live reception and recording will stop.")) return;
    run(api("/api/mode", m === "REPLAY" ? { mode: m, session, speed: replaySpeed } : { mode: m }));
  };
  const simCmd = (body: Record<string, unknown>) => run(api("/api/sim", body));

  return (
    <div className="panel controls">
      <div className="panel-title">Ground station source</div>
      <div className="btn-row">
        {(["SIMULATION", "LIVE"] as Mode[]).map((m) => (
          <button key={m} className={mode === m ? "active" : ""} onClick={() => switchMode(m)}>
            {m}
          </button>
        ))}
        <select value={session} onChange={(e) => setSession(e.target.value)} onFocus={refreshSessions}>
          {sessions.length === 0 && <option value="">no recorded sessions</option>}
          {sessions.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        <select value={replaySpeed} onChange={(e) => setReplaySpeed(Number(e.target.value))}>
          {[1, 2, 5, 10].map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
        <button className={mode === "REPLAY" ? "active" : ""} disabled={!session} onClick={() => switchMode("REPLAY")}>
          REPLAY
        </button>
      </div>

      {mode === "SIMULATION" && (
        <>
          <div className="panel-title sub">Simulator (affects synthetic data only)</div>
          <div className="btn-row">
            <button onClick={() => simCmd({ action: "launch" })} disabled={sim.sim_phase !== "PAD"}>
              Sim launch
            </button>
            <button onClick={() => simCmd({ action: sim.paused ? "resume" : "pause" })}>{sim.paused ? "Resume" : "Pause"}</button>
            <button onClick={() => simCmd({ action: "reset" })}>Reset</button>
            <span className="sep" />
            {[1, 2, 5, 10].map((s) => (
              <button key={s} className={sim.speed === s ? "active" : ""} onClick={() => simCmd({ action: "configure", speed: s })}>
                {s}×
              </button>
            ))}
          </div>
          <div className="btn-row">
            <label>
              Apogee
              <select
                value={String(sim.apogee_target_ft ?? 10000)}
                disabled={sim.sim_phase !== "PAD"}
                onChange={(e) => simCmd({ action: "configure", apogee_ft: Number(e.target.value) })}
              >
                <option value="10000">10k ft</option>
                <option value="30000">30k ft</option>
                <option value="45000">45k ft</option>
              </select>
            </label>
            <label>
              Packet loss
              <select value={String(sim.packet_loss ?? 0)} onChange={(e) => simCmd({ action: "configure", packet_loss: Number(e.target.value) })}>
                {[0, 0.02, 0.1, 0.3, 0.6].map((p) => (
                  <option key={p} value={String(p)}>
                    {p * 100}%
                  </option>
                ))}
              </select>
            </label>
            <label>
              Corrupt
              <select value={String(sim.corrupt_rate ?? 0)} onChange={(e) => simCmd({ action: "configure", corrupt_rate: Number(e.target.value) })}>
                {[0, 0.05, 0.2].map((p) => (
                  <option key={p} value={String(p)}>
                    {p * 100}%
                  </option>
                ))}
              </select>
            </label>
            <button onClick={() => simCmd({ action: "dropout", dropout_s: 5 })}>5 s dropout</button>
          </div>
        </>
      )}
      {mode === "REPLAY" && (
        <div className="dim small">
          Replay {String(sim.position ?? 0)} / {String(sim.total ?? 0)} packets {sim.finished ? "· finished" : ""}
        </div>
      )}
      {error && <div className="error-box">{error}</div>}
    </div>
  );
}
