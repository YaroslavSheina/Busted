// Модель машины. Не знает про canvas, DOM и дорогу — только числа.
// Система координат: y вниз, h = 0 — вверх по экрану, рост h — по часовой.

export interface CarParams {
  speed: number;
  steer: number;
  damp: number;
  grip: number;
  spin: number;
  skidGrip: number;
  sens: number;
}

export interface CarState {
  x: number;
  y: number;
  h: number;   // курс, рад
  w: number;   // угловая скорость, рад/с
  vx: number;
  vy: number;
  skid: boolean;
}

export type Dir = -1 | 0 | 1;

export function step(car: CarState, dir: Dir, p: CarParams, dt: number): void {
  // Кнопка = угловое ускорение; чувствительность растёт со скоростью
  const sensMul = 1 + (p.speed / 300 - 1) * p.sens;
  car.w += dir * p.steer * sensMul * dt;
  // Гашение вращения. Курс к дороге не возвращается — это и даёт «несёт после отпускания»
  car.w -= car.w * (car.skid ? p.damp * 0.25 : p.damp) * dt;
  if (!car.skid && Math.abs(car.w) > p.spin) car.skid = true;
  if (car.skid && Math.abs(car.w) < p.spin * 0.4) car.skid = false;
  car.h += car.w * dt;
  const fx = Math.sin(car.h), fy = -Math.cos(car.h);
  // Вектор скорости догоняет курс; в заносе — медленнее
  const g = Math.min(1, (car.skid ? p.skidGrip : p.grip) * dt);
  car.vx += (fx * p.speed - car.vx) * g;
  car.vy += (fy * p.speed - car.vy) * g;
  car.x += car.vx * dt;
  car.y += car.vy * dt;
}
