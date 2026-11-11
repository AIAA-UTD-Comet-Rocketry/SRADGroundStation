import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

interface Props {
  title: string;
  unit: string;
  color: string;
  x: number[];
  y: (number | null)[];
  version: number;
}

/** Fast canvas time-series (uPlot). Gaps (null) are drawn as breaks, not interpolated through zero. */
export function TimeChart({ title, unit, color, x, y, version }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);

  useEffect(() => {
    const el = host.current!;
    const opts: uPlot.Options = {
      width: el.clientWidth,
      height: Math.max(120, el.clientHeight),
      legend: { show: false },
      cursor: { show: false },
      scales: { x: { time: false } },
      axes: [
        { stroke: "#8b98a9", grid: { stroke: "#1f2a37" }, ticks: { stroke: "#1f2a37" }, label: "time (s)", labelSize: 18, size: 36 },
        { stroke: "#8b98a9", grid: { stroke: "#1f2a37" }, ticks: { stroke: "#1f2a37" }, size: 60 },
      ],
      series: [{}, { label: title, stroke: color, width: 2, spanGaps: false }],
    };
    plot.current = new uPlot(opts, [[], []], el);
    const ro = new ResizeObserver(() => {
      plot.current?.setSize({ width: el.clientWidth, height: Math.max(120, el.clientHeight) });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      plot.current?.destroy();
      plot.current = null;
    };
  }, [title, color]);

  useEffect(() => {
    plot.current?.setData([x, y as number[]]);
  }, [version, x, y]);

  return (
    <div className="panel chart-panel">
      <div className="panel-title">
        {title} <span className="unit">({unit})</span>
      </div>
      <div className="chart-host" ref={host} />
    </div>
  );
}
