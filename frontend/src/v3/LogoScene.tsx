import { useEffect, useMemo, useRef } from "react";
import type { RocketModel } from "../rocket";
import { SHADE, buildPoints, type Pt } from "./asciiRender";
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

const R_OUT = 38.5; // ring outer edge
const R_IN = 31; // ring inner edge
const GLOBE = { x: -6, y: -5, r: 17 };
const GLOBE_SPIN = 0.22; // rad/s
const AXIAL_TILT = 0.4; // north pole tipped toward the viewer
const ORBIT = { a: 23.5, b: 8, tilt: (32 * Math.PI) / 180, speed: 0.5 }; // ellipse around the globe
const ROCKET_LEN = 17; // rows
const ROCKET_FAT = 2.3; // extra radial widening on top of the renderer's
const TRAIL_SPAN = 2.6; // radians of orbit the trail covers

// ---- palette (fixed: the scene is a dark "screen" in both themes) ----
const PAL = [
  "#c2410c", "#ea580c", "#f97316", "#fb923c", // 0-3 ring
  "#f8fafc", // 4 rim / letters
  "#475569", "#cbd5e1", "#ffffff", // 5-7 stars
  "#1e3a8a", "#1d4ed8", "#2563eb", "#3b82f6", "#60a5fa", // 8-12 ocean
  "#14532d", "#15803d", "#22c55e", "#4ade80", // 13-16 land
  "#94a3b8", "#e2e8f0", // 17-18 ice
  "#7dd3fc", // 19 atmosphere
  "#a16207", "#ca8a04", "#eab308", "#facc15", "#fde047", // 20-24 rocket body (gold, like the logo)
  "#9a3412", "#c2410c", "#ea580c", "#f97316", "#fdba74", // 25-29 nose + fins
  "#fff3b0", "#fde047", "#fb923c", "#ef4444", // 30-33 flame hot -> cool
  "#ffffff", "#e2e8f0", "#94a3b8", "#475569", // 34-37 trail new -> old
  "#facc15", "#f97316", "#cfe3f5", "#94a3b8", "#ffffff", // 38-42 Temoc: hair y, hair/shirt o, skin, outline, eyes/logo
]; // prettier-ignore
const C_RIM = 4, C_STAR = 5, C_OCEAN = 8, C_LAND = 13, C_ICE = 17, C_ATMO = 19, C_BODY = 20, C_NOSE = 25, C_FLAME = 30, C_TRAIL = 34; // prettier-ignore
const TEMOC_COL: Record<string, number> = { y: 38, o: 39, s: 40, k: 41, w: 42 };

// Temoc riding: bottom row sits on the rocket. Chars + one colour key per char.
const RIDER = [
  ["  ) ( ) (  ", "  y o y o  "],
  [" (%#*%#*%) ", " yoyoyoyoy "],
  [" (#%#*#%#) ", " oyoyoyoyo "],
  ["  |o   o|  ", "  kw   wk  "],
  ["  | \\_/ |  ", "  k kkk k  "],
  ["   \\___/   ", "   kkkkk   "],
  [" _/[UTD]\\_ ", " ssowwwoss "],
  ["/  |___|  \\", "s  ooooo  s"],
  ["  _/   \\_  ", "  ss   ss  "],
];

