// Камера, дорога, машины, следы заноса, HUD. drawGrid/drawRoad также использует редактор.
import { LANES, TRAFFIC_SIZE } from './config';
import { heading, pathAt, type Path } from './road';
import { vehiclePose, type Vehicle } from './traffic';
import type { CarState } from './physics';
import type { CarSpec } from './cars';
import type { Layout } from './blocks';
import { BLOCK } from './config';

export interface View { W: number; H: number; DPR: number }
export interface Mark { x: number; y: number; a: number }
export interface Cam { x: number; y: number }

export interface RoadScene { path: Path; traffic: Vehicle[]; blocks: Layout }

export interface Scene {
  roads: RoadScene[]; // 0 — главная (финиш на ней), дальше ветки
  width: number;
  car: CarState & { W: number; L: number };
  spec: CarSpec;
  marks: Mark[];
  cam: Cam;
  t?: number;                                                    // время попытки — для мигалки
  zoom?: number;                                                 // зум камеры (слоу-мо провокации)
  chaser?: { x: number; y: number; h: number; danger: number };  // danger: 0 — держит дистанцию, 1 — догнал
}

function poly(ctx: CanvasRenderingContext2D, path: Path, off: number, dash: number[], color: string, lw: number, cap: CanvasLineCap = 'round'): void {
  ctx.beginPath();
  const pt = path.pt;
  for (let i = 0; i < pt.length; i++) {
    const p = pt[i];
    const x = p.x + p.nx * off, y = p.y + p.ny * off;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.setLineDash(dash); ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.lineCap = cap;
  ctx.stroke(); ctx.setLineDash([]);
}

export function drawCar(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, w: number, l: number, col: string, player: boolean): void {
  ctx.save(); ctx.translate(x, y); ctx.rotate(h);
  ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(-w / 2, -l / 2, w, l, 6); ctx.fill();
  ctx.fillStyle = 'rgba(20,22,28,.55)'; ctx.fillRect(-w / 2 + 4, -l / 2 + 12, w - 8, 11); ctx.fillRect(-w / 2 + 4, l / 2 - 14, w - 8, 7);
  if (player) { ctx.fillStyle = '#fff3c4'; ctx.fillRect(-w / 2 + 3, -l / 2 - 1, 6, 3); ctx.fillRect(w / 2 - 9, -l / 2 - 1, 6, 3); }
  else { ctx.fillStyle = '#e04a3a'; ctx.fillRect(-w / 2 + 3, l / 2 - 2, 6, 2); ctx.fillRect(w / 2 - 9, l / 2 - 2, 6, 2); }
  ctx.restore();
}

// Машина игрока: силуэт и детали зависят от кузова. Векторные заглушки до комикс-арта (фаза H).
export function drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, spec: CarSpec): void {
  const { W: w, L: l } = spec;
  const glass = 'rgba(20,22,28,.6)', trim = 'rgba(20,22,28,.35)', lamp = '#fff3c4';
  ctx.save(); ctx.translate(x, y); ctx.rotate(h);
  switch (spec.body) {
    case 'sedan':
      ctx.fillStyle = '#f4b942'; ctx.beginPath(); ctx.roundRect(-w / 2, -l / 2, w, l, 6); ctx.fill();
      ctx.fillStyle = glass; ctx.fillRect(-w / 2 + 4, -l / 2 + 12, w - 8, 11); ctx.fillRect(-w / 2 + 4, l / 2 - 14, w - 8, 7);
      ctx.fillStyle = lamp; ctx.fillRect(-w / 2 + 3, -l / 2 - 1, 6, 3); ctx.fillRect(w / 2 - 9, -l / 2 - 1, 6, 3);
      break;
    case 'minivan':
      // коробка со скруглённым носом, лобовое у самого носа, длинные боковые окна, рейлинги
      ctx.fillStyle = '#e8b64c'; ctx.beginPath(); ctx.roundRect(-w / 2, -l / 2, w, l, 9); ctx.fill();
      ctx.fillStyle = glass; ctx.fillRect(-w / 2 + 4, -l / 2 + 7, w - 8, 12);
      ctx.fillRect(-w / 2 + 2, -l / 2 + 22, 4, l - 34); ctx.fillRect(w / 2 - 6, -l / 2 + 22, 4, l - 34);
      ctx.fillRect(-w / 2 + 4, l / 2 - 10, w - 8, 6);
      ctx.fillStyle = trim; ctx.fillRect(-w / 2 + 8, -l / 2 + 22, 2, l - 34); ctx.fillRect(w / 2 - 10, -l / 2 + 22, 2, l - 34);
      ctx.fillStyle = lamp; ctx.fillRect(-w / 2 + 3, -l / 2 - 1, 7, 3); ctx.fillRect(w / 2 - 10, -l / 2 - 1, 7, 3);
      break;
    case 'supercar':
      // клин: узкий нос, широкая корма, низкий кокпит, антикрыло
      ctx.fillStyle = '#ffcf3d'; ctx.beginPath();
      ctx.moveTo(-w / 2 + 6, -l / 2); ctx.lineTo(w / 2 - 6, -l / 2); ctx.lineTo(w / 2, -l / 2 + 16); ctx.lineTo(w / 2, l / 2 - 4);
      ctx.lineTo(-w / 2, l / 2 - 4); ctx.lineTo(-w / 2, -l / 2 + 16); ctx.closePath(); ctx.fill();
      ctx.fillStyle = glass; ctx.beginPath();
      ctx.moveTo(-w / 2 + 7, -l / 2 + 18); ctx.lineTo(w / 2 - 7, -l / 2 + 18); ctx.lineTo(w / 2 - 5, -l / 2 + 30); ctx.lineTo(-w / 2 + 5, -l / 2 + 30); ctx.closePath(); ctx.fill();
      ctx.fillStyle = trim; ctx.fillRect(-4, -l / 2 + 32, 8, l / 2 - 40); ctx.fillRect(-w / 2 + 3, -l / 2 + 4, 6, 3); ctx.fillRect(w / 2 - 9, -l / 2 + 4, 6, 3);
      ctx.fillStyle = '#1a1408'; ctx.fillRect(-w / 2 - 2, l / 2 - 6, w + 4, 4);
      ctx.fillStyle = lamp; ctx.fillRect(-w / 2 + 7, -l / 2 - 1, 5, 2); ctx.fillRect(w / 2 - 12, -l / 2 - 1, 5, 2);
      break;
    case 'bus':
      // длинный корпус, ряд окон по бортам, большое лобовое, световая полоса по крыше
      ctx.fillStyle = '#f0c050'; ctx.beginPath(); ctx.roundRect(-w / 2, -l / 2, w, l, 5); ctx.fill();
      ctx.fillStyle = glass; ctx.fillRect(-w / 2 + 3, -l / 2 + 4, w - 6, 11);
      for (let yy = -l / 2 + 20; yy < l / 2 - 14; yy += 12) { ctx.fillRect(-w / 2 + 2, yy, 4, 8); ctx.fillRect(w / 2 - 6, yy, 4, 8); }
      ctx.fillRect(-w / 2 + 4, l / 2 - 9, w - 8, 5);
      ctx.fillStyle = trim; ctx.fillRect(-2, -l / 2 + 18, 4, l - 30);
      ctx.fillStyle = lamp; ctx.fillRect(-w / 2 + 3, -l / 2 - 1, 7, 3); ctx.fillRect(w / 2 - 10, -l / 2 - 1, 7, 3);
      break;
  }
  ctx.restore();
}

