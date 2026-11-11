export const M_TO_FT = 3.28084;

/** Display states for a value. "NO DATA" (null) is never shown as 0. */
export type ValueState = "ok" | "stale" | "nodata";

export function fmt(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const r = Number(v.toFixed(digits)) || 0; // turns -0 into 0
  return r.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtTime(s: number | null | undefined): string {
  if (s === null || s === undefined) return "—";
  const sign = s < 0 ? "-" : "";
  const a = Math.abs(s);
  const m = Math.floor(a / 60);
  const sec = a - m * 60;
  return `${sign}T+${String(m).padStart(2, "0")}:${sec.toFixed(1).padStart(4, "0")}`;
}

export function fmtClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toISOString().slice(11, 19) + "Z";
}
