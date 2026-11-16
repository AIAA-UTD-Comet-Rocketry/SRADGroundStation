import { useEffect, useRef, type ReactNode } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { Theme } from "../prefs";
import { Card } from "./cards";
import { fmtMmSs } from "./derive";

interface Line {
  x: number[];
  y: (number | null)[];
}

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

function rgba(hex: string, a: number) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * Live series (solid, area-filled, current point marked) + optional OpenRocket prediction (dashed).
 * Live and predicted have different x values; uPlot.join merges them on one axis.
 * Null values are drawn as gaps, never as zero.
 */
export function FlightChart({
  title,
  icon,
  axisLabel,
  headline,
  live,
  predicted,
  colorVar,
  theme,
  version,
}: {
  title: string;
  icon: ReactNode;
  axisLabel: string;
  headline: string;
  live: Line;
  predicted: Line | null;
  colorVar: string;
  theme: Theme;
  version: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const hasPred = !!predicted && predicted.x.length > 0;

  useEffect(() => {
    const el = host.current!;
    const color = cssVar(colorVar);
    const axis = cssVar("--chart-axis");
    const grid = cssVar("--chart-grid");
    const predColor = cssVar("--pred");
    const opts: uPlot.Options = {
      width: el.clientWidth,
      height: Math.max(140, el.clientHeight),
      legend: { show: false },
      cursor: { show: false },
      scales: { x: { time: false } },
      axes: [
        { stroke: axis, grid: { stroke: grid }, ticks: { stroke: grid }, values: (_u, vals) => vals.map((v) => fmtMmSs(v)), label: "Flight time", labelSize: 20, size: 40, font: "12px Inter, system-ui", labelFont: "12px Inter, system-ui" },
        { stroke: axis, grid: { stroke: grid }, ticks: { stroke: grid }, label: axisLabel, labelSize: 20, size: 64, font: "12px Inter, system-ui", labelFont: "12px Inter, system-ui" },
      ],
      series: [
        {},
        {
          label: "Live",
          stroke: color,
          width: 2.4,
          fill: (u: uPlot) => {
            const g = u.ctx.createLinearGradient(0, u.bbox.top, 0, u.bbox.top + u.bbox.height);
            g.addColorStop(0, rgba(color, 0.35));
            g.addColorStop(1, rgba(color, 0.02));
            return g;
          },
          spanGaps: false,
        },
        ...(hasPred ? [{ label: "Predicted", stroke: predColor, width: 1.6, dash: [7, 6], spanGaps: true }] : []),
      ],
      hooks: {
        draw: [
          (u: uPlot) => {
            const ys = u.data[1];
            let i = ys.length - 1;
            while (i >= 0 && (ys[i] === null || ys[i] === undefined)) i--;
            if (i < 0) return;
            const cx = u.valToPos(u.data[0][i], "x", true);
            const cy = u.valToPos(ys[i] as number, "y", true);
            const ctx = u.ctx;
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, 5 * devicePixelRatio, 0, Math.PI * 2);
            ctx.fillStyle = cssVar("--card");
            ctx.fill();
            ctx.lineWidth = 2.5 * devicePixelRatio;
            ctx.strokeStyle = color;
            ctx.stroke();
            ctx.restore();
          },
        ],
      },
    };
    plot.current = new uPlot(opts, [[]], el);
    const ro = new ResizeObserver(() => plot.current?.setSize({ width: el.clientWidth, height: Math.max(140, el.clientHeight) }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      plot.current?.destroy();
      plot.current = null;
    };
  }, [theme, hasPred, colorVar, axisLabel]);

  useEffect(() => {
    if (!plot.current) return;
    const tables: uPlot.AlignedData[] = [[live.x, live.y as number[]]];
    if (hasPred && predicted) tables.push([predicted.x, predicted.y as number[]]);
    plot.current.setData((tables.length === 1 ? tables[0] : uPlot.join(tables)) as uPlot.AlignedData);
  }, [version, theme, hasPred, live, predicted]);

  return (
    <Card
      title={title}
      icon={icon}
      className="chart-card"
      right={
        <div className="chart-right">
          <span className="legend">
            <span className="lg" style={{ borderColor: `var(${colorVar})` }} />
            Live
            {hasPred && (
              <>
                <span className="lg dashed" />
                Predicted
              </>
            )}
          </span>
          <span className="headline" style={{ color: `var(${colorVar})` }}>
            {headline}
          </span>
        </div>
      }
    >
      <div className="chart-host" ref={host} />
    </Card>
  );
}
