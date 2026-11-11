// Mirrors backend/ground_station/schema.py (schema_version 1, DRAFT). Keep in sync.

export type Mode = "SIMULATION" | "LIVE" | "REPLAY";
export type Phase = "UNKNOWN" | "PAD" | "BOOST" | "COAST" | "DROGUE" | "MAIN" | "LANDED";

export interface FlightData {
  schema_version: number;
  sequence: number;
  flight_time_s: number | null;
  phase: Phase;
  altitude_agl_m: number | null;
  vertical_velocity_mps: number | null;
  acceleration_mps2: number | null;
  latitude_deg: number | null;
  longitude_deg: number | null;
  gps_fix: boolean | null;
  gps_altitude_msl_m: number | null;
  pressure_pa: number | null;
  temperature_c: number | null;
}

export interface TelemetryFrame {
  mode: Mode;
  source: string;
  received_at_utc: string;
  rssi_dbm: number | null;
  snr_db: number | null;
  data: FlightData;
}

export interface FlightEvent {
  received_at_utc: string;
  flight_time_s: number | null;
  sequence: number;
  name: string;
  from_phase: Phase;
  to_phase: Phase;
}

export interface LinkStatus {
  state: "NO_DATA" | "STALE" | "OK";
  received: number;
  missed: number;
  rejected: number;
  sequence_resets: number;
  loss_pct: number | null;
  last_sequence: number | null;
  last_packet_age_s: number | null;
  last_packet_utc: string | null;
  rssi_dbm: number | null;
  snr_db: number | null;
  stale_after_s: number;
}

export interface Status {
  mode: Mode | null;
  source: string | null;
  source_status: Record<string, unknown>;
  source_error: string | null;
  link: LinkStatus;
  recording: { active: boolean; path: string | null; rows: number };
  server_time_utc: string;
}

export type ServerMessage =
  | { type: "snapshot"; status: Status; frames: TelemetryFrame[]; events: FlightEvent[] }
  | { type: "frame"; frame: TelemetryFrame }
  | { type: "event"; event: FlightEvent }
  | { type: "status"; status: Status }
  | { type: "rejected"; received_at_utc: string; reason: string };
