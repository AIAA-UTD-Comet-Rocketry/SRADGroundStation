import { useEffect, useMemo, useRef } from "react";
import type { RocketModel } from "../rocket";
import { SHADE, buildPoints, type Pt } from "./asciiRender";
import { TEMOC_RIDER } from "./temocRider";
import { WORLD_MAP } from "./worldMap";

/*
 * The Comet Rocketry logo as a live ASCII scene (Configuration -> About):
 * orange ring with lettering, starry sky, a spinning globe, and our rocket (shape from the .ork)
 * orbiting it with a flame and a fading trail, with Temoc riding along.
 *
 * Everything is characters on a COLS x ROWS grid with a depth buffer, drawn to a <canvas>
 * (faster than rewriting text nodes at this size). Scene maths uses "row units":
 * x right / y up, 1 unit = 1 row = 2 columns, origin at the centre.
 */

const COLS = 160;
const ROWS = 80;
const CX = COLS / 2;
const CY = ROWS / 2;
const FPS = 12;

const R_OUT = 39; // ring outer edge
const R_IN = 29; // ring inner edge
const GLOBE = { x: -5, y: -4, r: 16 };
const GLOBE_SPIN = 0.22; // rad/s
const AXIAL_TILT = 0.4; // north pole tipped toward the viewer
const ORBIT = { a: 21.5, b: 7.5, tilt: (32 * Math.PI) / 180, speed: 0.5 }; // ellipse around the globe
const ROCKET_LEN = 22; // rows
const ROCKET_FAT = 2.3; // extra radial widening on top of the renderer's
const TRAIL_SPAN = 2.6; // radians of orbit the trail covers

// ---- palette (fixed: the scene is a "screen" of space in both themes) ----
const SKY = "#0b1238";
const PAL = [
  "#c2410c", "#ea580c", "#f97316", "#fb923c", // 0-3 ring
  "#f8fafc", // 4 rim / letters
  "#475569", "#cbd5e1", "#ffffff", // 5-7 stars
  "#1e3a8a", "#1d4ed8", "#2563eb", "#3b82f6", "#60a5fa", // 8-12 ocean
  "#14532d", "#15803d", "#22c55e", "#4ade80", // 13-16 land
  "#94a3b8", "#e2e8f0", // 17-18 ice
  "#7dd3fc", // 19 atmosphere
  "#64748b", "#94a3b8", "#cbd5e1", "#e2e8f0", "#ffffff", // 20-24 rocket upper body (white)
  "#9a3412", "#c2410c", "#ea580c", "#f97316", "#fdba74", // 25-29 fins (orange)
  "#fff3b0", "#fde047", "#fb923c", "#ef4444", // 30-33 flame hot -> cool
  "#ffffff", "#e2e8f0", "#94a3b8", "#475569", // 34-37 trail new -> old
  "#facc15", "#f97316", "#d6e7f7", "#93b4d9", "#334155", "#ffffff", // 38-43 Temoc: y o s S k w
  "#14532d", "#166534", "#15803d", "#22c55e", "#4ade80", // 44-48 rocket lower body (green)
  "#7c2d12", // 49 letter backing (unused colour; backing cells are blank)
  "#e0f2fe", "#7dd3fc", "#38bdf8", "#0284c7", // 50-53 comet head -> tail
  "#ef4444", "#dc2626", // 54-55 hair flame tips (red)
]; // prettier-ignore
const C_RIM = 4, C_STAR = 5, C_OCEAN = 8, C_LAND = 13, C_ICE = 17, C_ATMO = 19, C_WHITE = 20, C_FIN = 25, C_FLAME = 30, C_TRAIL = 34, C_GREEN = 44, C_LETTER_BG = 49, C_COMET = 50, C_HAIR_RED = 54; // prettier-ignore
const TEMOC_COL: Record<string, number> = { y: 38, o: 39, s: 40, S: 41, k: 42, w: 43 };

