import type { ReactNode } from "react";
import type { Phase, TelemetryFrame } from "../types";
import { propellants, type MissionInfo, type RocketModel } from "../rocket";
import type { UnitFmt } from "../prefs";
import { fmt } from "../format";
import { accelOf, fmtMmSs, type Derived } from "./derive";
import { Icon } from "./icons";

export type DataState = "ok" | "stale" | "nodata";

export const PHASE_TEXT: Record<Phase, string> = {
  UNKNOWN: "Unknown",
  PAD: "On pad",
  BOOST: "Powered ascent",
  COAST: "Coast",
  APOGEE: "Apogee",
  DROGUE: "Drogue descent",
  MAIN: "Main descent",
  LANDED: "Landed",
};

export function Card({ title, icon, right, className, children }: { title?: string; icon?: ReactNode; right?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`card ${className ?? ""}`}>
      {title && (
        <div className="card-head">
          <h2>
            {icon}
            {title}
          </h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

function Kpi({
  icon,
  label,
  value,
  unit,
  sub,
  state,
}: {
  icon: ReactNode;
  label: string;
  value: number | string | null;
  unit?: string;
  sub?: ReactNode;
  state: DataState;
}) {
  const noData = value === null || value === "";
  return (
    <div className={`kpi kpi-${noData ? "nodata" : state}`}>
      <div className="kpi-label">
        <span className="kpi-icon">{icon}</span>
        {label}
      </div>
      <div className="kpi-value">
        {noData ? "No data" : value}
        {!noData && unit && <span className="kpi-unit"> {unit}</span>}
      </div>
      <div className="kpi-sub">{state === "stale" && !noData ? <span className="stale-tag">STALE</span> : sub}</div>
    </div>
  );
}

function Delta({ v, unit, digits = 0 }: { v: number | null; unit: string; digits?: number }) {
  if (v == null) return <>&nbsp;</>;
  const up = v >= 0;
  return (
    <span className={up ? "delta up" : "delta down"}>
      {up ? "↑" : "↓"} {up ? "+" : "−"}
      {fmt(Math.abs(v), digits)} {unit} (30 s)
    </span>
  );
}

export function KpiRow({ latest, derived, u, state }: { latest: TelemetryFrame | null; derived: Derived; u: UnitFmt; state: DataState }) {
  const d = latest?.data;
  const acc = accelOf(latest);
  const accIsBody = d?.acceleration_mps2 == null && d?.accel_z_mps2 != null;
  const range = derived.lastFix ? Math.hypot(derived.lastFix.e, derived.lastFix.n) : null;
  const time = d?.flight_time_s ?? null;
  const k = (v: number | null, digits = 0) => (v == null ? null : fmt(v, digits));
  return (
    <div className="kpis">
      <Kpi icon={Icon.mountain()} label="Altitude (AGL)" value={k(u.alt(d?.altitude_agl_m))} unit={u.altUnit} state={state} sub={<Delta v={u.alt(derived.delta30.alt)} unit={u.altUnit} />} />
      <Kpi icon={Icon.gauge()} label="Velocity" value={k(u.vel(d?.vertical_velocity_mps))} unit={u.velUnit} state={state} sub={<Delta v={u.vel(derived.delta30.vel)} unit={u.velUnit} />} />
      <Kpi
        icon={Icon.bolt()}
        label={accIsBody ? "Accel (body Z)" : "Acceleration"}
        value={k(u.g(acc), 1)}
        unit="g"
        state={state}
        sub={accIsBody ? <span className="dim">axis TBC, as reported</span> : <Delta v={u.g(derived.delta30.acc)} unit="g" digits={1} />}
      />
      <Kpi icon={Icon.trophy()} label="Max Altitude (Live)" value={k(u.alt(derived.maxAltM))} unit={u.altUnit} state={state === "nodata" ? "nodata" : "ok"} sub={<span className="dim">this session</span>} />
      <Kpi icon={Icon.arrows()} label="Range (Ground)" value={k(u.dist(range), 2)} unit={u.distUnit} state={state} sub={<span className="dim">from first GPS fix</span>} />
      <Kpi
        icon={Icon.clock()}
        label={time == null && d?.fc_time_s != null ? "FC Clock" : "Flight Time"}
        value={time != null ? `T+ ${fmtMmSs(time)}` : d?.fc_time_s != null ? fmtMmSs(d.fc_time_s) : null}
        state={state}
        sub={time == null && d?.fc_time_s != null ? <span className="dim">since FC power-on</span> : undefined}
      />
    </div>
  );
}

// --------------------------------------------------------------- rocket status
function statusOf(phase: Phase | undefined, state: DataState): { text: string; cls: string } {
  if (state === "nodata" || !phase) return { text: "NO DATA", cls: "off" };
  if (state === "stale") return { text: "NO SIGNAL", cls: "bad" };
  if (phase === "PAD" || phase === "UNKNOWN") return { text: "ON PAD", cls: "info" };
  if (phase === "LANDED") return { text: "LANDED", cls: "ok" };
  if (phase === "DROGUE" || phase === "MAIN") return { text: "DESCENT", cls: "info" };
  return { text: "IN FLIGHT", cls: "ok" };
}

function VerticalRocket({ rocket, phase }: { rocket: RocketModel | null; phase: Phase | undefined }) {
  if (!rocket) return <div className="rocket-missing">{Icon.rocket(48)}</div>;
  const L = rocket.length_m;
  const span = Math.max(rocket.diameter_m / 2, ...rocket.fins.flatMap((f) => f.polygon.map((p) => p[1])));
  const W = span * 2.6;
  const pad = L * 0.04;
  const flame = phase === "BOOST";
  const H = L + pad * 2 + (flame ? L * 0.16 : 0);
  const cx = W / 2;
  const left = rocket.outline.map(([y, r]) => `${cx - r},${y + pad}`).join(" ");
  const right = [...rocket.outline].reverse().map(([y, r]) => `${cx + r},${y + pad}`).join(" ");
  const nose = rocket.sections[0]?.kind === "nosecone" ? rocket.sections[0].length : 0;
  const noseOutline = rocket.outline.filter(([y]) => y <= nose + 1e-6);
  const descent = phase === "DROGUE" || phase === "MAIN" || phase === "LANDED";
  return (
    <svg className="vrocket" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${rocket.name}, drawn from the OpenRocket file`}>
      {flame && (
        <polygon className="vflame" points={`${cx - rocket.diameter_m * 0.35},${L + pad} ${cx},${L + pad + L * 0.15} ${cx + rocket.diameter_m * 0.35},${L + pad}`} />
      )}
      {rocket.fins.map((f, i) => (
        <g key={i} className="vfin">
          <polygon points={f.polygon.map(([y, r]) => `${cx - r},${y + pad}`).join(" ")} />
          <polygon points={f.polygon.map(([y, r]) => `${cx + r},${y + pad}`).join(" ")} />
        </g>
      ))}
      <polygon className="vbody" points={`${left} ${right}`} />
      {noseOutline.length > 1 && (
        <polygon
          className="vnose"
          points={`${noseOutline.map(([y, r]) => `${cx - r},${y + pad}`).join(" ")} ${[...noseOutline].reverse().map(([y, r]) => `${cx + r},${y + pad}`).join(" ")}`}
        />
      )}
      {rocket.sections.slice(1).map((s) => (
        <line key={s.x} className="vjoint" x1={cx - rocket.diameter_m / 2} x2={cx + rocket.diameter_m / 2} y1={s.x + pad} y2={s.x + pad} />
      ))}
      {rocket.internals
        .filter((i) => /parachute/i.test(i.name))
        .map((c) => (
          <rect key={c.x} className={descent ? "vchute active" : "vchute"} x={cx - rocket.diameter_m * 0.32} width={rocket.diameter_m * 0.64} y={c.x + pad} height={c.length} rx={rocket.diameter_m * 0.1} />
        ))}
    </svg>
  );
}

export function RocketStatusCard({
  rocket,
  mission,
  latest,
  u,
  state,
}: {
  rocket: RocketModel | null;
  mission: MissionInfo | null;
  latest: TelemetryFrame | null;
  u: UnitFmt;
  state: DataState;
}) {
  const d = latest?.data;
  const st = statusOf(d?.phase, state);
  const pred = rocket?.predicted;
  const rows: [string, ReactNode][] = [
    ["Vehicle", mission?.vehicle ?? rocket?.name ?? "—"],
    ["Motor", mission ? `${mission.motor} · ${propellants(mission)}` : "—"],
    ["Phase", d ? `${PHASE_TEXT[d.phase]}${d.fc_state ? ` (${d.fc_state})` : ""}` : "—"],
    ["Altitude", d?.altitude_agl_m != null ? `${fmt(u.alt(d.altitude_agl_m))} ${u.altUnit}` : "—"],
    ["Velocity", d?.vertical_velocity_mps != null ? `${fmt(u.vel(d.vertical_velocity_mps))} ${u.velUnit}` : "—"],
    ["Apogee (OpenRocket)", pred?.max_altitude_m != null ? `${fmt(u.alt(pred.max_altitude_m))} ${u.altUnit}` : "—"],
  ];
  return (
    <Card title="Live Rocket Status" icon={Icon.rocket()} className="rocket-card">
      <div className="rocket-card-body">
        <VerticalRocket rocket={rocket} phase={d?.phase} />
        <div className="rocket-info">
          <div className={`status-pill pill-${st.cls}`}>
            <span className="dot" /> {st.text}
          </div>
          <dl className="info-table">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </Card>
  );
}
