import { useMemo } from "react";
import { useTelemetry } from "./useTelemetry";
import type { ValueState } from "./format";
import { TimeChart } from "./components/TimeChart";
import { Controls, EventLog, GpsPanel, ImuPanel, LinkPanel, ModeBanner, Readouts, RecordingPanel, VideoPane } from "./components/Panels";

export default function App() {
  const t = useTelemetry();
  const { frames, version } = t;

  // Rebuild chart arrays when frames change. Packets with no flight_time are skipped (can't place them on the axis).
  const series = useMemo(() => {
    const x: number[] = [];
    const alt: (number | null)[] = [];
    const vel: (number | null)[] = [];
    for (const f of frames) {
      // Prefer time since liftoff; fall back to the flight computer's clock if that's all the packet has.
      const t = f.data.flight_time_s ?? f.data.fc_time_s;
      if (t == null) continue;
      x.push(t);
      alt.push(f.data.altitude_agl_m);
      vel.push(f.data.vertical_velocity_mps);
    }
    return { x, alt, vel };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const dataState: ValueState =
    !t.latest ? "nodata" : t.socket !== "OPEN" || t.status?.link.state !== "OK" ? "stale" : "ok";

  return (
    <div className="app">
      <ModeBanner status={t.status} socket={t.socket} />
      <main className="grid">
        <section className="left">
          <Readouts latest={t.latest} dataState={dataState} />
          <div className="charts">
            <TimeChart title="Altitude AGL" unit="m" color="#4fc3f7" x={series.x} y={series.alt} version={version} />
            <TimeChart title="Vertical velocity" unit="m/s" color="#ffb74d" x={series.x} y={series.vel} version={version} />
          </div>
          <div className="bottom">
            <EventLog events={t.events} rejects={t.rejects} />
            <Controls status={t.status} />
          </div>
        </section>
        <aside className="right">
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
