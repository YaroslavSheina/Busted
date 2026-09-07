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
}

export interface Rail {
  def: RailDef;
  x: number; y: number;   // точка пересечения
  dx: number; dy: number; // единичный вектор вдоль рельсов (вправо по ходу дороги)
  h: number;              // курс вдоль рельсов для OBB
  s: number;
}

export function layoutRails(path: Path, defs: RailDef[] = []): Rail[] {
  return defs.map(def => {
    const p = pathAt(path, def.s);
    return { def, x: p.x, y: p.y, dx: p.nx, dy: p.ny, h: Math.atan2(p.nx, -p.ny), s: def.s };
  });
}

// Положение головы состава вдоль рельсов в момент time: состав идёт от −reach−length к +reach, цикл — period
export function trainHead(r: Rail, time: number): number {
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
