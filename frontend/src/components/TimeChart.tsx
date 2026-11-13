import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

export interface ChartSeries {
  label: string;
  color: string;
  x: number[];
  y: (number | null)[];
  dashed?: boolean;
}

interface Props {
  title: string;
  unit: string;
  series: ChartSeries[];
  version: number;
}

const AXIS = { stroke: "#93a3c3", grid: { stroke: "rgba(147,163,195,0.12)" }, ticks: { stroke: "rgba(147,163,195,0.2)" } };

/**
 * Fast canvas time-series (uPlot). Series may have different x values (e.g. live data and the
 * OpenRocket prediction); they are merged on a shared axis. Gaps (null) are breaks, never zero.
 */
export function TimeChart({ title, unit, series, version }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const shape = series.map((s) => `${s.label}|${s.color}|${s.dashed ? 1 : 0}`).join(",");

  useEffect(() => {
    const el = host.current!;
    const opts: uPlot.Options = {
      width: el.clientWidth,
      height: Math.max(120, el.clientHeight),
      legend: { show: false },
      cursor: { show: false },
      scales: { x: { time: false } },
      axes: [
        { ...AXIS, label: "time (s)", labelSize: 18, size: 36 },
        { ...AXIS, size: 58 },
      ],
      series: [
        {},
        ...series.map((s) => ({
          label: s.label,
          stroke: s.color,
          width: s.dashed ? 1.5 : 2.2,
          dash: s.dashed ? [6, 5] : undefined,
          spanGaps: !!s.dashed,
        })),
      ],
    };
    plot.current = new uPlot(opts, [[]], el);
    const ro = new ResizeObserver(() => {
      plot.current?.setSize({ width: el.clientWidth, height: Math.max(120, el.clientHeight) });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      plot.current?.destroy();
      plot.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);

  useEffect(() => {
    if (!plot.current) return;
    const tables = series.map((s) => [s.x, s.y as number[]] as uPlot.AlignedData);
    const data = tables.length === 1 ? tables[0] : uPlot.join(tables);
    plot.current.setData(data as uPlot.AlignedData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, shape]);

  return (
    <div className="panel chart-panel">
      <div className="panel-title chart-title">
        <span>
          {title} <span className="unit">({unit})</span>
        </span>
        <span className="legend">
          {series.map((s) => (
            <span key={s.label} className="legend-item">
              <span className={`legend-swatch ${s.dashed ? "dashed" : ""}`} style={{ borderColor: s.color, background: s.dashed ? "transparent" : s.color }} />
              {s.label}
            </span>
          ))}
        </span>
      </div>
      <div className="chart-host" ref={host} />
    </div>
  );
}
