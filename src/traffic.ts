// Трафик: детерминированный спавн, движение вдоль сплайна, OBB и SAT для столкновений.
import { LANES, TRAFFIC_SIZE } from './config';
import { heading, laneOff, pathAt, type Path } from './road';

export interface Vehicle {
  s: number;
  lane: number;
  spd: number;
  W: number;
  L: number;
  col: string;
}

// Явно расставленная машина уровня: speed в px/с, 0 — стоит
export interface TrafficCar { s: number; lane: number; speed: number }

export interface Obb { c: [number, number][]; ax: [number, number][] }

const COLORS = ['#8a94a6', '#b9b2a3', '#7a8a7e', '#a3877a', '#6f7f9a'];

// mulberry32 — одинаковый seed даёт одинаковый трафик на каждой попытке
export function rng(seed: number): () => number {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function spawnTraffic(path: Path, density: number, playerSpeed: number, seed: number, cars: TrafficCar[] = []): Vehicle[] {
  const r = rng(seed);
  const traffic: Vehicle[] = [];
  const n = Math.round(path.L / 380 * density);
  for (let i = 0; i < n; i++) {
    for (let tries = 0; tries < 20; tries++) {
      const s = 250 + r() * (path.L - 500), lane = Math.floor(r() * LANES);
      if (traffic.some(c => c.lane === lane && Math.abs(c.s - s) < 130)) continue;
      traffic.push({ s, lane, spd: playerSpeed * (0.4 + r() * 0.3), W: TRAFFIC_SIZE.W, L: TRAFFIC_SIZE.L, col: COLORS[Math.floor(r() * 5)] });
      break;
    }
  }
  // Явные машины уровня добавляются к seeded-трафику; при density 0 остаются только они
  cars.forEach((c, i) => traffic.push({ s: c.s, lane: c.lane, spd: c.speed, W: TRAFFIC_SIZE.W, L: TRAFFIC_SIZE.L, col: COLORS[i % COLORS.length] }));
  return traffic;
}

// Сортирует по s, подстраивает под машину впереди в той же полосе, убирает доехавших до финиша
export function moveTraffic(traffic: Vehicle[], path: Path, dt: number): Vehicle[] {
  traffic.sort((a, b) => a.s - b.s);
  for (let i = 0; i < traffic.length; i++) {
    const c = traffic[i];
    let sp = c.spd;
    for (let j = i + 1; j < traffic.length; j++) {
      const o = traffic[j];
      if (o.lane === c.lane) { if (o.s - c.s < 110) sp = Math.min(sp, o.spd); break; }
    }
    c.s += sp * dt;
  }
  return traffic.filter(c => c.s < path.L - 140);
}

export function vehiclePose(path: Path, c: Vehicle, width: number): { x: number; y: number; h: number } {
  const p = pathAt(path, c.s);
  const o = laneOff(width, c.lane);
  return { x: p.x + p.nx * o, y: p.y + p.ny * o, h: heading(p.tx, p.ty) };
}

export function obb(x: number, y: number, h: number, w: number, l: number): Obb {
  const s = Math.sin(h), c = Math.cos(h);
  const fx = s, fy = -c, rx = c, ry = s;
  return {
    c: [
      [x + fx * l / 2 + rx * w / 2, y + fy * l / 2 + ry * w / 2],
      [x + fx * l / 2 - rx * w / 2, y + fy * l / 2 - ry * w / 2],
      [x - fx * l / 2 - rx * w / 2, y - fy * l / 2 - ry * w / 2],
      [x - fx * l / 2 + rx * w / 2, y - fy * l / 2 + ry * w / 2],
    ],
    ax: [[fx, fy], [rx, ry]],
  };
}

export function hit(a: Obb, b: Obb): boolean {
  for (const ax of [...a.ax, ...b.ax]) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const c of a.c) { const d = c[0] * ax[0] + c[1] * ax[1]; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const c of b.c) { const d = c[0] * ax[0] + c[1] * ax[1]; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}

// Проверяем только машины в окне |s − car.s| < 120
export function collides(traffic: Vehicle[], path: Path, width: number, me: Obb, carS: number): boolean {
  for (const c of traffic) {
    if (Math.abs(c.s - carS) > 120) continue;
    const v = vehiclePose(path, c, width);
    if (hit(me, obb(v.x, v.y, v.h, c.W, c.L))) return true;
  }
  return false;
}
