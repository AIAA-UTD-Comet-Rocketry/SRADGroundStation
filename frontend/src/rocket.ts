import { useEffect, useState } from "react";

// Mirrors backend/ground_station/rocket_model.py RocketModel.to_json()
export interface RocketModel {
  name: string;
  source_file: string;
  length_m: number;
  diameter_m: number;
  outline: [number, number][];
  fins: { name: string; count: number; polygon: [number, number][] }[];
  sections: { name: string; kind: string; x: number; length: number }[];
  internals: { name: string; kind: string; x: number; length: number }[];
  motor: string | null;
  predicted: {
    simulation: string;
    t: number[];
    altitude_m: number[];
    vertical_velocity_mps: number[];
    east_m: (number | null)[];
    north_m: (number | null)[];
    events: { type: string; t: number }[];
    max_altitude_m: number | null;
    max_velocity_mps: number | null;
    max_mach: number | null;
    time_to_apogee_s: number | null;
    flight_time_s: number | null;
    ground_hit_velocity_mps: number | null;
  } | null;
}

export function useRocket(): RocketModel | null {
  const [rocket, setRocket] = useState<RocketModel | null>(null);
  useEffect(() => {
    fetch("/api/rocket")
      .then((r) => (r.ok ? r.json() : null))
      .then(setRocket)
      .catch(() => setRocket(null));
  }, []);
  return rocket;
}

/** Team, vehicle and motor info from the [mission] config section (GET /api/mission). */
export interface MissionInfo {
  team_name: string;
  university: string;
  competition: string;
  team_id: number | null;
  category: string;
  vehicle: string;
  motor: string;
  motor_type: string;
  oxidizer: string;
  fuel: string;
}

export function useMission(): MissionInfo | null {
  const [mission, setMission] = useState<MissionInfo | null>(null);
  useEffect(() => {
    fetch("/api/mission")
      .then((r) => (r.ok ? r.json() : null))
      .then(setMission)
      .catch(() => setMission(null));
  }, []);
  return mission;
}

/** "IREC 2027 · Team 1100 · 10K Liquid" (skips parts that aren't set). */
export function teamLine(m: MissionInfo | null): string | null {
  if (!m) return null;
  return [m.competition, m.team_id != null ? `Team ${m.team_id}` : "", m.category].filter(Boolean).join(" · ");
}

/** "N2O / IPA" short propellant label. */
export function propellants(m: MissionInfo): string {
  const short = (s: string) => s.match(/\(([^)]+)\)/)?.[1] ?? s;
  return [m.oxidizer, m.fuel].filter(Boolean).map(short).join(" / ");
}