// Полоса вдоль дороги между s0 и s1 со смещением off от осевой — обочина-объезд
function strip(ctx: CanvasRenderingContext2D, path: Path, s0: number, s1: number, off: number, w: number, color: string): void {
  ctx.beginPath(); let first = true;
  for (const p of path.pt) {
    if (p.s < s0 || p.s > s1) continue;
    const x = p.x + p.nx * off, y = p.y + p.ny * off;
    first ? ctx.moveTo(x, y) : ctx.lineTo(x, y); first = false;
  }
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'butt'; ctx.lineJoin = 'round'; ctx.stroke();
}

// Заграждения: обочины, полицейские машины поперёк, ежи, ремонт. Общее для игры и редактора.
export function drawBlocks(ctx: CanvasRenderingContext2D, path: Path, width: number, b: Layout, t: number): void {
  for (const bp of b.bypasses) {
    const off = bp.side * (width / 2 + BLOCK.bypassW / 2);
    strip(ctx, path, bp.s0, bp.s1, off, BLOCK.bypassW, '#30333c');
    ctx.setLineDash([10, 8]); strip(ctx, path, bp.s0, bp.s1, off + bp.side * (BLOCK.bypassW / 2 - 2), 2, 'rgba(236,233,224,.35)'); ctx.setLineDash([]);
  }
  for (const w of b.works) {
    ctx.save(); ctx.translate(w.x, w.y); ctx.rotate(w.h);
    ctx.fillStyle = 'rgba(244,120,40,.12)'; ctx.fillRect(-w.w / 2, -w.l / 2, w.w, w.l);
    // барьер в начале закрытого отрезка (дальний по ходу край — это -l/2, машина едет к -y)
    for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? '#f0f0f0' : '#f0782a'; ctx.fillRect(-w.w / 2 + i * w.w / 6, w.l / 2 - 8, w.w / 6, 8); }
    for (let y = w.l / 2 - 30; y > -w.l / 2; y -= 40) { // конусы вдоль
      ctx.fillStyle = '#f0782a'; ctx.beginPath(); ctx.moveTo(-w.w / 2 + 6, y + 5); ctx.lineTo(-w.w / 2 + 11, y - 5); ctx.lineTo(-w.w / 2 + 16, y + 5); ctx.fill();
      ctx.beginPath(); ctx.moveTo(w.w / 2 - 16, y + 5); ctx.lineTo(w.w / 2 - 11, y - 5); ctx.lineTo(w.w / 2 - 6, y + 5); ctx.fill();
    }
    ctx.restore();
  }
  for (const s of b.spikes) {
    ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.h);
    ctx.fillStyle = '#1a1c22'; ctx.fillRect(-s.w / 2, -s.l / 2, s.w, s.l);
    ctx.fillStyle = '#c9ccd4';
    for (let x = -s.w / 2 + 4; x < s.w / 2 - 2; x += 7) { ctx.beginPath(); ctx.moveTo(x, s.l / 2); ctx.lineTo(x + 2.5, -s.l / 2 - 2); ctx.lineTo(x + 5, s.l / 2); ctx.fill(); }
    ctx.restore();
  }
  for (const p of b.police) drawPolice(ctx, p.x, p.y, p.h, t);
}

