import type { FlightEvent, Phase } from "../types";
import { fmtTime } from "../format";

const STEPS: { phase: Phase; label: string }[] = [
  { phase: "PAD", label: "PRE-FLIGHT" },
  { phase: "BOOST", label: "BOOST" },
  { phase: "COAST", label: "COAST" },
  { phase: "APOGEE", label: "APOGEE" },
  { phase: "DROGUE", label: "DROGUE" },
  { phase: "MAIN", label: "MAIN" },
  { phase: "LANDED", label: "LANDED" },
];

/** Flight timeline. The current step comes from the packet's phase; times come from received events. */
export function Timeline({ phase, events, stale }: { phase: Phase | null; events: FlightEvent[]; stale: boolean }) {
  // Some sources skip APOGEE as its own phase (COAST -> DROGUE); treat it as passed in that case.
  const idx = phase ? STEPS.findIndex((s) => s.phase === phase) : -1;
  const reachedAt = (p: Phase) => events.find((e) => e.to_phase === p);
  return (
    <div className={`timeline ${stale ? "timeline-stale" : ""}`}>
      {STEPS.map((s, i) => {
        const state = idx < 0 ? "todo" : i < idx ? "done" : i === idx ? "now" : "todo";
        const ev = reachedAt(s.phase) ?? (s.phase === "APOGEE" ? events.find((e) => e.from_phase === "COAST" && e.to_phase === "DROGUE") : undefined);
        return (
          <div key={s.phase} className={`tl-step tl-${state}`}>
            <div className="tl-bar" />
            <div className="tl-dot" />
            <div className="tl-label">{s.label}</div>
            <div className="tl-time mono">{ev ? (ev.flight_time_s != null ? fmtTime(ev.flight_time_s) : new Date(ev.received_at_utc).toISOString().slice(11, 19) + "Z") : " "}</div>
          </div>
        );
      })}
    </div>
  );
}
