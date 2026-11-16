import type { TelemetryFrame } from "../types";

export interface Derived {
  /** chart x (s): flight time, or FC clock when the packet has no flight time */
  x: number[];
  alt: (number | null)[];
  vel: (number | null)[];
  usesFlightTime: boolean;
  /** x-value of liftoff on the same axis, for lining up the OpenRocket prediction */
  liftoffX: number | null;
  maxAltM: number | null;
  /** change over the last ~30 s of received data */
  delta30: { alt: number | null; vel: number | null; acc: number | null };
  /** packets per second over the last 5 s (by ground receive time) */
  packetRate: number | null;
  /** first GPS fix — used as the launch/origin point of the track */
  origin: { lat: number; lon: number } | null;
  /** ground track relative to origin, metres */
  track: { e: number; n: number }[];
  lastFix: { lat: number; lon: number; e: number; n: number; ageS: number | null } | null;
}

const R_EARTH = 6_371_000;

export function toEN(lat: number, lon: number, o: { lat: number; lon: number }) {
  const dLat = ((lat - o.lat) * Math.PI) / 180;
  const dLon = ((lon - o.lon) * Math.PI) / 180;
  return { e: dLon * R_EARTH * Math.cos((o.lat * Math.PI) / 180), n: dLat * R_EARTH };
}

export function accelOf(f: TelemetryFrame | null | undefined): number | null {
  const d = f?.data;
  if (!d) return null;
  return d.acceleration_mps2 ?? d.accel_z_mps2 ?? null;
}

export function derive(frames: TelemetryFrame[], serverTimeIso: string | null): Derived {
  const x: number[] = [];
  const alt: (number | null)[] = [];
  const vel: (number | null)[] = [];
  let liftoffFc: number | null = null;
  let maxAltM: number | null = null;
  let origin: Derived["origin"] = null;
  const track: Derived["track"] = [];
  let lastFixFrame: TelemetryFrame | null = null;
  const usesFlightTime = frames.some((f) => f.data.flight_time_s != null);

  for (const f of frames) {
    const d = f.data;
    if (liftoffFc == null && !usesFlightTime && d.fc_time_s != null && d.phase !== "PAD" && d.phase !== "UNKNOWN") {
      liftoffFc = d.fc_time_s;
    }
    if (d.altitude_agl_m != null) maxAltM = Math.max(maxAltM ?? -Infinity, d.altitude_agl_m);
    if (d.latitude_deg != null && d.longitude_deg != null && d.gps_fix !== false) {
      origin = origin ?? { lat: d.latitude_deg, lon: d.longitude_deg };
      track.push(toEN(d.latitude_deg, d.longitude_deg, origin));
      lastFixFrame = f;
    }
    const t = d.flight_time_s ?? d.fc_time_s;
    if (t == null) continue;
    x.push(t);
    alt.push(d.altitude_agl_m);
    vel.push(d.vertical_velocity_mps);
  }

  // 30 s deltas, measured on the chart's own time axis
  const delta30 = { alt: null as number | null, vel: null as number | null, acc: null as number | null };
  const last = frames.at(-1);
  if (last) {
    const tNow = last.data.flight_time_s ?? last.data.fc_time_s;
    if (tNow != null) {
      const past = frames.find((f) => {
        const t = f.data.flight_time_s ?? f.data.fc_time_s;
        return t != null && tNow - t <= 30;
      });
      if (past && past !== last) {
        const diff = (a: number | null | undefined, b: number | null | undefined) => (a != null && b != null ? a - b : null);
        delta30.alt = diff(last.data.altitude_agl_m, past.data.altitude_agl_m);
        delta30.vel = diff(last.data.vertical_velocity_mps, past.data.vertical_velocity_mps);
        delta30.acc = diff(accelOf(last), accelOf(past));
      }
    }
  }

  // packet rate by ground receive time
  let packetRate: number | null = null;
  if (frames.length > 1 && serverTimeIso) {
    const now = Date.parse(serverTimeIso);
    let n = 0;
    for (let i = frames.length - 1; i >= 0; i--) {
      if (now - Date.parse(frames[i].received_at_utc) > 5000) break;
      n++;
    }
    packetRate = n / 5;
  }

  let lastFix: Derived["lastFix"] = null;
  if (lastFixFrame && origin) {
    const d = lastFixFrame.data;
    const en = toEN(d.latitude_deg!, d.longitude_deg!, origin);
    lastFix = {
      lat: d.latitude_deg!,
      lon: d.longitude_deg!,
      ...en,
      ageS: serverTimeIso ? Math.max(0, (Date.parse(serverTimeIso) - Date.parse(lastFixFrame.received_at_utc)) / 1000) : null,
    };
  }

  return {
    x,
    alt,
    vel,
    usesFlightTime,
    liftoffX: usesFlightTime ? 0 : liftoffFc,
    maxAltM,
    delta30,
    packetRate,
    origin,
    track,
    lastFix,
  };
}

export function fmtMmSs(s: number | null | undefined): string {
  if (s == null) return "--:--";
  const sign = s < 0 ? "-" : "";
  const a = Math.abs(s);
  const h = Math.floor(a / 3600);
  const m = Math.floor((a % 3600) / 60);
  const sec = Math.floor(a % 60);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${sign}${h ? `${pad(h)}:` : ""}${pad(m)}:${pad(sec)}`;
}
