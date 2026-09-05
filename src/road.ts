// Дорога: Catmull-Rom сплайн, отсэмплированный в точки с длиной s, касательной и правой нормалью.
import { LANES } from './config';

export type Pt = [number, number];

export interface Sample {
  x: number; y: number;
  s: number;              // накопленная длина
  tx: number; ty: number; // касательная
  nx: number; ny: number; // нормаль вправо по ходу
}

export interface Path { pt: Sample[]; L: number }

export interface Pose { x: number; y: number; tx: number; ty: number; nx: number; ny: number }

function catmull(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const t2 = t * t, t3 = t2 * t;
  return [
    0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
  ];
}

export function buildPath(pts: Pt[]): Path {
  const raw: { x: number; y: number }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(i + 2, pts.length - 1)];
    const steps = Math.max(8, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 6));
    for (let k = 0; k < steps; k++) {
      const q = catmull(p0, p1, p2, p3, k / steps);
      raw.push({ x: q[0], y: q[1] });
    }
  }
  raw.push({ x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] });

  const pt: Sample[] = [];
  let s = 0;
  for (let i = 0; i < raw.length; i++) {
    if (i > 0) s += Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y);
    const a = raw[Math.max(i - 1, 0)], b = raw[Math.min(i + 1, raw.length - 1)];
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    const tx = dx / l, ty = dy / l;
    pt.push({ x: raw[i].x, y: raw[i].y, s, tx, ty, nx: -ty, ny: tx });
  }
  return { pt, L: s };
}

function idxAt(path: Path, s: number): number {
  let lo = 0, hi = path.pt.length - 1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (path.pt[m].s < s) lo = m + 1; else hi = m;
  }
  return lo;
}

export function pathAt(path: Path, s: number): Pose {
  s = Math.max(0, Math.min(path.L, s));
  const i = Math.max(1, idxAt(path, s));
  const a = path.pt[i - 1], b = path.pt[i];
  const t = (s - a.s) / ((b.s - a.s) || 1);
  return {
    x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
    tx: a.tx + (b.tx - a.tx) * t, ty: a.ty + (b.ty - a.ty) * t,
    nx: a.nx + (b.nx - a.nx) * t, ny: a.ny + (b.ny - a.ny) * t,
  };
}

// Ближайшая точка в окне вокруг предыдущего s, а не глобальный поиск:
// иначе на кольце и развороте машину «перебросит» на соседний участок дороги.
export function nearest(path: Path, x: number, y: number, sGuess: number): { s: number; off: number; p: Sample } {
  const i0 = idxAt(path, sGuess - 200), i1 = Math.min(path.pt.length - 1, idxAt(path, sGuess + 350));
  let best = Infinity, bi = i0;
  for (let i = i0; i <= i1; i++) {
    const p = path.pt[i];
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < best) { best = d; bi = i; }
  }
  const p = path.pt[bi];
  return { s: p.s, off: (x - p.x) * p.nx + (y - p.y) * p.ny, p };
}

// Курс машины из касательной дороги (h = 0 — вверх по экрану)
export const heading = (tx: number, ty: number) => Math.atan2(tx, -ty);

export const laneOff = (width: number, lane: number) => (lane - (LANES - 1) / 2) * (width / LANES);