const TOP_TEXT = "COMET ROCKETRY";
const BOTTOM_TEXT = "AIAA · UTD";

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
    while (out.length < 110) {
      const x = (r() * 2 - 1) * R_IN;
      const y = (r() * 2 - 1) * R_IN;
      if (Math.hypot(x, y) > R_IN - 2 || Math.hypot(x - GLOBE.x, y - GLOBE.y) < GLOBE.r + 2) continue;
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
      const w = Math.min(box.clientWidth, 760);
      cellW = w / COLS;
      const dpr = window.devicePixelRatio || 1;
      cv.style.width = `${w}px`;
      cv.style.height = `${cellW * 2 * ROWS}px`;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(cellW * 2 * ROWS * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(box);

    const topRow = new Int16Array(COLS);
    const grid: Grid = { ch: new Array(COLS * ROWS).fill(" "), col: new Int16Array(COLS * ROWS), z: new Float32Array(COLS * ROWS) };
    const flick = rng(5);
    const L = Math.hypot(...[-0.5, 0.55, 0.67]);
    const LX = -0.5 / L, LY = 0.55 / L, LZ = 0.67 / L; // prettier-ignore
    const kRocket = ROCKET_LEN / rocket.length_m;
    const mid = rocket.length_m / 2;

    const put = (X: number, Y: number, ch: string, color: number, z: number) => {
      const c = Math.floor(CX + X * 2);
      const r = Math.floor(CY - Y);
      if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return;
      const i = r * COLS + c;
      if (z <= grid.z[i]) return;
      grid.z[i] = z;
      grid.ch[i] = ch;
      grid.col[i] = color;
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
      for (const s of stars) {
        const tw = Math.sin(t * s.sp + s.ph);
        put(s.x, s.y, tw > 0.8 ? "*" : tw > 0.2 ? "+" : ".", tw > 0.8 ? C_STAR + 2 : tw > 0.2 ? C_STAR + 1 : C_STAR, -90);
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
      const th = t * ORBIT.speed;
      const P = orbitAt(th);
      const P2 = orbitAt(th + 0.01);
      let Tx = P2.x - P.x, Ty = P2.y - P.y; // prettier-ignore
      const tl = Math.hypot(Tx, Ty) || 1;
      Tx /= tl;
      Ty /= tl;
      const Nx = -Ty, Ny = Tx; // prettier-ignore
      const persp = 1 + (P.z / (GLOBE.r * 1.4)) * 0.18; // a little bigger on the near side
      const k = kRocket * persp;
      const roll = t * 1.3;
      const cr = Math.cos(roll), sr = Math.sin(roll); // prettier-ignore
      let radius = 0;
      topRow.fill(9999);
      for (const p of points as Pt[]) {
        const a = (mid - p.x) * k;
        const u = (p.y * cr - p.z * sr) * k * ROCKET_FAT;
        const w = (p.y * sr + p.z * cr) * k * ROCKET_FAT;
        radius = Math.max(radius, Math.abs(u));
        const nu = p.ny * cr - p.nz * sr;
        const nw = p.ny * sr + p.nz * cr;
        const na = -p.nx;
        let dot = (na * Tx + nu * Nx) * LX + (na * Ty + nu * Ny) * LY + nw * LZ;
        if (p.twoSided && dot < 0) dot = -dot * 0.6;
        const b = Math.min(0.999, Math.max(0, 0.1 + 0.85 * dot));
        const base = p.part === 1 ? C_BODY : C_NOSE;
        const X = P.x + a * Tx + u * Nx;
        const Y = P.y + a * Ty + u * Ny;
        const col = Math.floor(CX + X * 2);
        if (col >= 0 && col < COLS) topRow[col] = Math.min(topRow[col], Math.floor(CY - Y)); // for seating Temoc
        put(X, Y, SHADE[1 + Math.floor(b * (SHADE.length - 1))], base + Math.min(4, Math.floor(b * 5)), P.z + w);
      }

      // ---- flame out of the tail ----
      const tailX = P.x - (ROCKET_LEN / 2) * persp * Tx;
      const tailY = P.y - (ROCKET_LEN / 2) * persp * Ty;
      const flameLen = 7 * persp * (0.85 + 0.15 * Math.sin(t * 23) * Math.sin(t * 7));
      const nozzle = radius * 0.8 + 0.4;
      for (let d = 0; d < flameLen; d += 0.35) {
        const kk = d / flameLen;
        const w = nozzle * (1 + 0.6 * Math.sin(Math.PI * Math.min(1, kk * 1.6))) * (1 - kk ** 1.8) * (1 + 0.3 * (flick() - 0.5)) + 0.15;
        for (let u = -w; u <= w; u += 0.35) {
          const heat = 1 - kk - 0.35 * Math.abs(u / w) + 0.25 * (flick() - 0.5);
          if (heat < 0.05) continue;
          const level = heat > 0.7 ? 0 : heat > 0.45 ? 1 : heat > 0.22 ? 2 : 3;
          put(tailX - d * Tx + u * Nx, tailY - d * Ty + u * Ny, "@#*:"[level], C_FLAME + level, P.z + 0.5);
        }
      }

      // ---- trail: the orbit behind the flame, fading with age (draws the logo's swoosh) ----
      const back = (ROCKET_LEN / 2 + flameLen) / (tl / 0.01);
      for (let dth = back; dth < TRAIL_SPAN; dth += 0.008) {
        const age = (dth - back) / (TRAIL_SPAN - back);
        const Q = orbitAt(th - dth);
        const width = 1.5 * (1 - age) + 0.2;
        const Q2 = orbitAt(th - dth + 0.01);
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
      // seat = the topmost rocket cell in the column just behind the middle, so he sits on it at any angle
      const seatX = P.x - ROCKET_LEN * 0.12 * persp * Tx;
      const seatCol = Math.floor(CX + seatX * 2);
      const top = seatCol >= 0 && seatCol < COLS ? topRow[seatCol] : 9999;
      const seatY = top < 9999 ? CY - top - 0.5 : P.y + radius;
      const half = Math.floor(RIDER[0][0].length / 2);
      RIDER.forEach(([line, keys], i) => {
        const rowY = seatY + (RIDER.length - i) - 0.5;
        for (let j = 0; j < line.length; j++) {
          let ch = line[j];
          if (ch === " ") continue;
          if (i < 3 && flick() < 0.2) ch = "*#%()"[Math.floor(flick() * 5)]; // flame hair
          put(seatX + (j - half) / 2, rowY, ch, TEMOC_COL[keys[j]] ?? C_RIM, P.z + radius + 1);
        }
      });

      // ---- paint ----
      const cw = cellW;
      const chH = cw * 2;
      ctx.clearRect(0, 0, cw * COLS, chH * ROWS);
      ctx.fillStyle = "#03050b";
      ctx.beginPath();
      ctx.arc(CX * cw, CY * chH, (R_OUT + 1.5) * chH, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0b1238";
      ctx.beginPath();
      ctx.arc(CX * cw, CY * chH, (R_IN - 0.9) * chH, 0, Math.PI * 2);
      ctx.fill();
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

      // ---- lettering on the ring (stroked so it reads over the ring texture) ----
      const rm = (R_IN + R_OUT) / 2;
      const letter = (chr: string, ang: number) => {
        const x = CX * cw + Math.cos(ang) * rm * chH;
        const y = CY * chH - Math.sin(ang) * rm * chH;
        ctx.strokeText(chr, x, y);
        ctx.fillText(chr, x, y);
      };
      ctx.font = `800 ${chH * 3.6}px Inter, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = chH * 1.1;
      ctx.strokeStyle = "#c2410c";
      ctx.fillStyle = PAL[C_RIM];
      const topStep = (205 / TOP_TEXT.length) * (Math.PI / 180);
      [...TOP_TEXT].forEach((chr, i) => letter(chr, Math.PI / 2 + ((TOP_TEXT.length - 1) / 2 - i) * topStep));
      const botStep = 11 * (Math.PI / 180);
      [...BOTTOM_TEXT].forEach((chr, i) => letter(chr, (3 * Math.PI) / 2 + (i - (BOTTOM_TEXT.length - 1) / 2) * botStep));
    };

    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (still) {
      draw(1.2);
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
