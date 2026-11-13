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
