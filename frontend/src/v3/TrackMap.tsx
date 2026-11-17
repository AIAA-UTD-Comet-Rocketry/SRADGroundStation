import type { RocketModel } from "../rocket";
import type { UnitFmt } from "../prefs";
import { fmt } from "../format";
import type { Derived } from "./derive";
import { Card } from "./cards";
import { Icon } from "./icons";

const NICE = [100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];

/**
 * Offline ground-track plot (no map tiles: launch sites rarely have internet).
 * Origin = first GPS fix. Range rings, north up. OpenRocket's predicted drift is dashed.
 */
export function TrackMap({
  derived,
  rocket,
  u,
  big = false,
  isSim,
}: {
  derived: Derived;
  rocket: RocketModel | null;
  u: UnitFmt;
  big?: boolean;
  isSim: boolean;
}) {
  const pred = rocket?.predicted;
  const predPts =
    pred?.east_m
      .map((e, i) => (e != null && pred.north_m[i] != null ? { e, n: pred.north_m[i] as number } : null))
      .filter((p): p is { e: number; n: number } => p !== null) ?? [];
  const showPred = predPts.length > 1 && derived.origin != null;

  const far = Math.max(
    150,
    ...derived.track.map((p) => Math.hypot(p.e, p.n)),
    ...(showPred ? predPts.map((p) => Math.hypot(p.e, p.n)) : []),
  );
  const ring = NICE.find((r) => r * 3 >= far) ?? NICE[NICE.length - 1];
  const extent = ring * 3.3;
  const S = 100; // viewBox half-size
  const px = (m: number) => (m / extent) * S;
  const pt = (p: { e: number; n: number }) => `${px(p.e).toFixed(2)},${(-px(p.n)).toFixed(2)}`;
  const last = derived.lastFix;
  const range = last ? Math.hypot(last.e, last.n) : null;
  const bearing = last ? ((Math.atan2(last.e, last.n) * 180) / Math.PI + 360) % 360 : null;

  return (
    <Card
      title="GPS Tracking"
      icon={Icon.pin()}
      className={`track-card ${big ? "big" : ""}`}
      right={isSim && derived.origin ? <span className="tag">SYNTHETIC POSITION</span> : undefined}
    >
      <div className="track-wrap">
        <svg className="track" viewBox={`${-S} ${-S} ${2 * S} ${2 * S}`} role="img" aria-label="Ground track relative to the launch point">
          <defs>
            <pattern id="tgrid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M10 0H0V10" className="track-gridline" />
            </pattern>
          </defs>
          <rect x={-S} y={-S} width={2 * S} height={2 * S} className="track-bg" />
          <rect x={-S} y={-S} width={2 * S} height={2 * S} fill="url(#tgrid)" />
          {[1, 2, 3].map((k) => (
            <g key={k}>
              <circle r={px(ring * k)} className="track-ring" />
              <text x={px(ring * k) * 0.71 + 2} y={-px(ring * k) * 0.71 - 2} className="track-ring-label">
                {fmt(u.dist(ring * k), ring * k < 1000 ? 2 : 1)} {u.distUnit}
              </text>
            </g>
          ))}
          <line x1={-S} x2={S} y1={0} y2={0} className="track-axis" />
          <line y1={-S} y2={S} x1={0} x2={0} className="track-axis" />
          {showPred && <polyline points={predPts.map(pt).join(" ")} className="track-pred" />}
          {derived.track.length > 1 && <polyline points={derived.track.map(pt).join(" ")} className="track-live" />}
          {derived.origin && <circle r={3.2} className="track-launch" />}
          {last && (
            <g transform={`translate(${px(last.e)},${-px(last.n)})`}>
              <circle r={6} className="track-rocket-halo" />
              <circle r={3.4} className="track-rocket" />
            </g>
          )}
          <g transform={`translate(${S - 12},${-S + 14})`} className="track-north">
            <polygon points="0,-9 4,3 0,0 -4,3" />
            <text y={13} textAnchor="middle">N</text>
          </g>
          {!derived.origin && (
            <text x={0} y={4} textAnchor="middle" className="track-empty">
              No GPS position received
            </text>
          )}
        </svg>
        <div className="track-legend">
          <span>
            <i className="lg-launch" /> Launch (first fix)
          </span>
          <span>
            <i className="lg-rocket" /> Rocket
          </span>
          {showPred && (
            <span>
              <i className="lg-pred" /> OpenRocket drift
            </span>
          )}
        </div>
      </div>
      <div className="track-readout mono">
        <span>Lat {last ? `${fmt(Math.abs(last.lat), 5)}° ${last.lat >= 0 ? "N" : "S"}` : "—"}</span>
        <span>Lon {last ? `${fmt(Math.abs(last.lon), 5)}° ${last.lon >= 0 ? "E" : "W"}` : "—"}</span>
        <span>
          Range {range != null ? `${fmt(u.dist(range), 2)} ${u.distUnit}` : "—"}
          {bearing != null && ` @ ${fmt(bearing)}°`}
        </span>
        <span className={last?.ageS != null && last.ageS > 5 ? "warn-text" : ""}>Fix age {last?.ageS != null ? `${fmt(last.ageS, 1)} s` : "—"}</span>
      </div>
    </Card>
  );
}
