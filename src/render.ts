// Камера, дорога, машины, следы заноса, HUD.
import { LANES } from './config';
import { heading, pathAt, type Path } from './road';
import { vehiclePose, type Vehicle } from './traffic';
import type { CarState } from './physics';

export interface View { W: number; H: number; DPR: number }
export interface Mark { x: number; y: number; a: number }
export interface Cam { x: number; y: number }

export interface Scene {
  path: Path;
  width: number;
  car: CarState & { W: number; L: number };
  traffic: Vehicle[];
  marks: Mark[];
  cam: Cam;
}

function poly(ctx: CanvasRenderingContext2D, path: Path, off: number, dash: number[], color: string, lw: number): void {
  ctx.beginPath();
  const pt = path.pt;
  for (let i = 0; i < pt.length; i++) {
    const p = pt[i];
    const x = p.x + p.nx * off, y = p.y + p.ny * off;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.setLineDash(dash); ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.stroke(); ctx.setLineDash([]);
}

function drawCar(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, w: number, l: number, col: string, player: boolean): void {
  ctx.save(); ctx.translate(x, y); ctx.rotate(h);
  ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(-w / 2, -l / 2, w, l, 6); ctx.fill();
  ctx.fillStyle = 'rgba(20,22,28,.55)'; ctx.fillRect(-w / 2 + 4, -l / 2 + 12, w - 8, 11); ctx.fillRect(-w / 2 + 4, l / 2 - 14, w - 8, 7);
  if (player) { ctx.fillStyle = '#fff3c4'; ctx.fillRect(-w / 2 + 3, -l / 2 - 1, 6, 3); ctx.fillRect(w / 2 - 9, -l / 2 - 1, 6, 3); }
  else { ctx.fillStyle = '#e04a3a'; ctx.fillRect(-w / 2 + 3, l / 2 - 2, 6, 2); ctx.fillRect(w / 2 - 9, l / 2 - 2, 6, 2); }
  ctx.restore();
}

export function render(ctx: CanvasRenderingContext2D, view: View, sc: Scene): void {
  const { W, H, DPR } = view;
  const { path, width: w, car, traffic, marks, cam } = sc;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.fillStyle = '#15171c'; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.translate(W / 2 - cam.x, H / 2 - cam.y);
  // сетка земли — ориентир для движения
  const g = 120, x0 = Math.floor((cam.x - W / 2) / g) * g, y0 = Math.floor((cam.y - H / 2) / g) * g;
  ctx.strokeStyle = 'rgba(255,255,255,.035)'; ctx.lineWidth = 1; ctx.beginPath();
  for (let x = x0; x < cam.x + W / 2; x += g) { ctx.moveTo(x, cam.y - H / 2); ctx.lineTo(x, cam.y + H / 2); }
  for (let y = y0; y < cam.y + H / 2; y += g) { ctx.moveTo(cam.x - W / 2, y); ctx.lineTo(cam.x + W / 2, y); }
  ctx.stroke();
  // дорога
  poly(ctx, path, 0, [], '#3a3d46', w + 8); poly(ctx, path, 0, [], '#262930', w);
  for (let k = 1; k < LANES; k++) poly(ctx, path, -w / 2 + k * (w / LANES), [26, 22], 'rgba(236,233,224,.28)', 2);
  poly(ctx, path, -w / 2 + 3, [], 'rgba(244,185,66,.5)', 2); poly(ctx, path, w / 2 - 3, [], 'rgba(244,185,66,.5)', 2);
  // финиш
  const e = pathAt(path, path.L - 60);
  ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(heading(e.tx, e.ty));
  for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#ece9e0' : '#15171c'; ctx.fillRect(-w / 2 + i * w / 8, -6, w / 8, 12); }
  ctx.restore();
  // следы заноса
  for (const m of marks) { ctx.fillStyle = `rgba(0,0,0,${m.a * 0.35})`; ctx.beginPath(); ctx.arc(m.x, m.y, 9, 0, 7); ctx.fill(); }
  // трафик
  for (const c of traffic) { const v = vehiclePose(path, c, w); drawCar(ctx, v.x, v.y, v.h, c.W, c.L, c.col, false); }
  drawCar(ctx, car.x, car.y, car.h, car.W, car.L, '#f4b942', true);
  ctx.restore();
}

export function hudHtml(levelName: string, progress: number, car: CarState): string {
  return `${levelName} · ${Math.round(progress * 100)}%<br>ω ${car.w.toFixed(2)}${car.skid ? ' <b>занос</b>' : ''}`;
}
