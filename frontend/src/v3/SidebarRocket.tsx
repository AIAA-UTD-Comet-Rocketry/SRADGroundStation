import { useEffect, useMemo, useRef } from "react";
import type { RocketModel } from "../rocket";
import { PART_FIN, buildPoints, renderFrame } from "./asciiRender";

/*
 * Small decorative ASCII rocket for the empty space in the sidebar: our rocket (shape from the
 * .ork), standing nose-up and slowly rolling a full 360°, with a flame under it and a few stars.
 * Same colours as the About-page scene: white top half, green bottom half, orange fins.
 * It sizes itself to the free space (smaller when the sidebar is collapsed) and hides when
 * there isn't room.
 */

const FPS = 12;
const SPIN = 0.9; // rad/s
const MAX_H = { expanded: 300, collapsed: 230 }; // px: fill the gap without dominating it
const CELL_W = { expanded: 3.2, collapsed: 2.5 }; // px per character column (small = more detail)
const TAIL_FRAC = 0.32; // flame room under the rocket, as a fraction of its length
const MIN_ROWS = 34;
const RADIAL = 3.2; // extra-wide so it reads as a rocket at this small size (purely cosmetic)

const C = {
  white: ["#64748b", "#94a3b8", "#cbd5e1", "#e2e8f0", "#ffffff"],
  chrome: ["#334155", "#64748b", "#94a3b8", "#bfdbfe", "#e0f2fe"], // cool steel-blue silver
  glint: "#ffffff",
  green: ["#14532d", "#166534", "#15803d", "#22c55e", "#4ade80"],
  fin: ["#9a3412", "#c2410c", "#ea580c", "#f97316", "#fdba74"],
  flame: ["#fff3b0", "#fde047", "#fb923c", "#ef4444"],
  star: ["#334155", "#64748b", "#cbd5e1"],
};

const FIN_GROW = { chord: 2.3, span: 1.5 };
const TIP_FRAC = 0.4; // chrome covers this much of the nose cone, from the point down

/**
 * The .ork fin is a plain trapezoid, which reads as a square block at this size. For the sidebar
 * we draw a classic swept fin instead: a curved leading edge sweeping back to a narrow tip and a
 * gently curved trailing edge, on the same root chord and span. Strakes (tiny span) are left as is.
 */
function sweptFins(rocket: RocketModel): RocketModel {
  const bodyR = Math.max(...rocket.outline.map((p) => p[1]));
  const fins = rocket.fins.map((fin) => {
    const xs = fin.polygon.map((p) => p[0]);
    const span = Math.max(...fin.polygon.map((p) => p[1])) - bodyR;
    if (span < 0.02) return fin;
    // Real fins are only ~7% of the length, a couple of characters here. Draw them bigger (classic
    // cartoon-rocket proportions) so the swept shape can show; the trailing edge stays at the same place.
    const rootEnd = Math.max(...xs);
    const chord = (rootEnd - Math.min(...xs)) * FIN_GROW.chord;
    const x0 = rootEnd - chord;
    const tall = span * FIN_GROW.span;
    const n = 14;
    const lead: [number, number][] = [];
    const trail: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      lead.push([x0 + chord * 0.7 * t * t, bodyR + tall * t]); // sweeps back, faster near the tip
      trail.push([x0 + chord - chord * 0.15 * t * t, bodyR + tall * t]); // tip chord ~15% of root
    }
    return { ...fin, polygon: [...lead, ...trail.reverse()] };
  });
  return { ...rocket, fins };
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

