// Small inline stroke icons (no icon font / CDN, so the HUD works offline at the launch site).
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function I({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...P}>
      <path d={d} />
    </svg>
  );
}

export const Icon = {
  home: (s?: number) => <I size={s} d="M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10" />,
  pulse: (s?: number) => <I size={s} d="M3 12h4l2-5 4 10 2-5h6" />,
  pin: (s?: number) => <I size={s} d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />,
  shield: (s?: number) => <I size={s} d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Zm-3 9 2 2 4-4" />,
  list: (s?: number) => <I size={s} d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />,
  db: (s?: number) => <I size={s} d="M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />,
  gear: (s?: number) => <I size={s} d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z" />,
  rocket: (s?: number) => <I size={s} d="M14 4c3-1 6-1 6-1s0 3-1 6l-6 6-4-4 5-7Zm-5 7-4 1-2 3 4 1m6 2-1 4 3-2 1-4m-8 0-2 4 4-2" />,
  mountain: (s?: number) => <I size={s} d="m3 19 6-10 4 6 3-4 5 8H3Z" />,
  gauge: (s?: number) => <I size={s} d="M4 16a8 8 0 1 1 16 0M12 16l4-5" />,
  bolt: (s?: number) => <I size={s} d="M3 12h4l3-7 4 14 3-7h4" />,
  trophy: (s?: number) => <I size={s} d="M8 4h8v5a4 4 0 0 1-8 0V4Zm0 2H4a3 3 0 0 0 4 4m8-4h4a3 3 0 0 1-4 4M12 13v4m-4 3h8" />,
  clock: (s?: number) => <I size={s} d="M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm0-12v4l3 2M9 2h6" />,
  thermo: (s?: number) => <I size={s} d="M10 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0Z" />,
  arrows: (s?: number) => <I size={s} d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4" />,
  sat: (s?: number) => <I size={s} d="m13 7 4 4m-9 1 4 4M6 10l4-4 8 8-4 4-8-8Zm9 9a4 4 0 0 0 4-4m-1 6a7 7 0 0 0 7-7" />,
  sun: (s?: number) => <I size={s} d="M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-14v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />,
  moon: (s?: number) => <I size={s} d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />,
  antenna: (s?: number) => <I size={s} d="M12 12v9m-4 0h8M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8" />,
  check: (s?: number) => <I size={s} d="m5 12 4 4 10-10" />,
  video: (s?: number) => <I size={s} d="M3 7h12v10H3V7Zm12 3.5 6-3.5v10l-6-3.5" />,
  collapse: (s?: number) => <I size={s} d="M4 5v14M20 12H9m4-4-4 4 4 4" />,
  expand: (s?: number) => <I size={s} d="M4 5v14M9 12h11m-4-4 4 4-4 4" />,
};

export function SignalBars({ level }: { level: number }) {
  return (
    <span className="bars" aria-label={`signal ${level} of 4`}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={i <= level ? "on" : ""} style={{ height: 4 + i * 3 }} />
      ))}
    </span>
  );
}