// Полицейская машина с мигалкой; t — время для чередования цветов
export function drawPolice(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, t: number): void {
  const red = Math.floor(t / 0.12) % 2 === 0;
  ctx.save(); ctx.translate(x, y); ctx.rotate(h);
  ctx.fillStyle = red ? 'rgba(235,60,60,.22)' : 'rgba(70,110,235,.22)'; ctx.beginPath(); ctx.arc(0, 0, 46, 0, 7); ctx.fill();
  ctx.restore();
  drawCar(ctx, x, y, h, TRAFFIC_SIZE.W, TRAFFIC_SIZE.L, '#e6e8ee', false);
  ctx.save(); ctx.translate(x, y); ctx.rotate(h);
  ctx.fillStyle = red ? '#ff4a4a' : '#3b6cff'; ctx.fillRect(-9, -5, 7, 5);
  ctx.fillStyle = red ? '#3b6cff' : '#ff4a4a'; ctx.fillRect(2, -5, 7, 5);
  ctx.restore();
}

// Сетка земли — ориентир для движения. Границы — видимый прямоугольник в мировых координатах.
export function drawGrid(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, g = 120, lw = 1): void {
  const gx = Math.floor(x0 / g) * g, gy = Math.floor(y0 / g) * g;
  ctx.strokeStyle = 'rgba(255,255,255,.035)'; ctx.lineWidth = lw; ctx.beginPath();
  for (let x = gx; x < x1; x += g) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
  for (let y = gy; y < y1; y += g) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
  ctx.stroke();
}

