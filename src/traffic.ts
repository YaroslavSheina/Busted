// Трафик: детерминированный спавн, движение вдоль сплайна, перестроение перед заграждениями, OBB и SAT.
import { LANES, PANIC, TRAFFIC_AI, TRAFFIC_SIZE } from './config';
import { heading, laneOff, pathAt, type Path } from './road';
import type { Layout } from './blocks';

export interface Vehicle {
  s: number;
  lane: number;   // целевая полоса
  shift: number;  // боковое смещение от центра целевой полосы, px: ненулевое во время перестроения
  spd: number;    // желаемая скорость
  v: number;      // фактическая скорость последнего кадра — по ней подстраиваются те, кто сзади
  W: number;
  L: number;
  col: string;
  pick: number;   // детерминированная «монетка» машины (0..1) — например, сворачивать ли на ветку
  buzzed?: boolean;        // игрок уже проезжал впритирку — одна провокация на машину
  panic?: { side: 1 | -1; back?: boolean }; // паника: рывок от игрока, затем перекоррекция через всю дорогу к другому краю
  crashed?: boolean;       // встала в отбойник — стоит и не двигается
}

// Проезд впритирку (M2 Near Miss, M3 провокация): борта ближе margin при продольном перекрытии.
// Возвращает сторону машины относительно игрока (+1 — машина правее) или 0
export function brushSide(carOff: number, carW: number, carS: number, carL: number, c: Vehicle, width: number, margin: number): 0 | 1 | -1 {
  const off = laneOff(width, c.lane) + c.shift;
  if (Math.abs(c.s - carS) > (carL + c.L) / 2) return 0;
  const gap = Math.abs(off - carOff) - (carW + c.W) / 2;
  if (gap < 0 || gap > margin) return 0;
  return off > carOff ? 1 : -1;
}

// Все полосы закрыты впереди — полное перекрытие
export function fullBlockAhead(layout: Layout, s: number, look: number): boolean {
  for (let l = 0; l < LANES; l++) if (blockAhead(layout, l, s, look) === null) return false;
  return true;
}

// Есть ли заграждение впереди хоть в одной полосе — рядом с постом трафик держит большую дистанцию
export function anyBlockAhead(layout: Layout, s: number, look: number): boolean {
  for (let l = 0; l < LANES; l++) if (blockAhead(layout, l, s, look) !== null) return true;
  return false;
}

