import type { RocketModel } from "../rocket";
import type { Phase } from "../types";
import { fmt, M_TO_FT } from "../format";

const LABELLED = /avionics|airbrake|parachute|payload|recovery/i;

/** Side view drawn from the OpenRocket file. Highlights what should be happening for the current phase. */
export function RocketProfile({
  rocket,
  phase,
  maxAltitudeM,
}: {
  rocket: RocketModel | null;
  phase: Phase | null;
  maxAltitudeM: number | null;
}) {
  if (!rocket) {
    return (
      <div className="panel rocket-panel">
        <div className="panel-title">Vehicle</div>
        <div className="dim small">No OpenRocket file loaded.</div>
      </div>
    );
  }

  const L = rocket.length_m;
  const R = rocket.diameter_m / 2;
  const finSpan = Math.max(R, ...rocket.fins.flatMap((f) => f.polygon.map((p) => p[1])));
  const padX = L * 0.06;
  const flame = phase === "BOOST";
  const chutes = phase === "DROGUE" || phase === "MAIN" || phase === "LANDED";
  const vbW = L + padX * 2 + (flame ? 0 : 0);
  const vbH = finSpan * 2 * 1.9;
  const cy = vbH / 2;

  const top = rocket.outline.map(([x, r]) => `${x + padX},${cy - r}`).join(" ");
  const bottom = [...rocket.outline].reverse().map(([x, r]) => `${x + padX},${cy + r}`).join(" ");
  const finPath = (poly: [number, number][], sign: 1 | -1) => poly.map(([x, y]) => `${x + padX},${cy + sign * y}`).join(" ");

  const internals = rocket.internals.filter((i) => LABELLED.test(i.name) && i.length > 0);
  const pred = rocket.predicted;
  const predApogee = pred?.max_altitude_m ?? null;
  const pct = predApogee && maxAltitudeM != null ? (100 * maxAltitudeM) / predApogee : null;

  return (
    <div className="panel rocket-panel">
      <div className="panel-title">
        Vehicle <span className="dim">· {rocket.source_file}</span>
      </div>
      <svg className="rocket-svg" viewBox={`0 0 ${vbW} ${vbH}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${rocket.name} side view`}>
        {/* flame during boost */}
        {flame && (
          <polygon
            className="flame"
            points={`${L + padX},${cy - R * 0.7} ${L + padX + padX * 0.95},${cy} ${L + padX},${cy + R * 0.7}`}
          />
        )}
        {rocket.fins.map((f, i) => (
          <g key={i} className="fin">
            <polygon points={finPath(f.polygon, -1)} />
            <polygon points={finPath(f.polygon, 1)} />
          </g>
        ))}
        <polygon className="body" points={`${top} ${bottom}`} />
        {/* nose cone in brand gold */}
        {rocket.sections[0]?.kind === "nosecone" && (
          <polygon
            className="nose"
            points={
              rocket.outline
                .filter(([x]) => x <= rocket.sections[0].length + 1e-6)
                .map(([x, r]) => `${x + padX},${cy - r}`)
                .join(" ") +
              " " +
              rocket.outline
                .filter(([x]) => x <= rocket.sections[0].length + 1e-6)
                .reverse()
                .map(([x, r]) => `${x + padX},${cy + r}`)
                .join(" ")
            }
          />
        )}
        {rocket.sections.slice(1).map((s) => (
          <line key={s.name + s.x} className="joint" x1={s.x + padX} x2={s.x + padX} y1={cy - R} y2={cy + R} />
        ))}
        {internals.map((it, i) => {
          const isChute = /parachute/i.test(it.name);
          const cls = isChute ? (chutes ? "internal chute-active" : "internal chute") : "internal";
          const above = i % 2 === 0;
          const labelY = above ? cy - finSpan * 1.25 : cy + finSpan * 1.25;
          return (
            <g key={it.name + it.x}>
              <rect className={cls} x={it.x + padX} y={cy - R * 0.72} width={it.length} height={R * 1.44} rx={R * 0.15} />
              <line className="leader" x1={it.x + padX + it.length / 2} x2={it.x + padX + it.length / 2} y1={above ? cy - R : cy + R} y2={labelY + (above ? R * 0.25 : -R * 0.55)} />
              <text className="rk-label" x={it.x + padX + it.length / 2} y={labelY} textAnchor="middle" fontSize={R * 0.62}>
                {it.name}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="rocket-stats">
        <span>
          <b>Predicted apogee</b> {predApogee != null ? `${fmt(predApogee)} m (${fmt(predApogee * M_TO_FT)} ft)` : "—"}
          {pred?.time_to_apogee_s != null && <span className="dim"> @ T+{fmt(pred.time_to_apogee_s, 1)} s</span>}
        </span>
        <span>
          <b>Max V</b> {pred?.max_velocity_mps != null ? `${fmt(pred.max_velocity_mps)} m/s · M${fmt(pred.max_mach, 2)}` : "—"}
        </span>
        <span>
          <b>Live max alt</b> {maxAltitudeM != null ? `${fmt(maxAltitudeM)} m` : "—"}
          {pct != null && <span className="dim"> · {fmt(pct)}% of predicted</span>}
        </span>
        <span className="dim small">Prediction = OpenRocket "{pred?.simulation ?? "—"}", reference only</span>
      </div>
    </div>
  );
}