// 5x7 block font for the ring lettering; each "#" is drawn as a 2x1-cell block (square on screen).
const FONT: Record<string, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  "·": [".....", ".....", ".....", "..#..", ".....", ".....", "....."],
};

const TOP_TEXT = "COMET ROCKETRY";
const BOTTOM_TEXT = "AIAA · UTD";
const HAIR_ROWS = 0.45; // top fraction of the rider whose flame hair flickers

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

interface Grid {
  ch: string[];
  col: Int16Array;
  z: Float32Array;
}

export function LogoScene({ rocket }: { rocket: RocketModel }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const points = useMemo(() => buildPoints(rocket, 200, 18), [rocket]);
  const stars = useMemo(() => {
    const r = rng(11);
    const out: { x: number; y: number; ph: number; sp: number }[] = [];
    while (out.length < 170) {
      const x = (r() * 2 - 1) * (COLS / 4);
      const y = (r() * 2 - 1) * (ROWS / 2);
      const d = Math.hypot(x, y);
      if ((d > R_IN - 2 && d < R_OUT + 1.5) || Math.hypot(x - GLOBE.x, y - GLOBE.y) < GLOBE.r + 2) continue;
      out.push({ x, y, ph: r() * 6.28, sp: 0.8 + r() * 2.5 });
    }
    return out;
  }, []);

  useEffect(() => {
    const cv = canvas.current;
    const box = wrap.current;
    if (!cv || !box) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    let cellW = 4;
    const resize = () => {
      const w = Math.min(box.clientWidth, 980);
      cellW = w / COLS;
      const dpr = window.devicePixelRatio || 1;
      cv.style.width = `${w}px`;
      cv.style.height = `${cellW * 2 * ROWS}px`;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(cellW * 2 * ROWS * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    let redrawStill: (() => void) | null = null; // a resized canvas is cleared, so still frames must redraw
    const ro = new ResizeObserver(() => {
      resize();
      redrawStill?.();
    });
    ro.observe(box);

    const topRow = new Int16Array(COLS);
    const grid: Grid = { ch: new Array(COLS * ROWS).fill(" "), col: new Int16Array(COLS * ROWS), z: new Float32Array(COLS * ROWS) };
    const flick = rng(5);
    const L = Math.hypot(...[-0.5, 0.55, 0.67]);
    const LX = -0.5 / L, LY = 0.55 / L, LZ = 0.67 / L; // prettier-ignore
    const kRocket = ROCKET_LEN / rocket.length_m;
    const mid = rocket.length_m / 2;

    const spriteZ = new Float32Array(COLS * ROWS); // rocket / flame / Temoc cells, for their outline
    const put = (X: number, Y: number, ch: string, color: number, z: number, sprite = false) => {
      const c = Math.floor(CX + X * 2);
      const r = Math.floor(CY - Y);
      if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return;
      const i = r * COLS + c;
      if (z <= grid.z[i]) return;
      grid.z[i] = z;
      grid.ch[i] = ch;
      grid.col[i] = color;
      spriteZ[i] = sprite ? z : -1e9;
    };
    const cellCentre = (i: number) => [(i % COLS) + 0.5 - CX, CY - (Math.floor(i / COLS) + 0.5)] as const;

    const orbitAt = (th: number) => {
      const lx = ORBIT.a * Math.cos(th);
      const ly = ORBIT.b * Math.sin(th);
      const ct = Math.cos(ORBIT.tilt), st = Math.sin(ORBIT.tilt); // prettier-ignore
      // far side of the orbit is the upper half of the ellipse; depth relative to the globe centre
      return { x: GLOBE.x + lx * ct - ly * st, y: GLOBE.y + lx * st + ly * ct, z: -Math.sin(th) * GLOBE.r * 1.4 };
    };

    const draw = (t: number) => {
      grid.ch.fill(" ");
      grid.z.fill(-1e9);
      spriteZ.fill(-1e9);

      // ---- ring, rims, sky stars ----
      for (let i = 0; i < COLS * ROWS; i++) {
        const [cx2, y] = cellCentre(i);
        const x = cx2 / 2;
        const d = Math.hypot(x, y);
        if (d > R_OUT) continue;
        if (d > R_OUT - 0.55 || (d < R_IN && d > R_IN - 0.55)) {
          grid.ch[i] = "o";
          grid.col[i] = C_RIM;
          grid.z[i] = -100;
        } else if (d >= R_IN) {
          const shade = 0.5 + 0.5 * ((-x * 0.6 + y * 0.8) / d); // lit from upper left
          grid.ch[i] = "%#*+"[Math.min(3, Math.floor((1 - shade) * 4))];
          grid.col[i] = Math.min(3, Math.floor(shade * 4));
          grid.z[i] = -100;
        }
      }
      const rm = (R_IN + R_OUT) / 2;
      const blockLetter = (chr: string, ang: number) => {
        const glyph = FONT[chr];
        if (!glyph) return;
        const x0 = Math.cos(ang) * rm;
        const y0 = Math.sin(ang) * rm;
        const gh = glyph.length;
        for (let gr = -1; gr <= gh; gr++) {
          for (let gc = -1; gc <= 5; gc++) {
            const lit = (r: number, c: number) => r >= 0 && r < gh && c >= 0 && c < 5 && glyph[r][c] === "#";
            const on = lit(gr, gc);
            // a one-pixel dark gap around the strokes keeps them readable without punching a box in the ring
            const near = !on && [-1, 0, 1].some((dr) => [-1, 0, 1].some((dc) => lit(gr + dr, gc + dc)));
            if (!on && !near) continue;
            for (const half of [0, 0.5]) {
              const X = x0 + (gc - 2) + half;
              const Y = y0 - (gr - (gh - 1) / 2);
              put(X, Y, on ? "#" : " ", on ? C_RIM : C_LETTER_BG, on ? -98 : -99); // blank backing = a clean notch of sky
            }
          }
        }
      };
      const topStep = (205 / TOP_TEXT.length) * (Math.PI / 180);
      [...TOP_TEXT].forEach((chr, i) => blockLetter(chr, Math.PI / 2 + ((TOP_TEXT.length - 1) / 2 - i) * topStep));
      const botStep = 11.5 * (Math.PI / 180);
      [...BOTTOM_TEXT].forEach((chr, i) => blockLetter(chr, (3 * Math.PI) / 2 + (i - (BOTTOM_TEXT.length - 1) / 2) * botStep));

      // comets: one crosses the top-left corner, later one crosses the bottom-right (behind the ring)
      const comet = (phase: number, x0: number, y0: number, x1: number, y1: number) => {
        const u = ((t + phase) % 16) / 4; // 4 s crossing every 16 s
        if (u > 1) return;
        const hx = x0 + (x1 - x0) * u;
        const hy = y0 + (y1 - y0) * u;
        const dl = Math.hypot(x1 - x0, y1 - y0);
        const dx = (x0 - x1) / dl, dy = (y0 - y1) / dl; // prettier-ignore
        for (let d = 0; d < 9; d += 0.35) {
          const level = d < 0.6 ? 0 : d < 2.5 ? 1 : d < 5 ? 2 : 3;
          const spread = d * 0.12;
          for (let v = -spread; v <= spread; v += 0.5) put(hx + dx * d - dy * v, hy + dy * d + dx * v, "@*=:."[Math.min(4, level + (v ? 1 : 0))], C_COMET + level, -110 - d);
        }
      };
      comet(0, -47, 22, -22, 44);
      comet(8, 47, -22, 22, -44);

      for (const s of stars) {
        const tw = Math.sin(t * s.sp + s.ph);
        put(s.x, s.y, tw > 0.8 ? "*" : tw > 0.2 ? "+" : ".", tw > 0.8 ? C_STAR + 2 : tw > 0.2 ? C_STAR + 1 : C_STAR, -120);
      }

      // ---- globe ----
      const spin = t * GLOBE_SPIN;
      const ca = Math.cos(AXIAL_TILT), sa = Math.sin(AXIAL_TILT); // prettier-ignore
      const g = GLOBE;
      for (let r = Math.floor(CY - g.y - g.r - 1); r <= CY - g.y + g.r + 1; r++) {
        for (let c = Math.floor(CX + (g.x - g.r - 1) * 2); c <= CX + (g.x + g.r + 1) * 2; c++) {
          const x = ((c + 0.5 - CX) / 2 - g.x) / g.r;
          const y = (CY - (r + 0.5) - g.y) / g.r;
          const rr = x * x + y * y;
          if (rr > 1) {
            if (rr < 1.12) put(g.x + x * g.r, g.y + y * g.r, ".", C_ATMO, -60);
            continue;
          }
          const z = Math.sqrt(1 - rr);
          const y2 = y * ca + z * sa;
          const z2 = -y * sa + z * ca;
          const lat = Math.asin(Math.max(-1, Math.min(1, y2)));
          const lon = Math.atan2(x, z2) + spin;
          const mc = ((Math.floor(((lon + Math.PI) / (2 * Math.PI)) * 72) % 72) + 72) % 72;
          const mr = Math.min(35, Math.max(0, Math.floor(((Math.PI / 2 - lat) / Math.PI) * 36)));
          const land = WORLD_MAP[mr][mc] === "#";
          const b = Math.min(0.999, Math.max(0, 0.12 + 0.88 * (x * LX + y * LY + z * LZ)));
          let ch: string, color: number;
          if (land && Math.abs(lat) > 1.05) [ch, color] = [":+*#%"[Math.floor(b * 5)], C_ICE + (b > 0.5 ? 1 : 0)];
          else if (land) [ch, color] = [":+*#%"[Math.floor(b * 5)], C_LAND + Math.floor(b * 4)];
          else [ch, color] = [".:-~="[Math.floor(b * 5)], C_OCEAN + Math.floor(b * 5)];
          put(g.x + x * g.r, g.y + y * g.r, ch, color, z * g.r);
        }
      }

      // ---- rocket on its orbit ----
      // Everything follows the orbit curve: nose on the orbit, tail on the orbit one rocket-length
      // (of arc) behind it, flame bending along the orbit from the tail, and the trail carrying on
      // from the end of the flame. So there is never a gap between rocket, flame and trail.
      const walkBack = (from: number, dist: number) => {
        let th1 = from;
        let walked = 0;
        let prev = orbitAt(from);
        while (walked < dist && th1 > from - Math.PI) {
          th1 -= 0.004;
          const q = orbitAt(th1);
          walked += Math.hypot(q.x - prev.x, q.y - prev.y);
          prev = q;
        }
        return th1;
      };
      const th = t * ORBIT.speed;
      const head = orbitAt(th);
      const persp = 1 + (head.z / (GLOBE.r * 1.4)) * 0.18; // a little bigger on the near side
      const thTail = walkBack(th, ROCKET_LEN * persp);
      const tail = orbitAt(thTail);
      let Tx = head.x - tail.x, Ty = head.y - tail.y; // prettier-ignore
      const len = Math.hypot(Tx, Ty) || 1; // shorter on the tight ends of the orbit: reads as turning
      Tx /= len;
      Ty /= len;
      const Nx = -Ty, Ny = Tx; // prettier-ignore
      const P = { x: (head.x + tail.x) / 2, y: (head.y + tail.y) / 2, z: (head.z + tail.z) / 2 };
      const kAxial = len / rocket.length_m;
      const k = kRocket * persp;
      const roll = t * 1.3;
      const cr = Math.cos(roll), sr = Math.sin(roll); // prettier-ignore
      let radius = 0;
      topRow.fill(9999);
      for (const p of points as Pt[]) {
        const a = (mid - p.x) * kAxial;
        const u = (p.y * cr - p.z * sr) * k * ROCKET_FAT;
        const w = (p.y * sr + p.z * cr) * k * ROCKET_FAT;
        radius = Math.max(radius, Math.abs(u));
        const nu = p.ny * cr - p.nz * sr;
        const nw = p.ny * sr + p.nz * cr;
        const na = -p.nx;
        let dot = (na * Tx + nu * Nx) * LX + (na * Ty + nu * Ny) * LY + nw * LZ;
        if (p.twoSided && dot < 0) dot = -dot * 0.6;
        const b = Math.min(0.999, Math.max(0, 0.1 + 0.85 * dot));
        const base = p.part === 2 ? C_FIN : p.x > mid ? C_GREEN : C_WHITE; // white top half, green bottom half, orange fins
        const X = P.x + a * Tx + u * Nx;
        const Y = P.y + a * Ty + u * Ny;
        const col = Math.floor(CX + X * 2);
        if (col >= 0 && col < COLS) topRow[col] = Math.min(topRow[col], Math.floor(CY - Y)); // for seating Temoc
        const along = a / len + 0.5; // 0 at the tail, 1 at the nose: nose goes behind the globe first
        put(X, Y, SHADE[1 + Math.floor(b * (SHADE.length - 1))], base + Math.min(4, Math.floor(b * 5)), tail.z + (head.z - tail.z) * along + w, true);
      }

      // ---- flame: from the tail, bending along the orbit ----
      const FLAME = 7 * persp;
      const flameLen = FLAME * (0.85 + 0.15 * Math.sin(t * 23) * Math.sin(t * 7));
      const nozzle = radius * 0.8 + 0.4;
      let fth = thTail;
      let fq = tail;
      let walked = 0;
      for (let d = 0; d < flameLen; d += 0.35) {
        while (walked < d) {
          fth -= 0.004;
          const q = orbitAt(fth);
          walked += Math.hypot(q.x - fq.x, q.y - fq.y);
          fq = q;
        }
        const ahead = orbitAt(fth + 0.01);
        let fx = ahead.x - fq.x, fy = ahead.y - fq.y; // prettier-ignore
        const fl = Math.hypot(fx, fy) || 1;
        fx /= fl;
        fy /= fl;
        const kk = d / flameLen;
        const w = nozzle * (1 + 0.6 * Math.sin(Math.PI * Math.min(1, kk * 1.6))) * (1 - kk ** 1.8) * (1 + 0.3 * (flick() - 0.5)) + 0.15;
        for (let u = -w; u <= w; u += 0.35) {
          const heat = 1 - kk - 0.35 * Math.abs(u / w) + 0.25 * (flick() - 0.5);
          if (heat < 0.05) continue;
          const level = heat > 0.7 ? 0 : heat > 0.45 ? 1 : heat > 0.22 ? 2 : 3;
          put(fq.x - fy * u, fq.y + fx * u, "@#*:"[level], C_FLAME + level, fq.z + 0.5, true);
        }
      }

      // ---- trail: carries on along the orbit from under the end of the flame, fading with age ----
      const trailStart = walkBack(thTail, FLAME * 0.85 * 0.75); // starts tucked under the shortest flame
      for (let dth = 0; dth < TRAIL_SPAN; dth += 0.008) {
        const age = dth / TRAIL_SPAN;
        const Q = orbitAt(trailStart - dth);
        const width = 1.5 * (1 - age) + 0.2;
        const Q2 = orbitAt(trailStart - dth + 0.01);
        let qx = Q2.x - Q.x, qy = Q2.y - Q.y; // prettier-ignore
        const ql = Math.hypot(qx, qy) || 1;
        qx /= ql;
        qy /= ql;
        for (let v = -width; v <= width; v += 0.4) {
          const edge = Math.abs(v) / (width + 0.01);
          const lv = Math.min(3, Math.floor(age * 3.2 + edge * 1.2));
          put(Q.x - qy * v, Q.y + qx * v, "@%*:."[Math.min(4, lv + (edge > 0.7 ? 1 : 0))], C_TRAIL + lv, Q.z - 0.2);
        }
      }

      // ---- Temoc riding (sits on the top side of the rocket, just behind the middle) ----
      // seat = the topmost rocket cell in the column under his middle, so he sits on it at any angle
      const seatX = P.x - len * 0.22 * Tx; // behind the middle, so the nose half shows
      const seatCol = Math.floor(CX + seatX * 2);
      const top = seatCol >= 0 && seatCol < COLS ? topRow[seatCol] : 9999;
      const seatY = top < 9999 ? CY - top - 0.5 : P.y + radius;
      const rider = TEMOC_RIDER;
      const half = Math.max(...rider.chars.map((l) => l.length)) / 2;
      const hairRows = Math.round(rider.chars.length * HAIR_ROWS);
      rider.chars.forEach((line, i) => {
        const keys = rider.keys[i];
        const rowY = seatY + (rider.chars.length - i) - 1.5; // bottom row overlaps the rocket: he's sitting in it
        for (let j = 0; j < line.length; j++) {
          let ch = line[j];
          const key = keys[j];
          if (ch === " " || !key || key === " ") continue;
          let color = TEMOC_COL[key] ?? C_RIM;
          if (i < hairRows && (key === "y" || key === "o")) {
            if (flick() < 0.18) ch = "#%@*"[Math.floor(flick() * 4)];
            // fire: red at the tips, orange, then yellow at the roots, with heat rippling upward over time
            const heat = i / hairRows + 0.28 * Math.sin(t * 7 - i * 0.9 + j * 0.6) + 0.12 * (flick() - 0.5);
            color = heat < 0.3 ? C_HAIR_RED + (flick() < 0.5 ? 1 : 0) : heat < 0.62 ? TEMOC_COL.o : TEMOC_COL.y;
          }
          put(seatX + (j - half) / 2, rowY, ch, color, P.z + radius + 1, true);
        }
      });

      // ---- one-cell dark outline around rocket, flame and Temoc so they read against the globe ----
      for (let i = 0; i < COLS * ROWS; i++) {
        const z = spriteZ[i];
        if (z <= -1e8) continue;
        const c = i % COLS;
        for (const j of [i - 1, i + 1, i - COLS, i + COLS]) {
          if (j < 0 || j >= COLS * ROWS || (j === i - 1 && c === 0) || (j === i + 1 && c === COLS - 1)) continue;
          if (spriteZ[j] > -1e8 || grid.z[j] >= z) continue;
          grid.ch[j] = " ";
          grid.z[j] = z - 0.01;
        }
      }

      // ---- paint ----
      const cw = cellW;
      const chH = cw * 2;
      ctx.clearRect(0, 0, cw * COLS, chH * ROWS);
      ctx.fillStyle = SKY;
      ctx.fillRect(0, 0, cw * COLS, chH * ROWS);
      ctx.font = `700 ${chH * 0.9}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      const byColor: number[][] = PAL.map(() => []);
      for (let i = 0; i < COLS * ROWS; i++) if (grid.ch[i] !== " ") byColor[grid.col[i]].push(i);
      byColor.forEach((cells, color) => {
        if (!cells.length) return;
        ctx.fillStyle = PAL[color];
        for (const i of cells) ctx.fillText(grid.ch[i], (i % COLS) * cw, Math.floor(i / COLS) * chH);
      });

    };

    // ?scene_t=12.3 freezes the scene at that time (handy for screenshots and tuning)
    const fixed = Number.parseFloat(new URLSearchParams(window.location.search).get("scene_t") ?? "");
    const still = Number.isFinite(fixed) || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (still) {
      redrawStill = () => draw(Number.isFinite(fixed) ? fixed : 1.2);
      redrawStill();
      return () => ro.disconnect();
    }
    let raf = 0;
    let lastDraw = 0;
    const start = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden || now - lastDraw < 1000 / FPS) return;
      lastDraw = now;
      draw((now - start) / 1000 + 1.2);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [points, stars, rocket.length_m]);

  return (
    <div ref={wrap} className="logo-scene">
      <canvas ref={canvas} role="img" aria-label="Comet Rocketry logo as animated ASCII art: the globe spins while our rocket, with Temoc riding it, orbits trailing fire." />
    </div>
  );
}
