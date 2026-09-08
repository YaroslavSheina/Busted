// Камера, дорога, машины, следы заноса, HUD. drawGrid/drawRoad также использует редактор.
import { BRANCH, LANES, TRAFFIC_SIZE } from './config';
import { heading, laneOff, lanesFor, pathAt, type Path } from './road';
import { vehiclePose, type Vehicle } from './traffic';
import type { CarState } from './physics';
import type { CarSpec } from './cars';
import type { Prop } from './levels';
import type { Layout } from './blocks';
import { widthAt, type WidthFn } from './narrow';
import { RAIL } from './config';
import { trainHead, untilTrain, type Rail } from './rails';
import { CROSS } from './config';
import { crossCars, lightAt, type Crossing } from './crossings';
import { BLOCK } from './config';

export interface View { W: number; H: number; DPR: number }
export interface Mark { x: number; y: number; a: number }
export interface Cam { x: number; y: number }

export interface RoadScene { path: Path; traffic: Vehicle[]; blocks: Layout; width: number | WidthFn; rails?: Rail[]; crossings?: Crossing[]; oncoming?: number; from?: number; parent?: number }

// Эффекты очков: всплывающий текст или искра; t — остаток жизни, с
export interface Fx { x: number; y: number; t: number; text?: string; vx?: number; vy?: number }

export interface Scene {
  roads: RoadScene[]; // 0 — главная (финиш на ней), дальше ветки
  car: CarState & { W: number; L: number };
  spec: CarSpec;
  marks: Mark[];
  cam: Cam;
  t?: number;                                                    // время попытки — для мигалки
  zoom?: number;                                                 // зум камеры (слоу-мо провокации)
  fx?: Fx[];                                                     // всплывающие очки и искры
  air?: number;                                                  // прыжок: 0..1 — фаза полёта, undefined — на земле
  props?: Prop[];                                                // здания и окружение
  nav?: boolean;                                                 // навигатор: линия к гаражу по главной
  chaser?: { x: number; y: number; h: number; danger: number };  // danger: 0 — держит дистанцию, 1 — догнал
}

// Отсечение: статика рисуется только в видимой области (плюс запас). null — рисовать всё
export interface Rect { x0: number; y0: number; x1: number; y1: number }
let clip: Rect | null = null;
export function setClip(r: Rect | null): void { clip = r; }
export const visible = (x: number, y: number, m: number): boolean => !clip || (x >= clip.x0 - m && x <= clip.x1 + m && y >= clip.y0 - m && y <= clip.y1 + m);

// Точки дороги идут через ≤6 px; для рисования хватает каждой третьей: хорда 18 px на радиусе 150 отклоняется на 0.3 px
const STEP = 3;

