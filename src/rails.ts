// Железная дорога и переезд (docs/mechanics.md, M7): рельсы пересекают дорогу, поезд ходит детерминированно.
import { RAIL } from './config';
import { pathAt, type Path } from './road';
import { obb, type Obb } from './traffic';

export interface RailDef {
  s: number;       // где рельсы пересекают дорогу (s главной)
  period: number;  // поезд раз в period секунд
  speed: number;   // px/с вдоль рельсов
  length: number;  // длина состава, px
  offset?: number; // сдвиг фазы, с
  after?: number;  // сценарный поезд: не по циклу, а один раз — голова у края дороги через after с после того, как игрок пересёк рельсы
  before?: number; // сценарный поезд «перед носом»: один раз, старт когда игрок за before px до рельсов…
  clear?: number;  // …и через clear с после старта хвост сходит с дороги (генератор считает clear из before и скорости машины)
}

export interface Rail {
  def: RailDef;
  x: number; y: number;   // точка пересечения
  dx: number; dy: number; // единичный вектор вдоль рельсов (вправо по ходу дороги)
  h: number;              // курс вдоль рельсов для OBB
  s: number;
  t0?: number;            // сценарный поезд: время попытки, когда игрок пересёк рельсы (after) или подъехал на before (undefined — ещё нет)
}

export function layoutRails(path: Path, defs: RailDef[] = []): Rail[] {
  return defs.map(def => {
    const p = pathAt(path, def.s);
    return { def, x: p.x, y: p.y, dx: p.nx, dy: p.ny, h: Math.atan2(p.nx, -p.ny), s: def.s };
  });
}

// Положение головы состава вдоль рельсов в момент time: состав идёт от −reach−length к +reach, цикл — period
const ROAD_CLEAR = 130; // хвост «сошёл с дороги»: на столько px за осью маршрута (полдороги 90–110 плюс запас)
export function trainHead(r: Rail, time: number): number {
  if (r.def.before !== undefined) { // сценарный «перед носом»: до старта состава нет; при старте голова на length + ROAD_CLEAR − speed·clear
    if (r.t0 === undefined) return -RAIL.reach - r.def.length - 1;
    return r.def.length + ROAD_CLEAR - r.def.speed * (r.def.clear ?? 0) + (time - r.t0) * r.def.speed;
  }
  if (r.def.after !== undefined) { // сценарный: до пересечения состава нет, после — один проход с заданным опозданием
    if (r.t0 === undefined) return -RAIL.reach - r.def.length - 1;
    const shift = (RAIL.reach + r.def.length - RAIL.trainW) / r.def.speed - r.def.after;
    return (time - r.t0 + shift) * r.def.speed - RAIL.reach - r.def.length;
  }
  const D = r.def.period * r.def.speed;
  const cycle = (((time + (r.def.offset ?? 0)) * r.def.speed) % D + D) % D;
  return cycle - RAIL.reach - r.def.length;
}

// OBB состава, если он в пределах рельсов; null — поезда не видно
export function trainObb(r: Rail, time: number): Obb | null {
  const head = trainHead(r, time), tail = head - r.def.length;
  if (head < -RAIL.reach || tail > RAIL.reach) return null;
  const c = (head + tail) / 2;
  return obb(r.x + r.dx * c, r.y + r.dy * c, r.h, RAIL.trainW, r.def.length);
}

// Секунд до того, как голова состава дойдёт до дороги; Infinity — поезд уже прошёл дорогу в этом цикле
export function untilTrain(r: Rail, time: number): number {
  const head = trainHead(r, time);
  const edge = -RAIL.trainW; // считаем приход, когда голова у края проезжей части
  if (head >= edge && head - r.def.length <= RAIL.trainW) return 0; // уже на переезде
  if (head > edge) return Infinity;
  return (edge - head) / r.def.speed;
}
