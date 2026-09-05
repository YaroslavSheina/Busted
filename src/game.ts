// Одна попытка: состояние, обновление, цикл. Используется игрой (main.ts) и редактором («Играть»).
import { CAM_AHEAD, CAM_LERP, MAX_DT, P, PLAYER_SIZE } from './config';
import { step, type CarState } from './physics';
import { buildPath, heading, nearest, pathAt, type Path } from './road';
import { collides, moveTraffic, obb, spawnTraffic, type Vehicle } from './traffic';
import { currentDir, holdText, initInput, resetHold, trackHold } from './input';
import { hudHtml, render, type Cam, type Mark } from './render';
import type { LevelData } from './levels';

export interface GameUI {
  canvas: HTMLCanvasElement;
  hud: HTMLElement;
  overlay: HTMLElement;
  ovTitle: HTMLElement;
  ovSub: HTMLElement;
  left: HTMLElement;
  right: HTMLElement;
}

export interface Game {
  load(level: LevelData): void;
  reset(): void;
  stop(): void;
}

type State = 'play' | 'busted' | 'done';
type Car = CarState & { s: number; off: number; W: number; L: number };

export function createGame(ui: GameUI, first: LevelData): Game {
  const ctx = ui.canvas.getContext('2d')!;

  const view = { W: 0, H: 0, DPR: 1 };
  function resize(): void {
    view.DPR = Math.min(2, devicePixelRatio || 1);
    view.W = innerWidth; view.H = innerHeight;
    ui.canvas.width = view.W * view.DPR; ui.canvas.height = view.H * view.DPR;
  }

  let level: LevelData;
  let path: Path;
  let car: Car;
  let traffic: Vehicle[];
  let marks: Mark[];
  let cam: Cam;
  let state: State;
  let timeAlive = 0;

  function load(l: LevelData): void {
    level = l;
    path = buildPath(l.points);
    // Уровень задаёт стартовые значения, слайдеры панели тюнинга дальше крутят их поверх
    P.width.v = l.width; P.traffic.v = l.traffic; P.speed.v = l.speed;
    reset();
  }

  function reset(): void {
    const p0 = pathAt(path, 0);
    car = { x: p0.x, y: p0.y, h: heading(p0.tx, p0.ty), w: 0, vx: p0.tx * P.speed.v, vy: p0.ty * P.speed.v, s: 0, off: 0, skid: false, ...PLAYER_SIZE };
    marks = [];
    cam = { x: car.x, y: car.y };
    state = 'play'; timeAlive = 0; resetHold();
    traffic = spawnTraffic(path, P.traffic.v, P.speed.v, level.seed);
    ui.overlay.className = '';
  }

  function busted(why: string): void {
    state = 'busted'; ui.overlay.className = 'show busted';
    ui.ovTitle.textContent = 'BUSTED'; ui.ovSub.textContent = why + '\n' + holdText();
  }
  function finish(): void {
    state = 'done'; ui.overlay.className = 'show';
    ui.ovTitle.textContent = 'DELIVERED'; ui.ovSub.textContent = `${timeAlive.toFixed(1)} с`;
  }

  function update(dt: number): void {
    if (state !== 'play') return;
    timeAlive += dt;
    const dir = currentDir();
    trackHold(dir, dt);

    step(car, dir, { speed: P.speed.v, steer: P.steer.v, damp: P.damp.v, grip: P.grip.v, spin: P.spin.v, skidGrip: P.skidGrip.v, sens: P.sens.v }, dt);
    if (car.skid) marks.push({ x: car.x, y: car.y, a: 1 });
    for (const m of marks) m.a -= dt * 0.4;
    marks = marks.filter(m => m.a > 0).slice(-200);

    const nr = nearest(path, car.x, car.y, car.s);
    car.s = nr.s; car.off = nr.off;
    if (Math.abs(car.off) > P.width.v / 2 + P.tol.v) return busted('вылет с дороги');
    if (car.s >= path.L - 60) return finish();

    traffic = moveTraffic(traffic, path, dt);
    if (collides(traffic, path, P.width.v, obb(car.x, car.y, car.h, car.W, car.L), car.s)) return busted('столкновение');

    // Камера: точка впереди по вектору скорости (не курса), плавный догон
    const vl = Math.hypot(car.vx, car.vy) || 1;
    const tx = car.x + car.vx / vl * CAM_AHEAD, ty = car.y + car.vy / vl * CAM_AHEAD;
    const cl = Math.min(1, CAM_LERP * dt);
    cam.x += (tx - cam.x) * cl; cam.y += (ty - cam.y) * cl;
  }

  const restart = () => { if (state !== 'play') reset(); };
  const onOverlay = (e: PointerEvent) => { e.preventDefault(); restart(); };
  const disposeInput = initInput({ left: ui.left, right: ui.right }, restart);
  ui.overlay.addEventListener('pointerdown', onOverlay);
  addEventListener('resize', resize); resize();

  let raf = 0, last = performance.now(), hudT = 0;
  function frame(now: number): void {
    const dt = Math.min(MAX_DT, (now - last) / 1000); last = now;
    update(dt);
    render(ctx, view, { path, width: P.width.v, car, traffic, marks, cam });
    hudT += dt;
    if (hudT > 0.1) { hudT = 0; ui.hud.innerHTML = hudHtml(level.name, car.s / path.L, car); }
    raf = requestAnimationFrame(frame);
  }
  load(first);
  raf = requestAnimationFrame(frame);

  return {
    load, reset,
    stop() {
      cancelAnimationFrame(raf);
      disposeInput();
      ui.overlay.removeEventListener('pointerdown', onOverlay);
      removeEventListener('resize', resize);
    },
  };
}
