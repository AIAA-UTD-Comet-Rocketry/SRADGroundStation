import type { SocketState } from "../useTelemetry";
import type { Status, TelemetryFrame } from "../types";

type Light = "ok" | "warn" | "bad" | "off";

interface Item {
  label: string;
  light: Light;
  detail: string;
}

/**
 * Read-only readiness lights (in the spirit of RMIT's "System Flags").
 * Every light is derived from data we actually receive; "off" means no data, never "OK".
 */
export function Indicators({
  status,
  socket,
  latest,
  rejects,
}: {
  status: Status | null;
  socket: SocketState;
  latest: TelemetryFrame | null;
  rejects: { received_at_utc: string }[];
}) {
  const link = status?.link;
  const d = latest?.data;
  const now = status ? Date.parse(status.server_time_utc) : Date.now();
  const recentRejects = rejects.filter((r) => now - Date.parse(r.received_at_utc) < 10_000).length;
  const flags = d?.status_flags;

  const items: Item[] = [
    { label: "Backend", light: socket === "OPEN" ? "ok" : "bad", detail: socket === "OPEN" ? "connected" : "disconnected" },
    {
      label: "Telemetry link",
      light: !link || link.state === "NO_DATA" ? "off" : link.state === "OK" ? "ok" : "bad",
      detail: !link ? "—" : link.state === "OK" ? "receiving" : link.state === "STALE" ? "NO SIGNAL" : "no data yet",
    },
    {
      label: "Packet integrity",
      light: !link || link.received === 0 ? "off" : recentRejects > 0 ? "warn" : "ok",
      detail: recentRejects > 0 ? `${recentRejects} rejected (10 s)` : link && link.received > 0 ? "clean" : "—",
    },
    {
      label: "GPS fix",
      light: d?.gps_fix == null ? "off" : d.gps_fix ? "ok" : "bad",
      detail: d?.gps_fix == null ? "not in packet" : d.gps_fix ? "fix" : "NO FIX",
    },
    {
      label: "FC SD logging",
      light: flags == null ? "off" : flags & 0x01 ? "ok" : "bad",
      detail: flags == null ? "not in packet" : flags & 0x01 ? "logging" : "NOT LOGGING",
    },
    {
      label: "FC armed",
      light: flags == null ? "off" : flags & 0x10 ? "ok" : "warn",
      detail: flags == null ? "not in packet" : flags & 0x10 ? "armed" : "disarmed",
    },
    {
      label: "Ground recording",
      light: status?.recording.active ? "ok" : status?.mode === "REPLAY" ? "off" : "bad",
      detail: status?.recording.active ? "on" : status?.mode === "REPLAY" ? "replay" : "OFF",
    },
    { label: "Video", light: "off", detail: "not configured" },
  ];

  return (
    <div className="panel">
      <div className="panel-title">System status</div>
      <ul className="lights">
        {items.map((it) => (
          <li key={it.label} className={`light light-${it.light}`}>
            <span className="lamp" aria-hidden />
            <span className="light-label">{it.label}</span>
            <span className="light-detail">{it.detail}</span>
          </li>
        ))}
      </ul>
      <div className="dim small">FC flag bits from an older club test script — confirm with avionics.</div>
    </div>
  );
}
