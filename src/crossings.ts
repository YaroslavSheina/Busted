// Перекрёсток с поперечным трафиком и светофором (docs/mechanics.md, M9).
// Поперечная улица пересекает маршрут в s; раз в period секунд через неё идёт группа машин в обе стороны.
// Всё от времени попытки — детерминировано. Светофор для игрока: красный ровно пока машины на проезжей части.
import { CROSS } from './config';
import { pathAt, type Path } from './road';
import { obb, type Obb } from './traffic';

export interface CrossingDef {
  s: number;
  period: number;   // цикл, с
  offset?: number;  // когда в цикле загорается красный, с
  cars?: number;    // машин в группе
  speed?: number;   // px/с поперёк
  width?: number;   // ширина поперечной улицы, px
}

export interface Crossing {
  def: CrossingDef;
  x: number; y: number;     // точка пересечения осевых
  tx: number; ty: number;   // вдоль маршрута
  nx: number; ny: number;   // вдоль поперечной улицы
  hCross: number;           // курс машин, идущих в +n
  s: number;
  w: number; n: number; speed: number;
  red: number;              // длительность красного, с
  lead: number;             // машина 0 стартует с −reach за lead секунд до красного, чтобы въехать на дорогу ровно на красный
}

export interface CrossCar { x: number; y: number; h: number; W: number; L: number; obb: Obb }

export function layoutCrossings(path: Path, defs: CrossingDef[] = [], roadWidth: number): Crossing[] {
  return defs.map(def => {
    const p = pathAt(path, def.s);
    const n = def.cars ?? CROSS.cars, speed = def.speed ?? CROSS.speed, w = def.width ?? CROSS.width;
    const lead = (CROSS.reach - roadWidth / 2 - CROSS.carL / 2) / speed;
    const red = (n - 1) * CROSS.gapT + (roadWidth + CROSS.carL) / speed + 0.3;
    return { def, x: p.x, y: p.y, tx: p.tx, ty: p.ty, nx: p.nx, ny: p.ny, hCross: Math.atan2(p.nx, -p.ny), s: def.s, w, n, speed, red, lead };
  });
}

// Фаза цикла: 0 — момент включения красного
function phase(c: Crossing, time: number): number {
  const T = c.def.period;
  return (((time - (c.def.offset ?? 0)) % T) + T) % T;
}

export function lightAt(c: Crossing, time: number): 'green' | 'yellow' | 'red' {
  const ph = phase(c, time);
  if (ph < c.red) return 'red';
  if (ph > c.def.period - CROSS.yellow) return 'yellow';
  return 'green';
}

// Машины группы в момент time: чётные идут в +n по полосе −w/4, нечётные в −n по полосе +w/4
export function crossCars(c: Crossing, time: number): CrossCar[] {
  const out: CrossCar[] = [];
  const ph = phase(c, time);
  for (let k = 0; k < c.n; k++) {
    const t = ph - k * CROSS.gapT + c.lead; // сколько секунд машина k уже едет от −reach
    if (t < 0) continue;
    const d = -CROSS.reach + t * c.speed;    // расстояние от старта вдоль поперечной улицы
    if (d > CROSS.reach) continue;
    const dir = k % 2 === 0 ? 1 : -1, along = dir * d, lane = -dir * c.w / 4;
    const x = c.x + c.nx * along + c.tx * lane, y = c.y + c.ny * along + c.ty * lane;
    const h = dir > 0 ? c.hCross : c.hCross + Math.PI;
    out.push({ x, y, h, W: CROSS.carW, L: CROSS.carL, obb: obb(x, y, h, CROSS.carW, CROSS.carL) });
  }
  return out;
}
