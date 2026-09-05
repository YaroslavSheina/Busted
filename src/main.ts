import './style.css';
import { CAM_AHEAD, CAM_LERP, MAX_DT, P, PLAYER_SIZE } from './config';
import { step, type CarState } from './physics';
import { buildPath, heading, nearest, pathAt, type Path } from './road';
import { collides, moveTraffic, obb, spawnTraffic, type Vehicle } from './traffic';
import { currentDir, holdText, initInput, resetHold, trackHold } from './input';
import { hudHtml, render, type Cam, type Mark } from './render';
import { LEVELS, type LevelKey } from './levels';
import { buildPanel, initGear } from './debug';

const $ = (id: string) => document.getElementById(id)!;
const cv = $('c') as HTMLCanvasElement, ctx = cv.getContext('2d')!;
const hud = $('hud'), panel = $('panel'), overlay = $('overlay'), ovTitle = $('ovTitle'), ovSub = $('ovSub');

// ---------- размер ----------
const view = { W: 0, H: 0, DPR: 1 };
function resize(): void {
  view.DPR = Math.min(2, devicePixelRatio || 1);
  view.W = innerWidth; view.H = innerHeight;
  cv.width = view.W * view.DPR; cv.height = view.H * view.DPR;
}
addEventListener('resize', resize); resize();

// ---------- состояние ----------
type State = 'play' | 'busted' | 'done';
type Car = CarState & { s: number; off: number; W: number; L: number };

let levelKey: LevelKey = 'straight';
let path: Path;
let car: Car;
let traffic: Vehicle[];
let marks: Mark[];
let cam: Cam;
let state: State;
let timeAlive = 0;

function loadLevel(k: LevelKey): void {
  levelKey = k;
  path = buildPath(LEVELS[k].pts);
  reset();
  buildPanel(panel, levelKey, {
    onLevel: loadLevel,
    onParam: key => { if (key === 'width' || key === 'traffic') reset(); },
  });
}

function reset(): void {
  const p0 = pathAt(path, 0);
  car = { x: p0.x, y: p0.y, h: heading(p0.tx, p0.ty), w: 0, vx: p0.tx * P.speed.v, vy: p0.ty * P.speed.v, s: 0, off: 0, skid: false, ...PLAYER_SIZE };
  marks = [];
  cam = { x: car.x, y: car.y };
  state = 'play'; timeAlive = 0; resetHold();
  traffic = spawnTraffic(path, P.traffic.v, P.speed.v, 1234 + levelKey.length * 7);
  overlay.className = '';
}

function busted(why: string): void {
  state = 'busted'; overlay.className = 'show busted';
  ovTitle.textContent = 'BUSTED'; ovSub.textContent = why + '\n' + holdText();
}
function finish(): void {
  state = 'done'; overlay.className = 'show';
  ovTitle.textContent = 'DELIVERED'; ovSub.textContent = `${timeAlive.toFixed(1)} с`;
}

// ---------- обновление ----------
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

// ---------- ввод и панель ----------
initInput({ left: $('left'), right: $('right') }, () => { if (state !== 'play') reset(); });
overlay.addEventListener('pointerdown', e => { e.preventDefault(); if (state !== 'play') reset(); });
initGear($('gear'), panel);

// ---------- цикл ----------
let last = performance.now(), hudT = 0;
function frame(now: number): void {
  const dt = Math.min(MAX_DT, (now - last) / 1000); last = now;
  update(dt);
  render(ctx, view, { path, width: P.width.v, car, traffic, marks, cam });
  hudT += dt;
  if (hudT > 0.1) { hudT = 0; hud.innerHTML = hudHtml(LEVELS[levelKey].name, car.s / path.L, car); }
  requestAnimationFrame(frame);
}
loadLevel('straight');
requestAnimationFrame(frame);
