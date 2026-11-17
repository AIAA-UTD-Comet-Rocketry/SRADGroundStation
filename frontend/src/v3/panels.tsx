import type { FlightEvent, Phase, Status, TelemetryFrame } from "../types";
import type { RocketModel } from "../rocket";
import type { UnitFmt } from "../prefs";
import type { SocketState } from "../useTelemetry";
import { fmt } from "../format";
import { accelOf, fmtMmSs } from "./derive";
import { Card, type DataState } from "./cards";
import { Icon } from "./icons";

// ------------------------------------------------------------------ mission timeline
interface Step {
  label: string;
  est: number | null;
  match: (e: FlightEvent) => boolean;
}

export function MissionTimeline({
  events,
  rocket,
  phase,
  hasData,
  u,
}: {
  events: FlightEvent[];
  rocket: RocketModel | null;
  phase: Phase | null;
  hasData: boolean;
  u: UnitFmt;
}) {
  const pe = rocket?.predicted?.events ?? [];
  const t = (type: string, nth = 0) => pe.filter((e) => e.type === type)[nth]?.t ?? null;
  const apo = rocket?.predicted?.max_altitude_m;
  const steps: Step[] = [
    { label: "Liftoff", est: t("liftoff") != null ? 0 : null, match: (e) => e.to_phase === "BOOST" },
    { label: "Motor burnout", est: t("burnout"), match: (e) => e.from_phase === "BOOST" },
    {
      label: `Apogee${apo != null ? ` (est. ${fmt(u.alt(apo))} ${u.altUnit})` : ""}`,
      est: t("apogee"),
      match: (e) => e.to_phase === "APOGEE" || (e.from_phase === "COAST" && e.to_phase === "DROGUE"),
    },
    { label: "Drogue deploy", est: t("recoverydevicedeployment", 0), match: (e) => e.to_phase === "DROGUE" },
    { label: "Main deploy", est: t("recoverydevicedeployment", 1), match: (e) => e.to_phase === "MAIN" },
    { label: "Landing", est: t("groundhit"), match: (e) => e.to_phase === "LANDED" },
  ];
  const actual = steps.map((s) => events.find(s.match) ?? null);
  // A step with no event of its own still counts as passed if a later one happened
  // (e.g. the station started listening after liftoff).
  const implied = actual.map((a, i) => !a && actual.slice(i + 1).some(Boolean));
  const nextIdx = phase === "LANDED" ? -1 : actual.findIndex((a, i) => a === null && !implied[i]);

  const when = (e: FlightEvent) =>
    e.flight_time_s != null ? `T+${fmtMmSs(e.flight_time_s)}` : `${new Date(e.received_at_utc).toISOString().slice(11, 19)}Z`;

  return (
    <Card title="Mission Timeline" icon={Icon.list()} className="timeline-card">
      <ol className="mtl">
        <li className={`mtl-item ${hasData ? "done" : "next"}`}>
          <span className="mtl-dot">{hasData && Icon.check(12)}</span>
          <span className="mtl-time mono">{hasData ? "acquired" : "waiting"}</span>
          <span className="mtl-label">Telemetry link</span>
        </li>
        {steps.map((s, i) => {
          const a = actual[i];
          const state = a || implied[i] ? "done" : i === nextIdx && hasData ? "next" : "todo";
          return (
            <li key={s.label} className={`mtl-item ${state}`}>
              <span className="mtl-dot">{(a || implied[i]) && Icon.check(12)}</span>
              <span className="mtl-time mono">{a ? when(a) : implied[i] ? "missed" : s.est != null ? `T+${fmtMmSs(s.est)}` : "—"}</span>
              <span className="mtl-label">
                {s.label}
                {implied[i] && <span className="est"> (not received, passed)</span>}
                {!a && !implied[i] && s.est != null && <span className="est"> (est.)</span>}
                {state === "next" && <span className="est"> · next</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="foot-note">Estimates from OpenRocket; ✓ = event received from the flight computer.</div>
    </Card>
  );
}

// ------------------------------------------------------------------ system health
type Level = "ok" | "warn" | "bad" | "off";
interface Row {
  name: string;
  level: Level;
  text: string;
  value?: string;
}

const LEVEL_TEXT: Record<Level, string> = { ok: "Nominal", warn: "Check", bad: "Fault", off: "No data" };

export function healthRows(
  status: Status | null,
  socket: SocketState,
  latest: TelemetryFrame | null,
  rejects: { received_at_utc: string }[],
  state: DataState,
): Row[] {
  const d = latest?.data;
  const link = status?.link;
  const live = state === "ok";
  const pkt = (present: boolean, okText = "Nominal"): Pick<Row, "level" | "text"> =>
    !present ? { level: "off", text: "Not in packet" } : live ? { level: "ok", text: okText } : { level: "warn", text: "Stale" };
  const now = status ? Date.parse(status.server_time_utc) : Date.now();
  const recentRejects = rejects.filter((r) => now - Date.parse(r.received_at_utc) < 10_000).length;
  const acc = accelOf(latest);
  const flags = d?.status_flags;

  return [
    {
      name: "Telemetry (RF)",
      ...(socket !== "OPEN"
        ? { level: "bad" as Level, text: "Backend down" }
        : !link || link.state === "NO_DATA"
          ? { level: "off" as Level, text: "No data" }
          : link.state === "OK"
            ? { level: "ok" as Level, text: "Nominal" }
            : { level: "bad" as Level, text: "NO SIGNAL" }),
      value: link?.rssi_dbm != null ? `${fmt(link.rssi_dbm)} dBm` : undefined,
    },
    { name: "Flight computer", ...pkt(!!d, "Reporting"), value: d?.fc_state ?? d?.phase },
    { name: "Barometer", ...pkt(d?.altitude_agl_m != null), value: d?.pressure_pa != null ? `${fmt(d.pressure_pa / 1000, 1)} kPa` : undefined },
    { name: "IMU (accel/gyro)", ...pkt(acc != null), value: acc != null ? `${fmt(acc / 9.80665, 2)} g` : undefined },
    {
      name: "GPS",
      ...(d?.gps_fix == null ? { level: "off" as Level, text: "Not in packet" } : d.gps_fix ? pkt(true, "Fix") : { level: "bad" as Level, text: "NO FIX" }),
      value: d?.gps_fix ? "3D fix" : undefined,
    },
    {
      name: "FC SD logging",
      ...(flags == null ? { level: "off" as Level, text: "Not in packet" } : flags & 0x01 ? pkt(true, "Logging") : { level: "bad" as Level, text: "NOT LOGGING" }),
    },
    {
      name: "Recovery / pyro",
      ...(d?.pyro_status == null ? { level: "off" as Level, text: "Not in packet" } : { level: "ok" as Level, text: "Reported" }),
      value: d?.pyro_status != null ? `0x${d.pyro_status.toString(16).padStart(2, "0").toUpperCase()} raw` : undefined,
    },
    {
      name: "Packet integrity",
      ...(!link || link.received === 0
        ? { level: "off" as Level, text: "No data" }
        : recentRejects > 0
          ? { level: "warn" as Level, text: `${recentRejects} rejected` }
          : { level: "ok" as Level, text: "Clean" }),
    },
    {
      name: "Ground recording",
      ...(status?.recording.active
        ? { level: "ok" as Level, text: "Recording" }
        : status?.mode === "REPLAY"
          ? { level: "off" as Level, text: "Replay" }
          : { level: "bad" as Level, text: "OFF" }),
      value: status?.recording.active ? `${fmt(status.recording.rows)} rows` : undefined,
    },
  ];
}

export function SystemHealth({ rows }: { rows: Row[] }) {
  const bad = rows.filter((r) => r.level === "bad").length;
  const warn = rows.filter((r) => r.level === "warn").length;
  const anyData = rows.some((r) => r.level !== "off");
  const overall = bad ? { cls: "bad", text: `${bad} FAULT${bad > 1 ? "S" : ""}` } : warn ? { cls: "warn", text: "CHECK SYSTEMS" } : anyData ? { cls: "ok", text: "All Reporting Nominal" } : { cls: "off", text: "No Data" };
  return (
    <Card title="System Health" icon={Icon.shield()} className="health-card" right={<span className={`status-pill pill-${overall.cls}`}>{overall.text}</span>}>
      <ul className="health">
        {rows.map((r) => (
          <li key={r.name} className={`h-${r.level}`}>
            <span className="h-icon">{r.level === "ok" ? Icon.check(13) : r.level === "off" ? "–" : "!"}</span>
            <span className="h-name">{r.name}</span>
            <span className="h-badge">{r.text || LEVEL_TEXT[r.level]}</span>
            <span className="h-value mono">{r.value ?? ""}</span>
          </li>
        ))}
      </ul>
      <div className="foot-note">"Not in packet" = this flight-computer format doesn't send it. FC flag bits unconfirmed.</div>
    </Card>
  );
}
