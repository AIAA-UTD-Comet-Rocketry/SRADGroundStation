import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";
export type Units = "imperial" | "metric";
export type SidebarState = "expanded" | "collapsed";

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    if (v && (allowed as readonly string[]).includes(v)) return v as T;
  } catch {
    /* storage blocked: use default */
  }
  return fallback;
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/** Per-viewer display preferences (theme, units, sidebar). Never affects recorded data. */
export function usePrefs() {
  const systemDark = typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
  const [theme, setThemeState] = useState<Theme>(() => read("gs.theme", ["light", "dark"] as const, systemDark ? "dark" : "light"));
  const [units, setUnitsState] = useState<Units>(() => read("gs.units", ["imperial", "metric"] as const, "imperial"));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    write("gs.theme", t);
  }, []);
  const setUnits = useCallback((u: Units) => {
    setUnitsState(u);
    write("gs.units", u);
  }, []);
  const [sidebar, setSidebarState] = useState<SidebarState>(() => read("gs.sidebar", ["expanded", "collapsed"] as const, "expanded"));
  const setSidebar = useCallback((s: SidebarState) => {
    setSidebarState(s);
    write("gs.sidebar", s);
  }, []);
  return { theme, setTheme, units, setUnits, sidebar, setSidebar };
}

// ------------------------------------------------------------------ units
const M_TO_FT = 3.28084;
const G0 = 9.80665;

export interface UnitFmt {
  alt: (m: number | null | undefined) => number | null;
  altUnit: string;
  vel: (mps: number | null | undefined) => number | null;
  velUnit: string;
  dist: (m: number | null | undefined) => number | null;
  distUnit: string;
  temp: (c: number | null | undefined) => number | null;
  tempUnit: string;
  pressure: (pa: number | null | undefined) => number | null;
  pressureUnit: string;
  g: (mps2: number | null | undefined) => number | null;
}

const nn = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? null : v);

export function unitFmt(units: Units): UnitFmt {
  const imp = units === "imperial";
  return {
    alt: (m) => (nn(m) == null ? null : imp ? (m as number) * M_TO_FT : (m as number)),
    altUnit: imp ? "ft" : "m",
    vel: (v) => (nn(v) == null ? null : imp ? (v as number) * M_TO_FT : (v as number)),
    velUnit: imp ? "ft/s" : "m/s",
    dist: (m) => (nn(m) == null ? null : imp ? (m as number) / 1609.344 : (m as number) / 1000),
    distUnit: imp ? "mi" : "km",
    temp: (c) => (nn(c) == null ? null : imp ? (c as number) * 1.8 + 32 : (c as number)),
    tempUnit: imp ? "°F" : "°C",
    pressure: (pa) => (nn(pa) == null ? null : imp ? (pa as number) / 6894.757 : (pa as number) / 1000),
    pressureUnit: imp ? "psi" : "kPa",
    g: (a) => (nn(a) == null ? null : (a as number) / G0),
  };
}