// Дорога с обочиной, полосами, краями и финишем — в мировых координатах
export function drawRoad(ctx: CanvasRenderingContext2D, path: Path, w: number, finish = true): void {
  // у веток торцы плоские: концы лежат на главной дороге и должны прятаться под ней
  const cap: CanvasLineCap = finish ? 'round' : 'butt';
  poly(ctx, path, 0, [], '#3a3d46', w + 8, cap); poly(ctx, path, 0, [], '#262930', w, cap);
  for (let k = 1; k < LANES; k++) poly(ctx, path, -w / 2 + k * (w / LANES), [26, 22], 'rgba(236,233,224,.28)', 2);
  poly(ctx, path, -w / 2 + 3, [], 'rgba(244,185,66,.5)', 2); poly(ctx, path, w / 2 - 3, [], 'rgba(244,185,66,.5)', 2);
  if (!finish) return;
  const e = pathAt(path, path.L - 60);
  ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(heading(e.tx, e.ty));
  for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#ece9e0' : '#15171c'; ctx.fillRect(-w / 2 + i * w / 8, -6, w / 8, 12); }
  ctx.restore();
}

export function render(ctx: CanvasRenderingContext2D, view: View, sc: Scene): void {
  const { W, H, DPR } = view;
  const { roads, width: w, car, marks, cam } = sc;
  const z = sc.zoom ?? 1;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.fillStyle = '#15171c'; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-cam.x, -cam.y);
  drawGrid(ctx, cam.x - W / 2 / z, cam.y - H / 2 / z, cam.x + W / 2 / z, cam.y + H / 2 / z);
  // ветки под главной: её разметка и финиш сверху на стыках
  for (let i = roads.length - 1; i >= 0; i--) drawRoad(ctx, roads[i].path, w, i === 0);
  for (const r of roads) drawBlocks(ctx, r.path, w, r.blocks, sc.t ?? 0);
  // следы заноса
  for (const m of marks) { ctx.fillStyle = `rgba(0,0,0,${m.a * 0.35})`; ctx.beginPath(); ctx.arc(m.x, m.y, 9, 0, 7); ctx.fill(); }
  // трафик
  for (const r of roads) for (const c of r.traffic) {
    const v = vehiclePose(r.path, c, w);
    drawCar(ctx, v.x, v.y, v.h, c.W, c.L, c.crashed ? '#4a4d55' : c.col, false);
    if (c.panic && !c.crashed) { // «!» над испуганным водителем
      ctx.fillStyle = '#f4b942'; ctx.beginPath(); ctx.arc(v.x, v.y - 34, 11, 0, 7); ctx.fill();
      ctx.fillStyle = '#1a1408'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', v.x, v.y - 33);
    }
  }
  if (sc.chaser) drawPolice(ctx, sc.chaser.x, sc.chaser.y, sc.chaser.h, sc.t ?? 0);
  drawPlayer(ctx, car.x, car.y, car.h, sc.spec);
  ctx.restore();
  // отсвет мигалки снизу экрана — тем ярче, чем ближе преследователь
  if (sc.chaser && sc.chaser.danger > 0) {
    const a = Math.min(0.45, sc.chaser.danger * 0.5);
    const red = Math.floor((sc.t ?? 0) / 0.12) % 2 === 0;
    const g = ctx.createLinearGradient(0, H, 0, H * 0.55);
    g.addColorStop(0, red ? `rgba(235,60,60,${a})` : `rgba(70,110,235,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
}

export function hudHtml(levelName: string, progress: number, car: CarState, tail?: number): string {
  return `${levelName} · ${Math.round(progress * 100)}%${tail !== undefined ? ` · хвост ${Math.round(tail)}` : ''}<br>ω ${car.w.toFixed(2)}${car.skid ? ' <b>занос</b>' : ''}`;
}
