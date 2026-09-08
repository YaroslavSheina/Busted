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
  roadHalf: number;         // половина ширины маршрута в этом месте
  red: number;              // длительность красного, с
}

export interface CrossCar { x: number; y: number; h: number; W: number; L: number; obb: Obb }

// Позиция в очереди машины m своего направления: от осевой маршрута наружу, первая — у края перекрёстка
const queueAt = (c: Crossing, m: number) => c.roadHalf + CROSS.queueGap + m * (CROSS.carL + 16);
// Разгон с места (и, зеркально, торможение к очереди) с CROSS.accel до speed: путь за t секунд и время на путь d
const travel = (c: Crossing, t: number) => { const t1 = c.speed / CROSS.accel; return t <= 0 ? 0 : t < t1 ? CROSS.accel * t * t / 2 : c.speed * t - c.speed * t1 / 2; };
const timeFor = (c: Crossing, d: number) => { const t1 = c.speed / CROSS.accel, d1 = c.speed * t1 / 2; return d <= d1 ? Math.sqrt(2 * d / CROSS.accel) : t1 + (d - d1) / c.speed; };

export function layoutCrossings(path: Path, defs: CrossingDef[] = [], roadWidth: number): Crossing[] {
  return defs.map(def => {
    const p = pathAt(path, def.s);
    const n = def.cars ?? CROSS.cars, speed = def.speed ?? CROSS.speed, w = def.width ?? CROSS.width;
    const c: Crossing = { def, x: p.x, y: p.y, tx: p.tx, ty: p.ty, nx: p.nx, ny: p.ny, hCross: Math.atan2(p.nx, -p.ny), s: def.s, w, n, speed, roadHalf: roadWidth / 2, red: 0 };
    // красный — пока последняя машина группы не покинет проезжую часть
    const mMax = Math.ceil(n / 2) - 1;
    c.red = mMax * CROSS.gapT + timeFor(c, queueAt(c, mMax) + c.roadHalf + CROSS.carL / 2) + 0.3;
    return c;
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

// Машины группы в момент time. Машина m своего направления стоит в очереди у края перекрёстка на нашем зелёном
// (видна заранее), на нашем красном трогается с задержкой m·gapT и уезжает за reach; во время нашего зелёного
// с дальнего конца улицы подъезжает следующая и встаёт в ту же очередь к концу цикла
export function crossCars(c: Crossing, time: number): CrossCar[] {
  const out: CrossCar[] = [];
  const ph = phase(c, time), T = c.def.period;
  const add = (dir: 1 | -1, d: number) => { // d — расстояние вдоль поперечной улицы в направлении движения
    const along = dir * d, lane = -dir * c.w / 4;
    const x = c.x + c.nx * along + c.tx * lane, y = c.y + c.ny * along + c.ty * lane;
    const h = dir > 0 ? c.hCross : c.hCross + Math.PI;
    out.push({ x, y, h, W: CROSS.carW, L: CROSS.carL, obb: obb(x, y, h, CROSS.carW, CROSS.carL) });
  };
  for (let k = 0; k < c.n; k++) {
    const dir = k % 2 === 0 ? 1 : -1, m = Math.floor(k / 2);
    const q = queueAt(c, m), tGo = m * CROSS.gapT;
    // уехавшая (с плавным разгоном) или стоящая
    if (ph >= tGo) { const d = -q + travel(c, ph - tGo); if (d <= CROSS.reach) add(dir, d); }
    else add(dir, -q);
    // подъезжающая на смену: тормозит и к концу цикла встаёт в очередь
    const arrive = T - 1.0 + m * 0.25, start = arrive - timeFor(c, CROSS.reach - q);
    if (ph >= start && ph >= tGo) add(dir, -q - travel(c, arrive - ph));
  }
  return out;
}