// Ближайшее заграждение в полосе на отрезке [s, s + look] по своей дороге; null — проезд свободен
export function blockAhead(layout: Layout, lane: number, s: number, look: number): number | null {
  let best: number | null = null;
  const take = (bs: number) => { if (bs >= s - 20 && bs <= s + look && (best === null || bs < best)) best = bs; };
  for (const p of layout.police) if (p.lane === lane) take(p.s);
  for (const p of layout.spikes) if (p.lane === lane) take(p.s);
  for (const w of layout.works) if (w.lane === lane) { const a = w.s - w.l / 2, b = w.s + w.l / 2; if (b >= s - 20 && a <= s + look) take(Math.max(a, s - 20)); }
  return best;
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

export function spawnTraffic(path: Path, density: number, playerSpeed: number, seed: number, cars: TrafficCar[] = [], layout?: Layout): Vehicle[] {
  const r = rng(seed);
  const traffic: Vehicle[] = [];
  const n = Math.round(path.L / 380 * density);
  for (let i = 0; i < n; i++) {
    for (let tries = 0; tries < 20; tries++) {
      const s = 250 + r() * (path.L - 500), lane = Math.floor(r() * LANES);
      if (traffic.some(c => c.lane === lane && Math.abs(c.s - s) < 130)) continue;
      if (layout && blockAhead(layout, lane, s - 120, 240) !== null) continue; // не рождаться на посту
      const spd = playerSpeed * (0.4 + r() * 0.3);
      // pick — из координаты спавна, а не из rng: последовательность rng должна остаться прежней
      traffic.push({ s, lane, shift: 0, spd, v: spd, W: TRAFFIC_SIZE.W, L: TRAFFIC_SIZE.L, col: COLORS[Math.floor(r() * 5)], pick: (Math.sin(s * 12.9898) * 43758.5453) % 1 });
      break;
    }
  }
  // Явные машины уровня добавляются к seeded-трафику; при density 0 остаются только они
  cars.forEach((c, i) => traffic.push({ s: c.s, lane: c.lane, shift: 0, spd: c.speed, v: c.speed, W: TRAFFIC_SIZE.W, L: TRAFFIC_SIZE.L, col: COLORS[i % COLORS.length], pick: (i + 0.5) / (cars.length + 1) }));
  return traffic;
}

// Сортирует по s, подстраивает под машину впереди в той же полосе, убирает доехавших до финиша.
// С ai (docs/mechanics.md, M4): перед заграждением уходит в свободную полосу, а если её нет — встаёт в пробку
export function moveTraffic(traffic: Vehicle[], path: Path, dt: number, ai?: { layout: Layout; width: number; playerS?: number; playerL?: number }): Vehicle[] {
  traffic.sort((a, b) => a.s - b.s);
  for (let i = 0; i < traffic.length; i++) {
    const c = traffic[i];
    if (c.crashed) { c.v = 0; continue; }
    if (c.panic && ai) {
      // испуг: рывок от игрока почти до края, потом перекоррекция через всю дорогу к другому краю — там встаёт.
      // Обратный проход метёт дорогу как раз когда подъезжает коп; ход при этом сбрасывается
      const target = c.panic.back ? -c.panic.side * (ai.width / 2 + 4) : c.panic.side * (ai.width / 2 - 20);
      const off = laneOff(ai.width, c.lane) + c.shift;
      const st = PANIC.swerve * dt;
      const next = Math.abs(target - off) <= st ? target : off + Math.sign(target - off) * st;
      c.shift = next - laneOff(ai.width, c.lane);
      // обратно через дорогу — только когда игрок ушёл вперёд с запасом: иначе перекоррекция задевает его в повороте
      const clear = ai.playerS === undefined || ai.playerS - c.s > (ai.playerL ?? 52) / 2 + c.L / 2 + 40;
      if (next === target) { if (c.panic.back) { c.crashed = true; c.v = 0; continue; } if (clear) c.panic.back = true; }
      c.v = c.spd * PANIC.brake; c.s += c.v * dt; continue;
    }
    let sp = c.spd;
    // у поста колонна растягивается до gateGap — иначе в единственную проходную полосу не втиснуться
    const follow = ai && anyBlockAhead(ai.layout, c.s, TRAFFIC_AI.look) ? TRAFFIC_AI.gateGap : 110;
    for (let j = i + 1; j < traffic.length; j++) {
      const o = traffic[j];
      // у поста задняя едет медленнее передней, пока окно не раскроется до gateGap; вне поста — просто не ближе 110
      if (o.lane === c.lane) { if (o.s - c.s < follow) sp = Math.min(sp, follow > 110 ? Math.max(0, o.v - 60) : o.v); break; }
    }
    if (ai) {
      const ahead = blockAhead(ai.layout, c.lane, c.s, TRAFFIC_AI.look);
      if (ahead !== null) {
        // свободная полоса — ближайшая по номеру, без заграждения впереди и без соседа рядом
        let best = -1, bestD = LANES;
        for (let l = 0; l < LANES; l++) {
          if (l === c.lane || blockAhead(ai.layout, l, c.s, TRAFFIC_AI.look) !== null) continue;
          // сосед рядом или впереди ближе gateGap — в эту полосу пока нельзя
          if (traffic.some(o => o !== c && o.lane === l && (Math.abs(o.s - c.s) < TRAFFIC_AI.safeGap || (o.s > c.s && o.s - c.s < TRAFFIC_AI.gateGap)))) continue;
          const d = Math.abs(l - c.lane);
          if (d < bestD) { bestD = d; best = l; }
        }
        if (best >= 0) { c.shift += laneOff(ai.width, c.lane) - laneOff(ai.width, best); c.lane = best; }
        else { const dist = ahead - TRAFFIC_AI.stopGap - c.s; sp = dist < 2 ? 0 : Math.min(sp, dist * 3); }
      }
      if (c.shift !== 0) { const st = TRAFFIC_AI.laneChange * dt; c.shift = Math.abs(c.shift) <= st ? 0 : c.shift - Math.sign(c.shift) * st; }
    }
    c.v = sp;
    c.s += sp * dt;
  }
  return traffic.filter(c => c.s < path.L - 140);
}

export function vehiclePose(path: Path, c: Vehicle, width: number): { x: number; y: number; h: number } {
  const p = pathAt(path, c.s);
  const o = laneOff(width, c.lane) + c.shift;
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
