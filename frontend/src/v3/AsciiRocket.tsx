import { useEffect, useMemo, useRef } from "react";
import type { RocketModel } from "../rocket";
import { buildPoints, renderFrame } from "./asciiRender";

const PART_CLASS = ["ar-nose", "ar-body", "ar-fin"];
const FPS = 15;
const SPIN = 0.8; // rad/s

/**
 * Decorative spinning ASCII rocket from the OpenRocket outline.
 * Only shown when there is no telemetry (and in Settings), so it never competes with flight data.
 * Writes the <pre> directly instead of re-rendering React each frame; pauses when the tab is hidden
 * and draws a single still frame for prefers-reduced-motion.
 */
export function AsciiRocket({ rocket, cols, rows, className = "" }: { rocket: RocketModel; cols: number; rows: number; className?: string }) {
  const pre = useRef<HTMLPreElement>(null);
  const points = useMemo(() => buildPoints(rocket), [rocket]);

  useEffect(() => {
    const el = pre.current;
    if (!el) return;
    const draw = (roll: number) => {
      const { chars, parts } = renderFrame(points, rocket.length_m, roll, cols, rows);
      let html = "";
      for (let r = 0; r < rows; r++) {
        let last = -1;
        let line = "";
        for (let c = 0; c < cols; c++) {
          const part = chars[r][c] === " " ? -1 : parts[r][c];
          if (part !== last) {
            if (last >= 0) line += "</span>";
            if (part >= 0) line += `<span class="${PART_CLASS[part]}">`;
            last = part;
          }
          line += chars[r][c];
        }
        if (last >= 0) line += "</span>";
        html += line.trimEnd() + "\n";
      }
      el.innerHTML = html;
    };

    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (still) {
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
      draw(((now - start) / 1000) * SPIN);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [points, rocket.length_m, cols, rows]);

  return <pre ref={pre} className={`ascii-rocket ${className}`} aria-label={`${rocket.name}, ASCII art`} role="img" />;
}
