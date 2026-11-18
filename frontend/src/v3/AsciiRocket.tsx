import { useEffect, useMemo, useRef } from "react";
import type { RocketModel } from "../rocket";
import { RADIAL_SCALE, buildPoints, renderFrame } from "./asciiRender";

// Cell classes. 0..2 match PART_NOSE/BODY/FIN from the renderer.
const CLS = ["ar-nose", "ar-body", "ar-fin", "ar-f1", "ar-f2", "ar-f3", "ar-star", "ar-m-flame", "ar-m-body"];
const F1 = 3, F2 = 4, F3 = 5, STAR = 6, M_FLAME = 7, M_BODY = 8; // prettier-ignore

const FPS = 15;
const SPIN = 0.8; // roll, rad/s
const TILT = Math.PI / 4; // 45°, climbing to the upper right
const TAIL_FRAC = 0.42; // flame room behind the tail, as a fraction of rocket length

// Temoc (UT Dallas' mascot), hand-drawn fan sketch. Rows starting the flame are animated.
const TEMOC = [
  "    ( )  ( )   ",
  "   ) ( )( ) (  ",
  "  ( ) ( )( ) ) ",
  "   \\_________/ ",
  "   |  \\   /  | ",
  "   |  (o) (o)| ",
  "   |    ^    | ",
  "    \\  \\_/  /  ",
  "     '-----'   ",
  "   ___|   |___ ",
  "  /  | UTD |  \\",
  " /_/ |_____| \\_\\",
  "     |  |  |   ",
  "     |__|__|   ",
];
const TEMOC_FLAME_ROWS = 3;
const FLAME_CHARS = "()^'`";

/** Small seeded PRNG so stars land in the same places every load. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

/**
 * Decorative ASCII scene for Configuration → About: the rocket (from the OpenRocket outline)
 * climbing at 45° with a flame, drifting stars, and Temoc watching from the corner.
 * Writes the <pre> directly instead of re-rendering React each frame; pauses when the tab is
 * hidden and draws one still frame for prefers-reduced-motion.
 */
export function AsciiRocket({ rocket, cols, rows, className = "" }: { rocket: RocketModel; cols: number; rows: number; className?: string }) {
  const pre = useRef<HTMLPreElement>(null);
  const points = useMemo(() => buildPoints(rocket, 360, 34), [rocket]);
  const stars = useMemo(() => {
    const r = rng(7);
    return Array.from({ length: Math.round((cols * rows) / 55) }, () => ({ c: r() * cols, r: r() * rows, ph: r() * 6.28, sp: 1 + r() * 3 }));
  }, [cols, rows]);

  useEffect(() => {
    const el = pre.current;
    if (!el) return;
    const L = rocket.length_m;
    const tail = L * TAIL_FRAC;
    const nozzle = Math.max(...rocket.outline.map((p) => p[1])) * RADIAL_SCALE;
    const mTop = rows - TEMOC.length;
    const mLeft = cols - Math.max(...TEMOC.map((l) => l.length)) - 1;
    const flick = rng(99);

    const draw = (t: number) => {
      const { chars, parts, cell, scale } = renderFrame(points, L, t * SPIN, cols, rows, { tilt: TILT, tail });
      const put = (col: number, row: number, ch: string, cls: number) => {
        if (row >= 0 && row < rows && col >= 0 && col < cols && chars[row][col] === " ") {
          chars[row][col] = ch;
          parts[row][col] = cls;
        }
      };

      // Temoc, bottom-right corner (drawn first so the flame and stars never cover him)
      TEMOC.forEach((line, i) => {
        for (let j = 0; j < line.length; j++) {
          if (line[j] === " ") continue;
          const flame = i < TEMOC_FLAME_ROWS;
          const ch = flame && flick() < 0.25 ? FLAME_CHARS[Math.floor(flick() * FLAME_CHARS.length)] : line[j];
          put(mLeft + j, mTop + i, ch, flame ? M_FLAME : M_BODY);
        }
      });

      // exhaust: hottest at the nozzle, narrowing and cooling with distance
      const flameLen = tail * (0.85 + 0.15 * Math.sin(t * 23) * Math.sin(t * 7));
      const ds = 1 / (scale * 2.2);
      for (let d = 0; d < flameLen; d += ds) {
        const k = d / flameLen;
        // plume bulges just past the nozzle, then tapers
        const w = nozzle * (1 + 0.8 * Math.sin(Math.PI * Math.min(1, k * 1.6))) * (1 - k ** 1.8) * (1 + 0.25 * (flick() - 0.5)) + 0.02;
        for (let u = -w; u <= w; u += ds) {
          const heat = 1 - k - 0.35 * Math.abs(u / w) + 0.25 * (flick() - 0.5);
          if (heat < 0.05) continue;
          const [c, r] = cell(-L / 2 - d, u);
          if (heat > 0.75) put(c, r, "@", F1);
          else if (heat > 0.55) put(c, r, "#", F1);
          else if (heat > 0.4) put(c, r, "*", F2);
          else if (heat > 0.25) put(c, r, "+", F2);
          else if (heat > 0.13) put(c, r, ":", F3);
          else put(c, r, ".", F3);
        }
      }
      // a few sparks trailing the plume
      for (let n = 0; n < 6; n++) {
        const [c, r] = cell(-L / 2 - flameLen * (0.8 + flick() * 0.6), (flick() - 0.5) * nozzle * 3);
        put(c, r, flick() < 0.5 ? "'" : ".", F3);
      }

      // stars drift opposite the direction of flight and twinkle
      const vc = -Math.sin(TILT) * 2 * 1.2 * t;
      const vr = Math.cos(TILT) * 1.2 * t;
      for (const s of stars) {
        const c = Math.floor((((s.c + vc) % cols) + cols) % cols);
        const r = Math.floor((((s.r + vr) % rows) + rows) % rows);
        if (r >= mTop - 1 && c >= mLeft - 1) continue; // keep Temoc's corner clear
        const tw = Math.sin(t * s.sp + s.ph);
        put(c, r, tw > 0.85 ? "*" : tw > 0.3 ? "+" : ".", STAR);
      }

      let html = "";
      for (let r = 0; r < rows; r++) {
        let last = -1;
        let line = "";
        for (let c = 0; c < cols; c++) {
          const part = chars[r][c] === " " ? -1 : parts[r][c];
          if (part !== last) {
            if (last >= 0) line += "</span>";
            if (part >= 0) line += `<span class="${CLS[part]}">`;
            last = part;
          }
          const ch = chars[r][c];
          line += ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === "&" ? "&amp;" : ch;
        }
        if (last >= 0) line += "</span>";
        html += line.trimEnd() + "\n";
      }
      el.innerHTML = html;
    };

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      draw(0.6);
      return;
    }
    let raf = 0;
    let lastDraw = 0;
    const start = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden || now - lastDraw < 1000 / FPS) return;
      lastDraw = now;
      draw((now - start) / 1000);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [points, stars, rocket, cols, rows]);

  return <pre ref={pre} className={`ascii-rocket ${className}`} aria-label={`${rocket.name} climbing, with Temoc watching — ASCII art`} role="img" />;
}
