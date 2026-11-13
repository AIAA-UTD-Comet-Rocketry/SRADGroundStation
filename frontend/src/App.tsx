import { useMemo } from "react";
import { useTelemetry } from "./useTelemetry";
import { useRocket } from "./rocket";
import type { ValueState } from "./format";
import { TimeChart, type ChartSeries } from "./components/TimeChart";
import { Header } from "./components/Header";
import { Timeline } from "./components/Timeline";
import { RocketProfile } from "./components/RocketProfile";
import { Indicators } from "./components/Indicators";
import { Controls, EventLog, GpsPanel, ImuPanel, LinkPanel, ModeBanner, Readouts, RecordingPanel, VideoPane } from "./components/Panels";

const C = {
  live: "#4fb3ff",
  vel: "#f26a1b",
  predicted: "#f6b526",
};

export default function App() {
  const t = useTelemetry();
  const rocket = useRocket();
  const { frames, version } = t;

  const series = useMemo(() => {
    const x: number[] = [];
    const alt: (number | null)[] = [];
    const vel: (number | null)[] = [];
    let liftoffFc: number | null = null;
    let maxAlt: number | null = null;
    for (const f of frames) {
      const d = f.data;
      if (liftoffFc == null && d.flight_time_s == null && d.fc_time_s != null && d.phase !== "PAD" && d.phase !== "UNKNOWN") {
        liftoffFc = d.fc_time_s;
      }
      if (d.altitude_agl_m != null) maxAlt = Math.max(maxAlt ?? -Infinity, d.altitude_agl_m);
      // Prefer time since liftoff; fall back to the flight computer's clock if that's all the packet has.
      const tt = d.flight_time_s ?? d.fc_time_s;
      if (tt == null) continue;
      x.push(tt);
      alt.push(d.altitude_agl_m);
      vel.push(d.vertical_velocity_mps);
    }
    const usesFlightTime = frames.some((f) => f.data.flight_time_s != null);
    // Line the prediction up with liftoff: t=0 when we have flight time, else the FC clock at liftoff.
    const offset = usesFlightTime ? 0 : liftoffFc;
    return { x, alt, vel, offset, maxAlt };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const pred = rocket?.predicted;
  const showPred = !!pred && series.offset != null && t.status?.mode !== undefined;
  const predX = useMemo(() => (pred && series.offset != null ? pred.t.map((v) => v + (series.offset as number)) : []), [pred, series.offset]);

  const altSeries: ChartSeries[] = [{ label: "Live", color: C.live, x: series.x, y: series.alt }];
  const velSeries: ChartSeries[] = [{ label: "Live", color: C.vel, x: series.x, y: series.vel }];
  if (showPred && pred) {
    altSeries.push({ label: "OpenRocket", color: C.predicted, x: predX, y: pred.altitude_m, dashed: true });
    velSeries.push({ label: "OpenRocket", color: C.predicted, x: predX, y: pred.vertical_velocity_mps, dashed: true });
  }

  const dataState: ValueState =
    !t.latest ? "nodata" : t.socket !== "OPEN" || t.status?.link.state !== "OK" ? "stale" : "ok";

  return (
    <div className="app">
      <Header rocket={rocket} status={t.status} socket={t.socket} latest={t.latest} />
      <ModeBanner status={t.status} socket={t.socket} />
      <Timeline phase={t.latest?.data.phase ?? null} events={t.events} stale={dataState !== "ok"} />
      <main className="grid">
        <section className="col-left">
          <Readouts latest={t.latest} dataState={dataState} />
          <Indicators status={t.status} socket={t.socket} latest={t.latest} rejects={t.rejects} />
        </section>
        <section className="col-center">
          <RocketProfile rocket={rocket} phase={t.latest?.data.phase ?? null} maxAltitudeM={series.maxAlt} />
          <div className="charts">
            <TimeChart title="Altitude AGL" unit="m" series={altSeries} version={version} />
            <TimeChart title="Vertical velocity" unit="m/s" series={velSeries} version={version} />
          </div>
          <div className="bottom">
            <EventLog events={t.events} rejects={t.rejects} />
            <Controls status={t.status} />
          </div>
        </section>
        <aside className="col-right">
          <VideoPane />
          <LinkPanel status={t.status} socket={t.socket} />
          <GpsPanel frames={frames} status={t.status} />
          <ImuPanel latest={t.latest} />
          <RecordingPanel status={t.status} />
        </aside>
      </main>
    </div>
  );
}