// off — смещение от осевой: число или функция от s (сужения). Ломаная рисуется кусками, которые видны;
// фаза пунктира привязана к s, чтобы куски не расходились с тем, как рисовалось бы целиком
function poly(ctx: CanvasRenderingContext2D, path: Path, off: number | ((s: number) => number), dash: number[], color: string, lw: number, cap: CanvasLineCap = 'round'): void {
  const pt = path.pt, last = pt.length - 1, m = lw + 60, period = dash.reduce((a, b) => a + b, 0);
  ctx.setLineDash(dash); ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.lineCap = cap;
  let open = false;
  for (let i = 0; i <= last; i += STEP) {
    const p = pt[Math.min(i, last)];
    // точка нужна, если видна сама или соседняя — чтобы кусок доходил до края экрана
    const vis = visible(p.x, p.y, m) || (i > 0 && visible(pt[i - STEP].x, pt[i - STEP].y, m)) || (i + STEP <= last && visible(pt[i + STEP].x, pt[i + STEP].y, m));
    if (!vis) { if (open) { ctx.stroke(); open = false; } continue; }
    const o = typeof off === 'number' ? off : off(p.s);
    const x = p.x + p.nx * o, y = p.y + p.ny * o;
    if (!open) { ctx.beginPath(); ctx.lineDashOffset = period ? p.s % period : 0; ctx.moveTo(x, y); open = true; } else ctx.lineTo(x, y);
    if (i < last && i + STEP > last) { const q = pt[last], oq = typeof off === 'number' ? off : off(q.s); ctx.lineTo(q.x + q.nx * oq, q.y + q.ny * oq); } // последняя точка — всегда
  }
  if (open) ctx.stroke();
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
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
export function drawBlocks(ctx: CanvasRenderingContext2D, path: Path, width: number | WidthFn, b: Layout, t: number): void {
  for (const bp of b.bypasses) {
    const off = bp.side * (widthAt(width, (bp.s0 + bp.s1) / 2) / 2 + BLOCK.bypassW / 2);
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

// Грузовик-рампа: длинный тягач, сзади наклонная рампа с полосами
export function drawRamp(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, w: number, l: number): void {
  ctx.save(); ctx.translate(x, y); ctx.rotate(h);
  ctx.fillStyle = '#5d6470'; ctx.beginPath(); ctx.roundRect(-w / 2, -l / 2, w, l, 4); ctx.fill();
  ctx.fillStyle = 'rgba(20,22,28,.6)'; ctx.fillRect(-w / 2 + 4, -l / 2 + 6, w - 8, 10); // кабина
  // рампа: от середины к корме светлеет — «поднимается»
  const g = ctx.createLinearGradient(0, -l / 2 + 22, 0, l / 2);
  g.addColorStop(0, '#3a3f4a'); g.addColorStop(1, '#8b93a3');
  ctx.fillStyle = g; ctx.fillRect(-w / 2 + 3, -l / 2 + 22, w - 6, l - 25);
  ctx.fillStyle = '#f4b942';
  for (let yy = -l / 2 + 30; yy < l / 2 - 6; yy += 14) { ctx.fillRect(-w / 2 + 3, yy, 5, 6); ctx.fillRect(w / 2 - 8, yy, 5, 6); }
  ctx.fillStyle = '#e04a3a'; ctx.fillRect(-w / 2 + 3, l / 2 - 3, 6, 2); ctx.fillRect(w / 2 - 9, l / 2 - 3, 6, 2);
  ctx.restore();
}

// Переезд: рельсы со шпалами через дорогу, знаки с огнями по краям, состав
export function drawRails(ctx: CanvasRenderingContext2D, rails: Rail[], width: number | WidthFn, time: number): void {
  for (const r of rails) {
    if (!visible(r.x, r.y, RAIL.reach + 60)) continue;
    const w = widthAt(width, r.s);
    ctx.save(); ctx.translate(r.x, r.y); ctx.rotate(r.h); // теперь ось y — вдоль рельсов
    ctx.fillStyle = '#2a2d34'; ctx.fillRect(-20, -RAIL.reach, 40, RAIL.reach * 2); // насыпь
    ctx.fillStyle = '#4a4438';
    for (let t = -RAIL.reach; t < RAIL.reach; t += 18) ctx.fillRect(-16, t, 32, 6); // шпалы
    ctx.fillStyle = '#9aa0ab'; ctx.fillRect(-9, -RAIL.reach, 3, RAIL.reach * 2); ctx.fillRect(6, -RAIL.reach, 3, RAIL.reach * 2); // рельсы
    // знаки с огнями по обе стороны дороги: мигают, когда поезд близко
    const soon = untilTrain(r, time) < RAIL.warn, red = Math.floor(time / 0.25) % 2 === 0;
    for (const side of [-1, 1]) {
      const ty = side * (w / 2 + 16);
      ctx.fillStyle = '#ece9e0'; ctx.fillRect(-3, ty - 10, 6, 20);
      ctx.fillStyle = '#e04a3a'; ctx.fillRect(-3, ty - 10, 6, 5); ctx.fillRect(-3, ty + 2, 6, 5);
      for (const k of [-1, 1]) {
        ctx.fillStyle = soon && (red === (k === -1)) ? '#ff4a4a' : '#3a1c1c';
        ctx.beginPath(); ctx.arc(k * 7, ty, 4, 0, 7); ctx.fill();
      }
    }
    // состав: вагоны с окнами, головной с прожектором
    const head = trainHead(r, time), tail = head - r.def.length;
    if (head > -RAIL.reach && tail < RAIL.reach) {
      const n = Math.max(1, Math.round(r.def.length / 90)), seg = r.def.length / n;
      for (let i = 0; i < n; i++) {
        const y0 = tail + i * seg;
        ctx.fillStyle = i === n - 1 ? '#b8412f' : '#7a5a3a'; ctx.beginPath(); ctx.roundRect(-RAIL.trainW / 2, y0 + 2, RAIL.trainW, seg - 4, 5); ctx.fill();
        ctx.fillStyle = 'rgba(236,233,224,.35)';
        for (let yy = y0 + 12; yy < y0 + seg - 12; yy += 16) ctx.fillRect(-RAIL.trainW / 2 + 5, yy, 6, 8), ctx.fillRect(RAIL.trainW / 2 - 11, yy, 6, 8);
      }
      ctx.fillStyle = 'rgba(255,240,180,.25)'; ctx.beginPath(); ctx.moveTo(-8, head); ctx.lineTo(8, head); ctx.lineTo(30, head + 120); ctx.lineTo(-30, head + 120); ctx.fill();
      ctx.fillStyle = '#fff3c4'; ctx.fillRect(-6, head - 4, 12, 4);
    }
    ctx.restore();
  }
}

// Окружение: здания сверху — корпус, крыша с отступом, сетка окон. Рисуется под дорогами
// Окна зданий — паттерн 16×16 с одной точкой: одна заливка на здание вместо сотен прямоугольников
let windowsPat: CanvasPattern | null = null;
function windowsPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (windowsPat === null && typeof document !== 'undefined') {
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const g = c.getContext('2d'); if (!g) return null;
    g.fillStyle = 'rgba(255,230,160,.08)'; g.fillRect(2, 2, 4, 4);
    windowsPat = ctx.createPattern(c, 'repeat');
  }
  return windowsPat;
}
export function drawProps(ctx: CanvasRenderingContext2D, props: Prop[]): void {
  for (const p of props) {
    if (p.type !== 'building' || !visible(p.x + p.w / 2, p.y + p.h / 2, Math.max(p.w, p.h) / 2 + 10)) continue;
    const t = p.tone ?? 0.5;
    ctx.fillStyle = `rgb(${Math.round(30 + t * 14)},${Math.round(33 + t * 14)},${Math.round(40 + t * 16)})`;
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 3; ctx.strokeRect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = `rgba(255,255,255,${0.03 + t * 0.03})`; ctx.fillRect(p.x + 10, p.y + 10, p.w - 20, p.h - 20);
    const pat = windowsPattern(ctx);
    if (pat) { ctx.fillStyle = pat; ctx.fillRect(p.x + 14, p.y + 14, p.w - 26, p.h - 26); }
  }
}

// Перекрёсток: поперечная улица под маршрутом, светофоры по правым углам, машины группы
// Поперечная улица — не маршрут: асфальт светлее, без разметки, у обоих въездов «кирпич» (drawCrossingTop)
export function drawCrossingRoad(ctx: CanvasRenderingContext2D, c: Crossing): void {
  if (!visible(c.x, c.y, CROSS.reach + 20)) return;
  ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.hCross); // ось y — вдоль поперечной улицы
  ctx.fillStyle = '#3a3d46'; ctx.fillRect(-c.w / 2 - 4, -CROSS.reach, c.w + 8, CROSS.reach * 2);
  ctx.fillStyle = '#2d3038'; ctx.fillRect(-c.w / 2, -CROSS.reach, c.w, CROSS.reach * 2);
  ctx.restore();
}
// «Кирпич»: красный круг с белой перекладиной на столбике посреди въезда
export function drawNoEntry(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = '#1e2026'; ctx.beginPath(); ctx.arc(x, y, 11, 0, 7); ctx.fill();
  ctx.fillStyle = '#d93b3b'; ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.fill();
  ctx.fillStyle = '#f2efe8'; ctx.fillRect(x - 6, y - 1.5, 12, 3);
}
// Стрелка «прямо или в сторону» на асфальте: в крайней полосе со стороны ветки, за s до развилки —
// на развилке доступны оба варианта, поэтому наконечник вперёд и ответвление с наконечником вбок
export function drawTurnArrow(ctx: CanvasRenderingContext2D, path: Path, w: number | WidthFn, s: number, side: 1 | -1): void {
  const p = pathAt(path, s), wa = widthAt(w, s), n = lanesFor(wa);
  const off = laneOff(wa, side > 0 ? n - 1 : 0);
  ctx.save(); ctx.translate(p.x + p.nx * off, p.y + p.ny * off); ctx.rotate(heading(p.tx, p.ty)); // вперёд — −y
  ctx.strokeStyle = 'rgba(236,233,224,.8)'; ctx.fillStyle = 'rgba(236,233,224,.8)'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(0, 30); ctx.lineTo(0, -18); ctx.stroke();                                        // прямо
  ctx.beginPath(); ctx.moveTo(0, -30); ctx.lineTo(-8, -17); ctx.lineTo(8, -17); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(0, 8); ctx.quadraticCurveTo(0, -4, side * 10, -4); ctx.lineTo(side * 14, -4); ctx.stroke(); // в сторону
  ctx.beginPath(); ctx.moveTo(side * 27, -4); ctx.lineTo(side * 13, -13); ctx.lineTo(side * 13, 5); ctx.closePath(); ctx.fill();
  ctx.restore();
}
// Навигатор: пунктир к гаражу по осевой главной дороги; ветки без линии — на свой страх и риск
export function drawNav(ctx: CanvasRenderingContext2D, path: Path): void {
  poly(ctx, path, 0, [30, 24], 'rgba(90,200,255,.3)', 6);
}
// С какой стороны родителя отходит ветка: знак смещения её точки за заходом от оси родителя
export function branchSide(parent: Path, branch: Path, from: number): 1 | -1 {
  const a = pathAt(parent, from), b = pathAt(branch, BRANCH.lead + 220);
  return ((b.x - a.x) * a.nx + (b.y - a.y) * a.ny) >= 0 ? 1 : -1;
}
// Где ставить стрелки перед развилкой: за 120 и 300 px, но не раньше старта и не на входной дуге родителя-ветки
export function arrowSpots(from: number, parentIsBranch: boolean): number[] {
  return [120, 300].map(back => from - back).filter(s => s >= (parentIsBranch ? BRANCH.lead + 340 : 40));
}
export function drawCrossingTop(ctx: CanvasRenderingContext2D, c: Crossing, roadWidth: number, time: number): void {
  if (!visible(c.x, c.y, CROSS.reach + 20)) return;
  const light = lightAt(c, time);
  // зебры через маршрут по обе стороны поперечной улицы
  ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(Math.atan2(c.tx, -c.ty)); // ось y — вдоль маршрута
  ctx.fillStyle = 'rgba(236,233,224,.55)';
  for (const side of [-1, 1]) { const y0 = side * (c.w / 2 + 6) - (side > 0 ? 0 : 20); for (let x = -roadWidth / 2 + 6; x < roadWidth / 2 - 6; x += 12) ctx.fillRect(x, y0, 6, 20); }
  ctx.restore();
  // светофоры на правом углу перед перекрёстком и на левом за ним — оба видны игроку по ходу
  for (const side of [-1, 1] as const) drawNoEntry(ctx, c.x + c.nx * side * (roadWidth / 2 + 30), c.y + c.ny * side * (roadWidth / 2 + 30));
  for (const [side, ahead] of [[1, -1], [-1, 1]] as const) {
    const px = c.x + c.nx * side * (roadWidth / 2 + 14) + c.tx * ahead * (c.w / 2 + 14);
    const py = c.y + c.ny * side * (roadWidth / 2 + 14) + c.ty * ahead * (c.w / 2 + 14);
    ctx.fillStyle = '#1e2026'; ctx.beginPath(); ctx.roundRect(px - 7, py - 16, 14, 32, 4); ctx.fill();
    const cols = [['#5a1c1c', '#ff4a4a'], ['#5a4a10', '#ffcf3d'], ['#1c4a2a', '#4ade80']];
    ['red', 'yellow', 'green'].forEach((l, i) => { ctx.fillStyle = cols[i][light === l ? 1 : 0]; ctx.beginPath(); ctx.arc(px, py - 10 + i * 10, 3.5, 0, 7); ctx.fill(); });
  }
  for (const cc of crossCars(c, time)) drawCar(ctx, cc.x, cc.y, cc.h, cc.W, cc.L, '#8a94a6', false);
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
// Полотно переменной ширины: контур по левому краю вперёд и по правому назад, торцы — полукруги
function ribbon(ctx: CanvasRenderingContext2D, path: Path, half: (s: number) => number, color: string, roundEnds: boolean): void {
  const pt = path.pt, last = pt.length - 1, m = half(0) + 60;
  ctx.fillStyle = color;
  // видимые куски полотна — отдельными контурами: левый край вперёд, правый назад, точки через STEP
  let i = 0;
  while (i <= last) {
    while (i <= last && !visible(pt[i].x, pt[i].y, m)) i += STEP;
    if (i > last) break;
    const i0 = Math.max(0, i - STEP);
    while (i <= last && visible(pt[i].x, pt[i].y, m)) i += STEP;
    const i1 = Math.min(last, i);
    const ks: number[] = []; for (let k = i0; k < i1; k += STEP) ks.push(k); ks.push(i1);
    ctx.beginPath();
    ks.forEach((k, n) => { const p = pt[k], h = half(p.s); const x = p.x - p.nx * h, y = p.y - p.ny * h; n ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    for (let n = ks.length - 1; n >= 0; n--) { const p = pt[ks[n]], h = half(p.s); ctx.lineTo(p.x + p.nx * h, p.y + p.ny * h); }
    ctx.closePath(); ctx.fill();
  }
  if (!roundEnds) return;
  for (const p of [pt[0], pt[pt.length - 1]]) if (visible(p.x, p.y, m)) { ctx.beginPath(); ctx.arc(p.x, p.y, half(p.s), 0, 7); ctx.fill(); }
}

export function drawRoad(ctx: CanvasRenderingContext2D, path: Path, w: number | WidthFn, finish = true, oncoming = 0): void {
  // у веток торцы плоские: концы лежат на главной дороге и должны прятаться под ней
  const cap: CanvasLineCap = finish ? 'round' : 'butt';
  if (typeof w === 'number') {
    // постоянная ширина — штрихом, как в прототипе
    poly(ctx, path, 0, [], '#3a3d46', w + 8, cap); poly(ctx, path, 0, [], '#262930', w, cap);
  } else {
    ribbon(ctx, path, s => w(s) / 2 + 4, '#3a3d46', finish); ribbon(ctx, path, s => w(s) / 2, '#262930', finish);
  }
  const wa = (s: number) => widthAt(w, s);
  for (let k = 1; k < LANES; k++) {
    // граница встречки — сплошная двойная жёлтая; остальные — пунктир
    if (k === oncoming) { poly(ctx, path, s => -wa(s) / 2 + k * (wa(s) / LANES) - 2.5, [], 'rgba(244,185,66,.75)', 2); poly(ctx, path, s => -wa(s) / 2 + k * (wa(s) / LANES) + 2.5, [], 'rgba(244,185,66,.75)', 2); }
    else poly(ctx, path, s => -wa(s) / 2 + k * (wa(s) / LANES), [26, 22], 'rgba(236,233,224,.28)', 2);
  }
  poly(ctx, path, s => -wa(s) / 2 + 3, [], 'rgba(244,185,66,.5)', 2); poly(ctx, path, s => wa(s) / 2 - 3, [], 'rgba(244,185,66,.5)', 2);
  if (!finish) return;
  drawStart(ctx, path, wa(0));
  const e = pathAt(path, path.L - 60), we = wa(path.L - 60);
  ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(heading(e.tx, e.ty));
  drawGarage(ctx, we);
  for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#ece9e0' : '#15171c'; ctx.fillRect(-we / 2 + i * we / 8, -6, we / 8, 12); }
  ctx.restore();
}

// Точка А: парковочное место у старта и метка «A» слева от дороги. Угнал — поехал
function drawStart(ctx: CanvasRenderingContext2D, path: Path, w: number): void {
  const p = pathAt(path, 0);
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(heading(p.tx, p.ty));
  ctx.setLineDash([8, 6]); ctx.strokeStyle = 'rgba(244,185,66,.55)'; ctx.lineWidth = 2;
  ctx.strokeRect(-w / 6, -42, w / 3, 84); ctx.setLineDash([]);
  ctx.fillStyle = '#f4b942'; ctx.beginPath(); ctx.arc(-w / 2 - 24, 0, 13, 0, 7); ctx.fill();
  ctx.fillStyle = '#1a1408'; ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('A', -w / 2 - 24, 1);
  ctx.restore();
}

// Точка Б: гараж в конце дороги — корпус, открытые ворота шириной в дорогу, свет внутри, метка «B».
// Рисуется в системе финишной линии: вперёд по ходу — это −y
function drawGarage(ctx: CanvasRenderingContext2D, w: number): void {
  const bw = w + 64, bl = 230;
  ctx.fillStyle = '#2b2e36'; ctx.fillRect(-bw / 2, -bl, bw, bl + 8);
  ctx.strokeStyle = '#4a4e5a'; ctx.lineWidth = 3; ctx.strokeRect(-bw / 2, -bl, bw, bl + 8);
  ctx.fillStyle = '#1c1e24'; ctx.fillRect(-w / 2, -bl + 14, w, bl - 14);            // пол
  ctx.fillStyle = 'rgba(244,185,66,.12)'; ctx.fillRect(-w / 2, -bl + 14, w, bl - 14); // свет
  ctx.strokeStyle = 'rgba(236,233,224,.15)'; ctx.lineWidth = 1;
  for (let y = -bl + 40; y < -20; y += 26) { ctx.beginPath(); ctx.moveTo(-w / 2 + 8, y); ctx.lineTo(w / 2 - 8, y); ctx.stroke(); }
  ctx.fillStyle = '#f4b942'; ctx.fillRect(-w / 2 - 10, -4, 10, 16); ctx.fillRect(w / 2, -4, 10, 16); // открытые створки
  ctx.fillStyle = '#ece9e0'; ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('ГАРАЖ', 0, -bl - 14);
  ctx.fillStyle = '#f4b942'; ctx.beginPath(); ctx.arc(bw / 2 + 24, 0, 13, 0, 7); ctx.fill();
  ctx.fillStyle = '#1a1408'; ctx.fillText('B', bw / 2 + 24, 1);
}

export function render(ctx: CanvasRenderingContext2D, view: View, sc: Scene): void {
  const { W, H, DPR } = view;
  const { roads, car, marks, cam } = sc;
  const z = sc.zoom ?? 1;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.fillStyle = '#15171c'; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-cam.x, -cam.y);
  setClip({ x0: cam.x - W / 2 / z, y0: cam.y - H / 2 / z, x1: cam.x + W / 2 / z, y1: cam.y + H / 2 / z });
  drawGrid(ctx, cam.x - W / 2 / z, cam.y - H / 2 / z, cam.x + W / 2 / z, cam.y + H / 2 / z);
  // здания под всем, потом поперечные улицы, ветки под главной: её разметка и финиш сверху на стыках
  if (sc.props?.length) drawProps(ctx, sc.props);
  for (const r of roads) for (const c of r.crossings ?? []) drawCrossingRoad(ctx, c);
  for (let i = roads.length - 1; i >= 0; i--) drawRoad(ctx, roads[i].path, roads[i].width, i === 0, roads[i].oncoming ?? 0);
  if (sc.nav) drawNav(ctx, roads[0].path);
  for (const r of roads) if (r.from !== undefined && r.parent !== undefined) { const pr = roads[r.parent], side = branchSide(pr.path, r.path, r.from); for (const s of arrowSpots(r.from, pr.from !== undefined)) drawTurnArrow(ctx, pr.path, pr.width, s, side); }
  for (const r of roads) drawBlocks(ctx, r.path, r.width, r.blocks, sc.t ?? 0);
  for (const r of roads) if (r.rails?.length) drawRails(ctx, r.rails, r.width, sc.t ?? 0);
  for (const r of roads) for (const c of r.crossings ?? []) drawCrossingTop(ctx, c, widthAt(r.width, c.s), sc.t ?? 0);
  // следы заноса
  for (const m of marks) { ctx.fillStyle = `rgba(0,0,0,${m.a * 0.35})`; ctx.beginPath(); ctx.arc(m.x, m.y, 9, 0, 7); ctx.fill(); }
  // трафик
  for (const r of roads) for (const c of r.traffic) {
    const v = vehiclePose(r.path, c, r.width);
    if (!visible(v.x, v.y, 120)) continue;
    if (c.kind === 'ramp') drawRamp(ctx, v.x, v.y, v.h, c.W, c.L);
    else drawCar(ctx, v.x, v.y, v.h, c.W, c.L, c.crashed ? '#4a4d55' : c.col, false);
    if (c.panic && !c.crashed) { // «!» над испуганным водителем
      ctx.fillStyle = '#f4b942'; ctx.beginPath(); ctx.arc(v.x, v.y - 34, 11, 0, 7); ctx.fill();
      ctx.fillStyle = '#1a1408'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', v.x, v.y - 33);
    }
  }
  if (sc.chaser) drawPolice(ctx, sc.chaser.x, sc.chaser.y, sc.chaser.h, sc.t ?? 0);
  if (sc.air !== undefined) {
    // в полёте: тень на земле, машина крупнее по дуге
    const k = Math.sin(Math.PI * sc.air), sc2 = 1 + 0.45 * k;
    ctx.fillStyle = `rgba(0,0,0,${0.35 - 0.2 * k})`; ctx.beginPath(); ctx.ellipse(car.x, car.y, car.W * 0.7, car.L * 0.55, car.h, 0, 7); ctx.fill();
    ctx.save(); ctx.translate(car.x, car.y - 30 * k); ctx.scale(sc2, sc2); ctx.translate(-car.x, -car.y);
    drawPlayer(ctx, car.x, car.y, car.h, sc.spec);
    ctx.restore();
  } else drawPlayer(ctx, car.x, car.y, car.h, sc.spec);
  // искры и всплывающие очки — в мире, но текст не вращается с камерой (камера и так не вращается)
  for (const f of sc.fx ?? []) {
    const a = Math.min(1, f.t * 2);
    if (f.text) {
      ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(20,22,28,${a * 0.7})`; ctx.fillText(f.text, f.x + 1, f.y + 1);
      ctx.fillStyle = `rgba(244,185,66,${a})`; ctx.fillText(f.text, f.x, f.y);
    } else {
      ctx.strokeStyle = `rgba(255,220,120,${a})`; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(f.x, f.y); ctx.lineTo(f.x - (f.vx ?? 0) * 0.03, f.y - (f.vy ?? 0) * 0.03); ctx.stroke();
    }
  }
  ctx.restore();
  setClip(null);
  // отсвет мигалки снизу экрана — тем ярче, чем ближе преследователь
  if (sc.chaser && sc.chaser.danger > 0) {
    const a = Math.min(0.45, sc.chaser.danger * 0.5);
    const red = Math.floor((sc.t ?? 0) / 0.12) % 2 === 0;
    const g = ctx.createLinearGradient(0, H, 0, H * 0.55);
    g.addColorStop(0, red ? `rgba(235,60,60,${a})` : `rgba(70,110,235,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
}

export const fmtScore = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export function hudHtml(levelName: string, progress: number, car: CarState, tail?: number, score?: number): string {
  const top = score !== undefined ? `<span class="score">${fmtScore(score)}</span><br>` : '';
  return `${top}${levelName} · ${Math.round(progress * 100)}%${tail !== undefined ? ` · хвост ${Math.round(tail)}` : ''}<br>ω ${car.w.toFixed(2)}${car.skid ? ' <b>занос</b>' : ''}`;
}