export function SidebarRocket({ rocket, collapsed }: { rocket: RocketModel; collapsed: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const points = useMemo(() => buildPoints(sweptFins(rocket), 160, 16, RADIAL), [rocket]);
  const mode = collapsed ? "collapsed" : "expanded";

  useEffect(() => {
    const box = wrap.current;
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!box || !cv || !ctx) return;

    const cw = CELL_W[mode];
    const ch = cw * 2;
    let cols = 0;
    let rows = 0;
    let stars: { c: number; r: number; ph: number; sp: number }[] = [];

    const resize = () => {
      const w = box.clientWidth;
      const h = Math.min(box.clientHeight, MAX_H[mode]);
      cols = Math.floor(w / cw);
      rows = Math.floor(h / ch);
      const show = rows >= MIN_ROWS && cols >= 10;
      cv.style.display = show ? "block" : "none";
      if (!show) return;
      const dpr = window.devicePixelRatio || 1;
      cv.style.width = `${cols * cw}px`;
      cv.style.height = `${rows * ch}px`;
      cv.width = Math.round(cols * cw * dpr);
      cv.height = Math.round(rows * ch * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const r = rng(3);
      stars = Array.from({ length: Math.round((cols * rows) / 45) }, () => ({ c: Math.floor(r() * cols), r: Math.floor(r() * rows), ph: r() * 6.28, sp: 0.7 + r() * 2 }));
    };

    const flick = rng(17);
    const L = rocket.length_m;
    const tail = L * TAIL_FRAC;
    const nozzle = Math.max(...rocket.outline.map((p) => p[1])) * RADIAL * 0.8;

    const draw = (t: number) => {
      if (rows < MIN_ROWS) return;
      const { chars, parts, cell } = renderFrame(points, L, t * SPIN, cols, rows, { tail });
      const color: (string | null)[][] = chars.map((row) => row.map(() => null));
      const midRow = cell(0, 0)[1]; // rows below the rocket's middle are the green (aft) half
      const noseLen = rocket.sections[0]?.kind === "nosecone" ? rocket.sections[0].length : L * 0.2;
      const tipRow = cell(L / 2 - noseLen * TIP_FRAC, 0)[1]; // rows above this are the chrome tip
      const noseRow = cell(L / 2, 0)[1];
      const glintRow = noseRow + ((t * 6) % (tipRow - noseRow + 8)); // a highlight sliding down the tip
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const chr = chars[r][c];
          if (chr === " ") continue;
          const lvl = Math.min(4, Math.max(0, (" .:-=+*#%@".indexOf(chr) - 1) >> 1)); // shade -> palette step
          if (parts[r][c] !== PART_FIN && r <= tipRow) {
            const glint = Math.abs(r - glintRow) < 0.75;
            color[r][c] = glint ? C.glint : C.chrome[lvl];
            continue;
          }
          color[r][c] = (parts[r][c] === PART_FIN ? C.fin : r > midRow ? C.green : C.white)[lvl];
        }
      }
      // flame out of the tail (straight down), flickering
      const flameLen = tail * (0.75 + 0.2 * Math.sin(t * 21) * Math.sin(t * 6.3));
      const step = 0.5 / (rows / (L + tail));
      for (let d = 0; d < flameLen; d += step) {
        const k = d / flameLen;
        const w = nozzle * (1 + 0.5 * Math.sin(Math.PI * Math.min(1, k * 1.6))) * (1 - k ** 1.7) + 0.01;
        for (let u = -w; u <= w; u += step / 2) {
          const heat = 1 - k - 0.35 * Math.abs(u / w) + 0.3 * (flick() - 0.5);
          if (heat < 0.06) continue;
          const [c, r] = cell(-L / 2 - d, u);
          if (r < 0 || r >= rows || c < 0 || c >= cols || chars[r][c] !== " ") continue;
          const lvl = heat > 0.7 ? 0 : heat > 0.45 ? 1 : heat > 0.22 ? 2 : 3;
          chars[r][c] = "@#*:"[lvl];
          color[r][c] = C.flame[lvl];
        }
      }
      // twinkling stars in the empty cells
      for (const s of stars) {
        if (chars[s.r]?.[s.c] !== " ") continue;
        const tw = Math.sin(t * s.sp + s.ph);
        chars[s.r][s.c] = tw > 0.8 ? "*" : tw > 0.1 ? "+" : ".";
        color[s.r][s.c] = C.star[tw > 0.8 ? 2 : tw > 0.1 ? 1 : 0];
      }

      ctx.clearRect(0, 0, cols * cw, rows * ch);
      ctx.font = `700 ${ch * 0.9}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.textBaseline = "top";
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const col = color[r][c];
          if (!col) continue;
          ctx.fillStyle = col;
          ctx.fillText(chars[r][c], c * cw, r * ch);
        }
      }
    };

    let still: (() => void) | null = null;
    const ro = new ResizeObserver(() => {
      resize();
      still?.();
    });
    ro.observe(box);
    resize();

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      still = () => draw(0.8);
      still();
      return () => ro.disconnect();
    }
    let raf = 0;
    let last = 0;
    const start = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden || now - last < 1000 / FPS) return;
      last = now;
      draw((now - start) / 1000);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [points, rocket, mode]);

  return (
    <div ref={wrap} className="side-art" aria-hidden>
      <canvas ref={canvas} />
    </div>
  );
}
