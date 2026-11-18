import { useEffect, useMemo, useRef } from "react";
import type { RocketModel } from "../rocket";
import { RADIAL_SCALE, buildPoints, renderFrame } from "./asciiRender";
import { TEMOC } from "./asciiArt";

// Cell classes. 0..2 match PART_NOSE/BODY/FIN from the renderer; then flame, stars, and Temoc's colours.
const CLS = ["ar-nose", "ar-body", "ar-fin", "ar-f1", "ar-f2", "ar-f3", "ar-star", "ar-t-k", "ar-t-y", "ar-t-o", "ar-t-s", "ar-t-S", "ar-t-w"];
const F1 = 3, F2 = 4, F3 = 5, STAR = 6; // prettier-ignore
const TEMOC_CLS: Record<string, number> = { k: 7, y: 8, o: 9, s: 10, S: 11, w: 12 };

const FPS = 15;
const SPIN = 0.8; // roll, rad/s
const TILT = Math.PI / 4; // 45°, climbing to the upper right
const TAIL_FRAC = 0.42; // flame room behind the tail, as a fraction of rocket length
const HAIR_ROWS = 0.4; // top fraction of Temoc whose flame hair flickers
const HAIR_CHARS = "*#%";

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
    const mTop = rows - TEMOC.chars.length;
    const mLeft = cols - Math.max(...TEMOC.chars.map((l) => l.length)) - 1;
    const hairRows = Math.round(TEMOC.chars.length * HAIR_ROWS);
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
      TEMOC.chars.forEach((line, i) => {
        const keys = TEMOC.keys[i];
        for (let j = 0; j < line.length; j++) {
          const k = keys[j];
          if (line[j] === " " || !k || k === " ") continue;
          const hair = i < hairRows && (k === "y" || k === "o") && flick() < 0.2;
          put(mLeft + j, mTop + i, hair ? HAIR_CHARS[Math.floor(flick() * HAIR_CHARS.length)] : line[j], TEMOC_CLS[k] ?? STAR);
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

/** Static colour ASCII art (generated by scripts/make_ascii_art.py). */
export function AsciiArtBlock({ art, prefix, className = "", label }: { art: { chars: string[]; keys: string[] }; prefix: string; className?: string; label: string }) {
  return (
    <pre className={`ascii-rocket ${className}`} role="img" aria-label={label}>
      {art.chars.map((line, r) => (
        <span key={r}>
          {runs(line, art.keys[r] ?? "").map(([text, k], i) =>
            k === " " ? text : (
              <span key={i} className={`${prefix}${k}`}>
                {text}
              </span>
            ),
          )}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

function runs(line: string, keys: string): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < line.length; i++) {
    const k = line[i] === " " ? " " : (keys[i] ?? " ");
    if (out.length && out[out.length - 1][1] === k) out[out.length - 1][0] += line[i];
    else out.push([line[i], k]);
  }
  return out;
}
