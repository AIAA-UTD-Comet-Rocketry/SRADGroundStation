// Spinning ASCII rocket built from the OpenRocket outline.
// TypeScript port of backend/ground_station/ascii_rocket.py; keep the two in step.
// Idea credit: alishsharma17/Ascii-Flower-Bouquet- (rotate -> project -> shade -> depth buffer).
import type { RocketModel } from "../rocket";

export const SHADE = " .:-=+*#%@";
/** Real L3 rockets are ~25x longer than wide; widen the radius so the shape reads at character size. */
const RADIAL_SCALE = 1.7;
const LIGHT = (() => {
  const l = [-0.6, 0.35, 0.72];
  const n = Math.hypot(...l);
  return l.map((v) => v / n) as [number, number, number];
})();

export const PART_NOSE = 0;
export const PART_BODY = 1;
export const PART_FIN = 2;

export interface Pt {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  part: number;
  twoSided: boolean;
}

function inside(x: number, y: number, poly: [number, number][]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) hit = !hit;
  }
  return hit;
}

export function buildPoints(rocket: RocketModel, axialSamples = 260, ringSamples = 28): Pt[] {
  const { outline, length_m: length } = rocket;
  const noseLen = rocket.sections[0]?.kind === "nosecone" ? rocket.sections[0].length : 0;
  const step = length / axialSamples;
  const pts: Pt[] = [];

  for (let s = 0; s + 1 < outline.length; s++) {
    const [x0, ra] = outline[s];
    const [x1, rb] = outline[s + 1];
    if (x1 - x0 < 1e-9) continue;
    const r0 = ra * RADIAL_SCALE;
    const slope = (rb * RADIAL_SCALE - r0) / (x1 - x0);
    const nAx = Math.max(1, Math.round((x1 - x0) / step));
    const inv = 1 / Math.sqrt(1 + slope * slope);
    for (let i = 0; i < nAx; i++) {
      const x = x0 + ((x1 - x0) * (i + 0.5)) / nAx;
      const r = r0 + slope * (x - x0);
      const k = Math.max(6, Math.round((ringSamples * r) / (0.08 * RADIAL_SCALE)));
      const part = x <= noseLen + 1e-6 ? PART_NOSE : PART_BODY;
      for (let j = 0; j < k; j++) {
        const a = (2 * Math.PI * (j + 0.5 * (i % 2))) / k;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        pts.push({ x, y: r * c, z: r * sn, nx: -slope * inv, ny: c * inv, nz: sn * inv, part, twoSided: false });
      }
    }
  }

  const bodyR = Math.max(0, ...outline.map((p) => p[1]));
  for (const fin of rocket.fins) {
    const poly = fin.polygon;
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    if (Math.max(...ys) - bodyR < 0.02) continue; // strakes / rail guides: invisible at this scale
    const count = Math.max(1, fin.count | 0);
    const gy = (Math.max(...ys) - Math.min(...ys)) / 14;
    for (let f = 0; f < count; f++) {
      const th = (2 * Math.PI * f) / count + Math.PI / 4;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      for (let x = Math.min(...xs); x <= Math.max(...xs); x += step) {
        for (let y = bodyR; y <= Math.max(...ys); y += gy) {
          if (!inside(x, y, poly)) continue;
          const rr = bodyR * RADIAL_SCALE + (y - bodyR) * 1.4;
          pts.push({ x, y: rr * c, z: rr * sn, nx: 0, ny: -sn, nz: c, part: PART_FIN, twoSided: true });
        }
      }
    }
  }
  return pts;
}

/** One frame: rocket nose-up, rolled `roll` rad about its own axis. Returns chars + part per cell (-1 = empty). */
export function renderFrame(points: Pt[], length: number, roll: number, cols: number, rows: number) {
  const chars: string[][] = Array.from({ length: rows }, () => Array<string>(cols).fill(" "));
  const parts: Int8Array[] = Array.from({ length: rows }, () => new Int8Array(cols).fill(-1));
  const zbuf: Float32Array[] = Array.from({ length: rows }, () => new Float32Array(cols).fill(-1e9));
  if (!points.length) return { chars, parts };

  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  let span = 0;
  for (const p of points) span = Math.max(span, Math.hypot(p.y, p.z));
  // A character is ~2x taller than wide, so one metre is 2x more columns than rows.
  const scale = Math.min((rows - 1) / length, (cols - 2) / (4 * span));
  const top = (rows - length * scale) / 2;
  const cx = cols / 2;
  const [lx, ly, lz] = LIGHT;

  for (const p of points) {
    const y = p.y * cr - p.z * sr;
    const z = p.y * sr + p.z * cr;
    const col = Math.floor(cx + y * scale * 2);
    const row = Math.floor(top + p.x * scale);
    if (row < 0 || row >= rows || col < 0 || col >= cols || z <= zbuf[row][col]) continue;
    const ny = p.ny * cr - p.nz * sr;
    const nz = p.ny * sr + p.nz * cr;
    let dot = ny * lx - p.nx * ly + nz * lz; // nose is up the screen, so up = -x
    if (p.twoSided && dot < 0) dot = -dot * 0.6;
    const b = Math.min(0.999, Math.max(0, 0.08 + 0.85 * dot));
    zbuf[row][col] = z;
    chars[row][col] = SHADE[1 + Math.floor(b * (SHADE.length - 1))];
    parts[row][col] = p.part;
  }
  return { chars, parts };
}
