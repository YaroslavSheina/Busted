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
import { art, procTile, sprite, tile } from './art';
import { BLOCK } from './config';

export interface View { W: number; H: number; DPR: number }
export interface Mark { x: number; y: number; a: number }
export interface Cam { x: number; y: number }

export interface RoadScene { path: Path; traffic: Vehicle[]; blocks: Layout; width: number | WidthFn; rails?: Rail[]; crossings?: Crossing[]; oncoming?: number; from?: number; parent?: number }

// Эффекты очков: всплывающий текст или искра; t — остаток жизни, с
export interface Fx { x: number; y: number; t: number; text?: string; vx?: number; vy?: number }
// Вспышка из листа кадров: boom — взрыв (15 кадров), smoke — клуб дыма (10); age — секунд с начала; size — px; dur — длительность
export interface Blast { kind: 'boom' | 'smoke'; x: number; y: number; age: number; size: number; dur: number }

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
  blasts?: Blast[];                                              // взрывы и дым
  shake?: number;                                                // тряска камеры, px (только рисование — cam не трогается)
  wrecked?: boolean;                                             // машина игрока разбита: тёмная, повёрнута
}

// Тема. comic — рисованный вид сверху в духе ранних GTA (диздок): контуры, плоские цвета, тротуары в городе,
// тени под машинами и зданиями. night — прежний тёмный вид (?theme=night). Физика и данные о теме не знают
export type ThemeName = 'comic' | 'night' | 'dark' | 'bright' | 'sprites' | 'pixel' | 'pixelnight';
interface Theme {
  ground: string; grid: string; asphalt: string; shoulder: string; cross: string;
  lane: string; edge: string; dyellow: string;
  outline: string | null;   // контур дорог и машин; null — без контуров
  sidewalk: string | null;  // тротуары вдоль дорог в городе; null — без тротуаров
  shadow: string | null;    // тень под машинами и зданиями
  roofs: string[] | null;   // цвета крыш; null — серые коробки с окнами
  sprites?: 'hf' | 'pixel'; // растровые спрайты машин: hf — сгенерированные в Higgsfield с тайлами, pixel — референсы пользователя
  dash?: [number, number];  // штрих и просвет пунктира полос
  parapet?: string;         // парапет крыши (pixel): светлая кромка по периметру здания
  slabs?: string;           // линии плит тротуара (pixel)
  lights?: string;          // фонари вдоль тротуаров (pixel)
  windows?: string;         // светящиеся окна фасадов (pixelnight) — ночь: часть окон горит тёплым светом с ореолом
  walls?: [string, string]; // цвет южной и восточной стены под парапетом (pixel)
  zebra?: string;           // полосы зебры (pixel)
}
const COMIC: Theme = { ground: '#474c55', grid: 'rgba(255,255,255,.04)', asphalt: '#2e3138', shoulder: '#3a3d46', cross: '#33363d',
  lane: 'rgba(240,238,230,.55)', edge: 'rgba(244,185,66,.75)', dyellow: 'rgba(244,185,66,.9)', outline: '#14161a', sidewalk: '#8f949c', shadow: 'rgba(0,0,0,.35)',
  roofs: ['#8a5a4a', '#6f7d5a', '#5b6b85', '#9a8a62', '#7a6c8a', '#6d7a80'] };
const THEMES: Record<ThemeName, Theme> = {
  night: { ground: '#15171c', grid: 'rgba(255,255,255,.035)', asphalt: '#262930', shoulder: '#3a3d46', cross: '#2d3038',
    lane: 'rgba(236,233,224,.28)', edge: 'rgba(244,185,66,.5)', dyellow: 'rgba(244,185,66,.75)', outline: null, sidewalk: null, shadow: null, roofs: null },
  comic: COMIC,
  // тёмный комикс: ночь с контурами, как GTA 2
  dark: { ...COMIC, ground: '#1d2026', grid: 'rgba(255,255,255,.03)', asphalt: '#24272d', cross: '#282b31', sidewalk: '#4a4f58', outline: '#0b0c0f', shadow: 'rgba(0,0,0,.5)',
    lane: 'rgba(240,238,230,.4)', roofs: ['#4a3a38', '#3b4a3a', '#33405a', '#5a5040', '#463c52', '#3a464c'] },
  // яркий день: насыщенные крыши, тёплая земля, как GTA 1
  bright: { ...COMIC, ground: '#8a9a7a', grid: 'rgba(0,0,0,.05)', asphalt: '#4a4d55', cross: '#50535b', sidewalk: '#c9c4b4', outline: '#2a2320', shadow: 'rgba(0,0,0,.3)',
    lane: 'rgba(255,255,255,.7)', edge: 'rgba(255,205,70,.9)', dyellow: 'rgba(255,205,70,1)', roofs: ['#c8654e', '#5f9e6e', '#4f7fb5', '#d1a94f', '#9a6fb8', '#e08a4e'] },
  // спрайты и текстуры из Higgsfield поверх геометрии comic
  sprites: { ...COMIC, sprites: 'hf' },
  // по референсам пользователя (docs/refs/road.png и машины): сине-серый асфальт, короткие белые штрихи, двойная жёлтая,
  // светлый бордюр вместо контура, плитка тротуара, серые крыши с бежевым парапетом и длинной тенью, фонари; машины — спрайты
  pixel: { ground: '#3b4046', grid: 'rgba(0,0,0,.06)', asphalt: '#3a4149', shoulder: '#c6c8bf', cross: '#3a4149',
    lane: 'rgba(222,224,216,.9)', edge: '', dyellow: '#d9b830', outline: '#c6c8bf', sidewalk: '#9ba0a5', shadow: 'rgba(0,0,0,.28)',
    roofs: ['#5f656c', '#656b72', '#585e65', '#6a6f76', '#616770'], sprites: 'pixel', dash: [18, 26], parapet: '#cdbf9f', slabs: '#8b9096', lights: '#2c3036',
    walls: ['#6b5a4c', '#54463c'], zebra: 'rgba(236,233,224,.9)' },
  // ночь по референсу docs/refs/night road.png (2026-09-10): тёмно-синий асфальт, голубовато-серые штрихи, оливковая двойная,
  // светлый бордюр, плитка тротуара со светлыми швами, крыши темнее тротуара, парапет и стены сине-серые, окна фасадов горят
  pixelnight: { ground: '#253a52', grid: 'rgba(0,0,0,0)', asphalt: '#0c182c', shoulder: '#556e81', cross: '#0c182c',
    lane: '#45637c', edge: '', dyellow: '#505330', outline: '#556e81', sidewalk: '#253a52', shadow: 'rgba(0,0,0,.35)',
    roofs: ['#14263a', '#132438', '#172a40', '#112235', '#152840'], sprites: 'pixel', dash: [18, 26], parapet: '#526d84', slabs: '#364d65', lights: '#202f44',
    walls: ['#0b1220', '#070d18'], zebra: '#445e78', windows: '#d9b565' },
};
// Основная тема — pixelnight: ночная улица по референсам пользователя (2026-09-10); прежняя night и остальные — ?theme=…
let T: Theme = THEMES.pixelnight;
export function setTheme(name: string | null | undefined): void { T = THEMES[(name as ThemeName)] ?? THEMES.pixelnight; }
export const groundColor = (): string => T.ground;
export const themeName = (): ThemeName => (Object.keys(THEMES) as ThemeName[]).find(k => THEMES[k] === T) ?? 'comic';
let city = false; // тротуары вдоль дорог — только там, где есть здания
export function setCity(v: boolean): void { city = v; }
const SIDEWALK = 26;

// Отсечение: статика рисуется только в видимой области (плюс запас). null — рисовать всё
export interface Rect { x0: number; y0: number; x1: number; y1: number }
let clip: Rect | null = null;
export function setClip(r: Rect | null): void { clip = r; }
export const visible = (x: number, y: number, m: number): boolean => !clip || (x >= clip.x0 - m && x <= clip.x1 + m && y >= clip.y0 - m && y <= clip.y1 + m);

// Точки дороги идут через ≤6 px; для рисования хватает каждой третьей: хорда 18 px на радиусе 150 отклоняется на 0.3 px
const STEP = 3;

// Сплошная линия со смещением off от осевой (число или функция от s — сужения). Рисуется кусками, которые видны
function poly(ctx: CanvasRenderingContext2D, path: Path, off: number | ((s: number) => number), color: string | CanvasPattern, lw: number, cap: CanvasLineCap = 'round'): void {
  const pt = path.pt, last = pt.length - 1, m = lw + 60;
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.lineCap = cap;
  let open = false;
  for (let i = 0; i <= last; i += STEP) {
    const p = pt[Math.min(i, last)];
    // точка нужна, если видна сама или соседняя — чтобы кусок доходил до края экрана
    const vis = visible(p.x, p.y, m) || (i > 0 && visible(pt[i - STEP].x, pt[i - STEP].y, m)) || (i + STEP <= last && visible(pt[i + STEP].x, pt[i + STEP].y, m));
    if (!vis) { if (open) { ctx.stroke(); open = false; } continue; }
    const o = typeof off === 'number' ? off : off(p.s);
    const x = p.x + p.nx * o, y = p.y + p.ny * o;
    if (!open) { ctx.beginPath(); ctx.moveTo(x, y); open = true; } else ctx.lineTo(x, y);
    if (i < last && i + STEP > last) { const q = pt[last], oq = typeof off === 'number' ? off : off(q.s); ctx.lineTo(q.x + q.nx * oq, q.y + q.ny * oq); } // последняя точка — всегда
  }
  if (open) ctx.stroke();
}

// Пунктир: каждый штрих стоит на своём месте по s (от k·период до k·период + on), поэтому не «ползёт»,
// когда видимый кусок дороги начинается с другой точки. Рисуются штрихи в видимом диапазоне s
function dashed(ctx: CanvasRenderingContext2D, path: Path, off: number | ((s: number) => number), on: number, gap: number, color: string, lw: number): void {
  const pt = path.pt, period = on + gap, m = lw + 60;
  let s0 = Infinity, s1 = -Infinity;
  for (let i = 0; i < pt.length; i += STEP) { const p = pt[i]; if (visible(p.x, p.y, m)) { if (p.s < s0) s0 = p.s; if (p.s > s1) s1 = p.s; } }
  if (s0 === Infinity) return;
  const at = (s: number) => { const p = pathAt(path, s), o = typeof off === 'number' ? off : off(s); return [p.x + p.nx * o, p.y + p.ny * o]; };
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
  ctx.beginPath();
  let i = 0;
  for (let k = Math.max(0, Math.floor((s0 - period) / period)); k * period <= s1 && k * period < path.L; k++) {
    const a = k * period, b = Math.min(a + on, path.L);
    const [ax, ay] = at(a); ctx.moveTo(ax, ay);
    while (i < pt.length && pt[i].s <= a) i++;                      // точки внутри штриха — по ним идёт кривая
    for (; i < pt.length && pt[i].s < b; i++) { const p = pt[i], o = typeof off === 'number' ? off : off(p.s); ctx.lineTo(p.x + p.nx * o, p.y + p.ny * o); }
    const [bx, by] = at(b); ctx.lineTo(bx, by);
  }
  ctx.stroke();
}

// Комикс-подложка машины: тень со сдвигом и четыре колеса, чуть выступающие из-под кузова
function carUnder(ctx: CanvasRenderingContext2D, w: number, l: number, r: number): void {
  if (!T.shadow) return;
  ctx.fillStyle = T.shadow; ctx.beginPath(); ctx.roundRect(-w / 2 + 3, -l / 2 + 5, w, l, r); ctx.fill();
  ctx.fillStyle = '#101216';
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) ctx.fillRect(sx * (w / 2 - 2) - 2.5, sy * (l / 2 - 13) - 5, 5, 10);
}
// Контур кузова
function carOutline(ctx: CanvasRenderingContext2D, trace: () => void): void {
  if (!T.outline) return;
  ctx.strokeStyle = T.outline; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath(); trace(); ctx.stroke();
}
// Спрайт машины поверх тени: картинка вписывается в длину l с сохранением пропорций
function carSprite(ctx: CanvasRenderingContext2D, key: string, w: number, l: number, col?: string, alpha = 0.55): boolean {
  if (!T.sprites) return false;
  const img = sprite(key, col, alpha); if (!img) return false;
  if (T.shadow) { ctx.fillStyle = T.shadow; ctx.beginPath(); ctx.roundRect(-w / 2 + 3, -l / 2 + 5, w, l, 6); ctx.fill(); }
  const k = (l + 6) / img.height, dw = img.width * k, dh = img.height * k;
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  return true;
}
// Спрайт предмета (pixel): вписывается по высоте dh (или ширине dw), центр в (dx, dy); false — тема без спрайтов или картинка ещё не загружена
function propSprite(ctx: CanvasRenderingContext2D, key: string, dw?: number, dh?: number, dx = 0, dy = 0): boolean {
  if (T.sprites !== 'pixel') return false;
  const img = sprite('px_' + key); if (!img) return false;
  const k = dh !== undefined ? dh / img.height : dw! / img.width, w = img.width * k, h = img.height * k;
  ctx.drawImage(img, dx - w / 2, dy - h / 2, w, h);
  return true;
}
// Пул легковых спрайтов трафика (pixel): по «монетке» машины — у каждой своя модель, но одна и та же каждый кадр
const PIXEL_POOL = ['px_gray_sedan', 'px_white_sedan', 'px_pick_up', 'px_jeep', 'px_retro_1', 'px_retro_2', 'px_retro_3', 'px_roadster', 'px_sport_car', 'px_muscle_car'];
const poolKey = (pick: number) => PIXEL_POOL[Math.floor(((Math.abs(pick) * 7919) % 1) * PIXEL_POOL.length)];
// Спрайт по модели трафика (pixel): длинные — из референсов, легковые — из пула
function modelKey(model: string | undefined, pick: number): string {
  switch (model) {
    case 'bus': return 'px_bus';
    case 'truck': return Math.abs(pick) * 3 % 1 < 0.5 ? 'px_truck_1' : 'px_truck_2';
    case 'tanker': return 'px_gasoline';
    case 'limo': return 'px_limousine';
    case 'van': return 'px_happy_bus';
    default: return poolKey(pick);
  }
}
export function drawCar(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, w: number, l: number, col: string, player: boolean, pick = 0.5, model?: string): void {
  ctx.save(); ctx.translate(x, y); ctx.rotate(h);
  const police = col === '#e6e8ee';
  if (T.sprites === 'pixel' ? carSprite(ctx, police ? 'px_police_regular' : modelKey(model, pick), w, l)
    : (!model || model === 'car') && carSprite(ctx, police ? 'police' : 'car', w, l, police ? undefined : col)) { ctx.restore(); return; }
  carUnder(ctx, w, l, 6);
  ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(-w / 2, -l / 2, w, l, 6); ctx.fill();
  ctx.fillStyle = 'rgba(20,22,28,.55)'; ctx.fillRect(-w / 2 + 4, -l / 2 + 12, w - 8, 11); ctx.fillRect(-w / 2 + 4, l / 2 - 14, w - 8, 7);
  if (player) { ctx.fillStyle = '#fff3c4'; ctx.fillRect(-w / 2 + 3, -l / 2 - 1, 6, 3); ctx.fillRect(w / 2 - 9, -l / 2 - 1, 6, 3); }
  else { ctx.fillStyle = '#e04a3a'; ctx.fillRect(-w / 2 + 3, l / 2 - 2, 6, 2); ctx.fillRect(w / 2 - 9, l / 2 - 2, 6, 2); }
  carOutline(ctx, () => ctx.roundRect(-w / 2, -l / 2, w, l, 6));
  ctx.restore();
}

// Машина игрока: силуэт и детали зависят от кузова. Векторные заглушки до комикс-арта (фаза H).
// Кадр из листа: n кадров по size px в ряд; frame — 0..n-1
function drawFrame(ctx: CanvasRenderingContext2D, key: string, n: number, frame: number, x: number, y: number, size: number, alpha = 1): boolean {
  const img = art(key); if (!img) return false;
  const fw = img.width / n, k = Math.max(0, Math.min(n - 1, Math.floor(frame)));
  ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(img, k * fw, 0, fw, img.height, x - size / 2, y - size / 2, size, size); ctx.restore();
  return true;
}
// Взрывы и дым: кадры листа по возрасту; без листа — векторные круги того же цвета
export function drawBlasts(ctx: CanvasRenderingContext2D, blasts: Blast[]): void {
  for (const b of blasts) {
    const p = Math.min(1, b.age / b.dur);
    if (b.kind === 'boom') {
      if (drawFrame(ctx, 'boom', 15, p * 15, b.x, b.y, b.size)) continue;
      ctx.fillStyle = `rgba(255,${Math.round(200 - p * 150)},60,${1 - p})`; ctx.beginPath(); ctx.arc(b.x, b.y, b.size * (0.2 + p * 0.4), 0, 7); ctx.fill();
    } else {
      if (drawFrame(ctx, 'smoke', 10, p * 10, b.x, b.y, b.size, 1 - p * 0.5)) continue;
      ctx.fillStyle = `rgba(200,205,215,${0.5 * (1 - p)})`; ctx.beginPath(); ctx.arc(b.x, b.y, b.size * (0.2 + p * 0.3), 0, 7); ctx.fill();
    }
  }
}

export function drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, spec: CarSpec, wrecked = false): void {
  const { W: w, L: l } = spec;
  if (wrecked) { // разбитая: та же машина, развёрнутая боком и затемнённая, как на макете из референсов
    ctx.save(); ctx.translate(x, y); ctx.rotate(h + 0.9);
    drawPlayer(ctx, 0, 0, 0, spec);
    ctx.fillStyle = 'rgba(10,8,12,.55)'; ctx.beginPath(); ctx.roundRect(-w / 2 - 1, -l / 2 - 1, w + 2, l + 2, 6); ctx.fill();
    ctx.restore(); return;
  }
  const glass = 'rgba(20,22,28,.6)', trim = 'rgba(20,22,28,.35)', lamp = '#fff3c4';
  const wedge = () => { ctx.moveTo(-w / 2 + 6, -l / 2); ctx.lineTo(w / 2 - 6, -l / 2); ctx.lineTo(w / 2, -l / 2 + 16); ctx.lineTo(w / 2, l / 2 - 4); ctx.lineTo(-w / 2, l / 2 - 4); ctx.lineTo(-w / 2, -l / 2 + 16); ctx.closePath(); };
  const round = { sedan: 6, minivan: 9, supercar: 0, bus: 5, muscle: 5, sport: 3 }[spec.body];
  ctx.save(); ctx.translate(x, y); ctx.rotate(h);
  // pixel: кузов игрока — свой референс, подкрашенный в жёлтый (школьный автобус и так жёлтый)
  const PX: Record<string, [string, string | undefined]> = { sedan: ['px_white_sedan', '#f4b942'], minivan: ['px_happy_bus', '#f4b942'], supercar: ['px_super_car', '#f4b942'], bus: ['px_schoolbus', undefined],
    muscle: ['px_muscle_car', '#f4b942'], sport: ['px_sport_car', '#f4b942'] };
  const tint = spec.tint === undefined ? PX[spec.body][1] : spec.tint ?? undefined; // машина может просить родной цвет спрайта (спорткар пролога — красный)
  if (T.sprites === 'pixel' ? carSprite(ctx, PX[spec.body][0], w, l, tint, 0.7) : spec.body === 'sedan' && carSprite(ctx, 'sedan', w, l)) { ctx.restore(); return; }
  carUnder(ctx, w, l, round);
  switch (spec.body) {
    case 'muscle': case 'sport': // векторная заглушка до загрузки спрайта — как седан
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
      ctx.fillStyle = '#ffcf3d'; ctx.beginPath(); wedge(); ctx.fill();
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
  carOutline(ctx, spec.body === 'supercar' ? wedge : () => ctx.roundRect(-w / 2, -l / 2, w, l, round ?? 6));
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
  const closed = new Set(b.works.map(w => `${w.s}:${w.lane}`)); // соседние закрытые полосы одного ремонта — без конусов между ними
  for (const w of b.works) {
    ctx.save(); ctx.translate(w.x, w.y); ctx.rotate(w.h);
    if (T.sprites === 'pixel' && sprite('px_cone')) { // pixel: конусы по открытым краям и в торце, погрузчик с коробками в первой закрытой полосе, коробки на асфальте
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(-w.w / 2, -w.l / 2, w.w, w.l);
      const left = closed.has(`${w.s}:${w.lane - 1}`), right = closed.has(`${w.s}:${w.lane + 1}`);
      const k = Math.floor(Math.abs(w.x * 0.37 + w.y * 0.53)) % 4;
      if (w.l >= 160 && !left) { propSprite(ctx, k % 2 ? 'loader_boxes' : 'loader', undefined, 54, 0, w.l / 2 - 70); propSprite(ctx, 'box_' + (k + 1), 14, undefined, -w.w / 4, w.l / 2 - 110); }
      else propSprite(ctx, 'box_' + ((k + 3) % 4 + 1), 14, undefined, -w.w / 4 + 4, w.l / 2 - 60);
      propSprite(ctx, 'box_' + ((k + 2) % 4 + 1), 14, undefined, w.w / 4 - 2, -w.l / 2 + 40);
      for (let y = w.l / 2 - 6; y > -w.l / 2; y -= 36) { if (!left) propSprite(ctx, 'cone', undefined, 14, -w.w / 2 + 8, y); if (!right) propSprite(ctx, 'cone', undefined, 14, w.w / 2 - 8, y); }
      for (let x = -w.w / 2 + (left ? 6 : 22); x < w.w / 2 - (right ? 0 : 14); x += 14) propSprite(ctx, 'cone', undefined, 14, x, w.l / 2 - 6);
      ctx.restore(); continue;
    }
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
    // pixel: лента ежей поперёк полосы; база с мигалкой у края дороги (в крайних полосах), в средней — без базы
    if (propSprite(ctx, s.lane === 0 ? 'spikes_l' : s.lane === LANES - 1 ? 'spikes_r' : 'spikes_m', s.w + 4)) { ctx.restore(); continue; }
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
  if (T.sprites === 'pixel' && carSprite(ctx, 'px_truck_4', w, l)) { ctx.restore(); return; } // автовоз с опущенной рампой из референсов
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
  if (T.roofs) { drawRoofs(ctx, props); return; }
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

// Комикс-здания: тень к юго-востоку, цветная крыша по tone, контур, светлая кромка, пара будок на крыше
function drawRoofs(ctx: CanvasRenderingContext2D, props: Prop[]): void {
  const roofs = T.roofs!;
  const seen = props.filter(p => p.type === 'building' && visible(p.x + p.w / 2, p.y + p.h / 2, Math.max(p.w, p.h) / 2 + 20));
  if (T.shadow) { const [dx, dy] = T.parapet ? [26, 30] : [10, 12]; ctx.fillStyle = T.shadow; for (const p of seen) ctx.fillRect(p.x + dx, p.y + dy, p.w + (T.parapet ? 10 : 0), p.h + (T.parapet ? 10 : 0)); }
  for (const p of seen) {
    const t = p.tone ?? 0.5, k = Math.floor(t * 97) % roofs.length;
    if (T.parapet) { // pixel: бежевый парапет по периметру, крыша внутри, тёмная кромка с юга и востока, будки с вентиляцией
      // солнце слева сверху: видны южная и восточная стены под парапетом (фасад), восточная темнее
      const WALL = 10;
      ctx.fillStyle = T.walls![0]; ctx.fillRect(p.x, p.y + p.h, p.w + WALL, WALL);
      ctx.fillStyle = T.walls![1]; ctx.fillRect(p.x + p.w, p.y, WALL, p.h);
      if (T.windows) { // ночь: часть окон фасада горит тёплым светом с ореолом на тротуаре, остальные тёмные
        let i = 0;
        for (let x = p.x + 14; x < p.x + p.w - 8; x += 22, i++) {
          const lit = ((t * 1000 + i * 41) % 7) < 3;
          if (lit) { ctx.fillStyle = 'rgba(217,181,101,.14)'; ctx.fillRect(x - 6, p.y + p.h + 1, 20, 22); }
          ctx.fillStyle = lit ? T.windows : 'rgba(0,0,0,.45)'; ctx.fillRect(x, p.y + p.h + 3, 8, 4);
        }
        // контейнер у южной стены — на каждом третьем здании
        if (k % 3 === 0 && p.w > 120) { ctx.save(); ctx.translate(p.x + 34, p.y + p.h + WALL + 16); propSprite(ctx, 'trash_can', 34); ctx.restore(); }
      } else { ctx.fillStyle = 'rgba(0,0,0,.35)'; for (let x = p.x + 14; x < p.x + p.w - 8; x += 22) ctx.fillRect(x, p.y + p.h + 3, 8, 4); } // окна фасада
      ctx.fillStyle = T.parapet; ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(p.x + p.w - 10, p.y, 10, p.h); ctx.fillRect(p.x, p.y + p.h - 10, p.w, 10);
      ctx.fillStyle = roofs[k]; ctx.fillRect(p.x + 12, p.y + 12, p.w - 24, p.h - 24);
      ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(p.x + 12, p.y + p.h - 18, p.w - 24, 6); ctx.fillRect(p.x + p.w - 18, p.y + 12, 6, p.h - 24);
      const n = 1 + Math.floor(t * 13) % 3;
      for (let i = 0; i < n; i++) {
        const bw = 22 + ((k + i * 7) % 3) * 8, bh = 18 + ((k + i * 5) % 3) * 6;
        const bx = p.x + 30 + ((t * 1000 + i * 137) % Math.max(1, p.w - 60 - bw)), by = p.y + 30 + ((t * 3170 + i * 89) % Math.max(1, p.h - 60 - bh));
        ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(bx + 4, by + 4, bw, bh);
        ctx.fillStyle = T.windows ? '#3c4e5e' : '#9297a0'; ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = T.windows ? '#0b1220' : '#3a3e44'; ctx.lineWidth = 2; ctx.strokeRect(bx, by, bw, bh);
        ctx.fillStyle = T.windows ? '#526d84' : '#5c6169'; for (let y = by + 5; y < by + bh - 3; y += 5) ctx.fillRect(bx + 4, y, bw - 8, 2);
      }
      continue;
    }
    const roofTile = T.sprites ? tile(ctx, 'roof', 256) : null;
    if (roofTile) { ctx.fillStyle = roofTile; ctx.fillRect(p.x, p.y, p.w, p.h); ctx.fillStyle = roofs[k]; ctx.globalAlpha = 0.45; ctx.fillRect(p.x, p.y, p.w, p.h); ctx.globalAlpha = 1; }
    else { ctx.fillStyle = roofs[k]; ctx.fillRect(p.x, p.y, p.w, p.h); }
    ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fillRect(p.x, p.y, p.w, 6); ctx.fillRect(p.x, p.y, 6, p.h);        // свет с северо-запада
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(p.x, p.y + p.h - 6, p.w, 6); ctx.fillRect(p.x + p.w - 6, p.y, 6, p.h);
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 2; ctx.strokeRect(p.x + 12, p.y + 12, p.w - 24, p.h - 24); // парапет
    // будки и люки на крыше — от tone, чтобы крыши не были одинаковыми
    const n = 1 + Math.floor(t * 13) % 3;
    for (let i = 0; i < n; i++) {
      const bw = 26 + ((k + i * 7) % 3) * 10, bh = 22 + ((k + i * 5) % 3) * 8;
      const bx = p.x + 24 + ((t * 1000 + i * 137) % Math.max(1, p.w - 48 - bw)), by = p.y + 24 + ((t * 3170 + i * 89) % Math.max(1, p.h - 48 - bh));
      if (T.shadow) { ctx.fillStyle = T.shadow; ctx.fillRect(bx + 4, by + 5, bw, bh); }
      ctx.fillStyle = 'rgba(255,255,255,.10)'; ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = T.outline ?? '#000'; ctx.lineWidth = 2; ctx.strokeRect(bx, by, bw, bh);
    }
    ctx.strokeStyle = T.outline ?? 'rgba(0,0,0,.45)'; ctx.lineWidth = 3; ctx.strokeRect(p.x, p.y, p.w, p.h);
  }
}

// Перекрёсток: поперечная улица под маршрутом, светофоры по правым углам, машины группы
// Поперечная улица — не маршрут: асфальт светлее, без разметки, у обоих въездов «кирпич» (drawCrossingTop)
export function drawCrossingRoad(ctx: CanvasRenderingContext2D, c: Crossing): void {
  if (!visible(c.x, c.y, CROSS.reach + 20)) return;
  ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.hCross); // ось y — вдоль поперечной улицы
  if (T.sidewalk && city) { ctx.fillStyle = T.outline!; ctx.fillRect(-c.w / 2 - SIDEWALK - 3, -CROSS.reach, c.w + 2 * SIDEWALK + 6, CROSS.reach * 2); ctx.fillStyle = (T.slabs && slabs(ctx)) || T.sidewalk; ctx.fillRect(-c.w / 2 - SIDEWALK, -CROSS.reach, c.w + 2 * SIDEWALK, CROSS.reach * 2); }
  ctx.fillStyle = T.outline ?? T.shoulder; ctx.fillRect(-c.w / 2 - 4, -CROSS.reach, c.w + 8, CROSS.reach * 2);
  ctx.fillStyle = (T.slabs && asphalt(ctx)) || T.cross; ctx.fillRect(-c.w / 2, -CROSS.reach, c.w, CROSS.reach * 2);
  if (T.dash) { // pixel: осевой пунктир поперечной улицы, как в референсе; «кирпичи» по-прежнему говорят, что туда нельзя
    ctx.fillStyle = T.lane;
    for (let y = -CROSS.reach + 10; y < CROSS.reach; y += T.dash[0] + T.dash[1]) { if (Math.abs(y + T.dash[0] / 2) > c.roadHalf + 40) ctx.fillRect(-1.5, y, 3, T.dash[0]); }
  }
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
  dashed(ctx, path, 0, 30, 24, 'rgba(90,200,255,.3)', 6);
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
  if (T.slabs && city) {
    // pixel: углы кварталов скруглены — асфальт заходит в угол, а тротуар возвращается четвертью круга с бордюром
    const R = SIDEWALK, rw = roadWidth / 2, cw = c.w / 2;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const cx = sx * (rw + R + 3), cy = sy * (cw + R + 3);
      const a0 = sx > 0 ? (sy > 0 ? Math.PI : Math.PI / 2) : (sy > 0 ? Math.PI * 1.5 : 0), a1 = a0 + Math.PI / 2; // четверть, обращённая к перекрёстку
      ctx.fillStyle = asphalt(ctx) ?? T.asphalt; ctx.fillRect(Math.min(sx * rw, cx), Math.min(sy * cw, cy), R + 3, R + 3);
      ctx.fillStyle = slabs(ctx) ?? T.sidewalk!; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a0, a1); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = T.outline!; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, R + 1.5, a0, a1); ctx.stroke();
    }
    ctx.fillStyle = T.zebra!;
    // широкие полосы через маршрут и через поперечную улицу, как в референсе
    for (const side of [-1, 1]) { const y0 = side * (cw + 4) - (side > 0 ? 0 : 30); for (let x = -rw + 4; x < rw - 4; x += 14) ctx.fillRect(x, y0, 8, 30); }
    for (const side of [-1, 1]) { const x0 = side * (rw + 4) - (side > 0 ? 0 : 30); for (let y = -cw + 4; y < cw - 4; y += 14) ctx.fillRect(x0, y, 30, 8); }
  } else {
    ctx.fillStyle = 'rgba(236,233,224,.55)';
    for (const side of [-1, 1]) { const y0 = side * (c.w / 2 + 6) - (side > 0 ? 0 : 20); for (let x = -roadWidth / 2 + 6; x < roadWidth / 2 - 6; x += 12) ctx.fillRect(x, y0, 6, 20); }
  }
  ctx.restore();
  // светофоры на правом углу перед перекрёстком и на левом за ним — оба видны игроку по ходу
  for (const side of [-1, 1] as const) drawNoEntry(ctx, c.x + c.nx * side * (roadWidth / 2 + 30), c.y + c.ny * side * (roadWidth / 2 + 30));
  for (const [side, ahead] of [[1, -1], [-1, 1]] as const) {
    const px = c.x + c.nx * side * (roadWidth / 2 + 14) + c.tx * ahead * (c.w / 2 + 14);
    const py = c.y + c.ny * side * (roadWidth / 2 + 14) + c.ty * ahead * (c.w / 2 + 14);
    const cols = [['#5a1c1c', '#ff4a4a'], ['#5a4a10', '#ffcf3d'], ['#1c4a2a', '#4ade80']];
    if (T.slabs) { // pixel: компактная коробка на тротуаре, как в референсе
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(px - 3, py - 7, 10, 18);
      ctx.fillStyle = '#23262c'; ctx.fillRect(px - 5, py - 9, 10, 18);
      ['red', 'yellow', 'green'].forEach((l, i) => { ctx.fillStyle = cols[i][light === l ? 1 : 0]; ctx.fillRect(px - 2, py - 7 + i * 5.5, 4, 4); });
      continue;
    }
    ctx.fillStyle = '#1e2026'; ctx.beginPath(); ctx.roundRect(px - 7, py - 16, 14, 32, 4); ctx.fill();
    ['red', 'yellow', 'green'].forEach((l, i) => { ctx.fillStyle = cols[i][light === l ? 1 : 0]; ctx.beginPath(); ctx.arc(px, py - 10 + i * 10, 3.5, 0, 7); ctx.fill(); });
  }
  crossCars(c, time).forEach((cc, i) => drawCar(ctx, cc.x, cc.y, cc.h, cc.W, cc.L, '#8a94a6', false, (c.s * 0.013 + i * 0.37) % 1));
}

// Полицейская машина с мигалкой; t — время для чередования цветов
export function drawPolice(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, t: number, sport = false): void {
  const red = Math.floor(t / 0.12) % 2 === 0;
  ctx.save(); ctx.translate(x, y); ctx.rotate(h);
  ctx.fillStyle = red ? 'rgba(235,60,60,.22)' : 'rgba(70,110,235,.22)'; ctx.beginPath(); ctx.arc(0, 0, 46, 0, 7); ctx.fill();
  ctx.restore();
  if (T.sprites === 'pixel') { // преследователь — спортивная полиция, посты — обычная; мигалка в спрайте
    ctx.save(); ctx.translate(x, y); ctx.rotate(h);
    if (carSprite(ctx, sport ? 'px_police_sport' : 'px_police_regular', TRAFFIC_SIZE.W, TRAFFIC_SIZE.L)) { ctx.restore(); return; }
    ctx.restore();
  }
  drawCar(ctx, x, y, h, TRAFFIC_SIZE.W, TRAFFIC_SIZE.L, '#e6e8ee', false);
  ctx.save(); ctx.translate(x, y); ctx.rotate(h);
  ctx.fillStyle = red ? '#ff4a4a' : '#3b6cff'; ctx.fillRect(-9, -5, 7, 5);
  ctx.fillStyle = red ? '#3b6cff' : '#ff4a4a'; ctx.fillRect(2, -5, 7, 5);
  ctx.restore();
}

// Сетка земли — ориентир для движения. Границы — видимый прямоугольник в мировых координатах.
export function drawGrid(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, g = 120, lw = 1): void {
  const gx = Math.floor(x0 / g) * g, gy = Math.floor(y0 / g) * g;
  ctx.strokeStyle = T.grid; ctx.lineWidth = lw; ctx.beginPath();
  for (let x = gx; x < x1; x += g) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
  for (let y = gy; y < y1; y += g) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
  ctx.stroke();
}

// Дорога с обочиной, полосами, краями и финишем — в мировых координатах
// Полотно переменной ширины: контур по левому краю вперёд и по правому назад, торцы — полукруги
function ribbon(ctx: CanvasRenderingContext2D, path: Path, half: (s: number) => number, color: string | CanvasPattern, roundEnds: boolean): void {
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
  // слои полотна снизу вверх: тротуар с контуром (в городе), контур/обочина, асфальт
  const layers: [number, string][] = [];
  if (T.sidewalk && city) layers.push([SIDEWALK + 3, T.outline!], [SIDEWALK, T.sidewalk]);
  layers.push([T.outline ? 5 : 4, T.outline ?? T.shoulder], [0, T.asphalt]);
  for (const [extra, color] of layers) {
    const fill = extra === 0 && T.sprites === 'hf' ? (tile(ctx, 'asphalt', 384) ?? color) : extra === SIDEWALK && T.sprites === 'hf' ? (tile(ctx, 'pavement', 256) ?? color) : extra === SIDEWALK && T.slabs ? (slabs(ctx) ?? color) : extra === 0 && T.slabs ? (asphalt(ctx) ?? color) : color;
    if (typeof w === 'number') poly(ctx, path, 0, fill, w + 2 * extra, cap); // постоянная ширина — штрихом, как в прототипе
    else ribbon(ctx, path, s => w(s) / 2 + extra, fill, finish);
  }
  const wa = (s: number) => widthAt(w, s);
  const [on, gap] = T.dash ?? [26, 22];
  for (let k = 1; k < LANES; k++) {
    // граница встречки — сплошная двойная жёлтая; остальные — пунктир
    if (k === oncoming) { poly(ctx, path, s => -wa(s) / 2 + k * (wa(s) / LANES) - 2.5, T.dyellow, 2); poly(ctx, path, s => -wa(s) / 2 + k * (wa(s) / LANES) + 2.5, T.dyellow, 2); }
    else dashed(ctx, path, s => -wa(s) / 2 + k * (wa(s) / LANES), on, gap, T.lane, T.dash ? 3 : 2);
  }
  if (T.edge) { poly(ctx, path, s => -wa(s) / 2 + 3, T.edge, 2); poly(ctx, path, s => wa(s) / 2 - 3, T.edge, 2); }
  if (T.lights && city) drawLights(ctx, path, wa);
  if (!finish) return;
  drawStart(ctx, path, wa(0));
  const e = pathAt(path, path.L - 60), we = wa(path.L - 60);
  ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(heading(e.tx, e.ty));
  drawGarage(ctx, we);
  for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#ece9e0' : '#15171c'; ctx.fillRect(-we / 2 + i * we / 8, -6, we / 8, 12); }
  ctx.restore();
}

// Детерминированное зерно: мелкие точки чуть светлее и чуть темнее фона — пиксельная фактура из референса
function grain(g: CanvasRenderingContext2D, n: number, seed: number, count: number, light: string, dark: string): void {
  let x = seed | 0;
  const rnd = () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; };
  for (let i = 0; i < count; i++) { g.fillStyle = rnd() < 0.5 ? light : dark; g.fillRect(Math.floor(rnd() * n), Math.floor(rnd() * n), 2, 2); }
}
// Плитка тротуара (pixel): плиты 36 px со швами и зерном
function slabs(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  return procTile(ctx, 'slabs', 72, (g, n) => {
    g.fillStyle = T.sidewalk!; g.fillRect(0, 0, n, n);
    grain(g, n, 7, 90, 'rgba(255,255,255,.06)', 'rgba(0,0,0,.07)');
    g.fillStyle = T.slabs!; g.fillRect(0, 0, n, 1); g.fillRect(0, 0, 1, n); g.fillRect(n / 2, 0, 1, n); g.fillRect(0, n / 2, n, 1);
  });
}
// Асфальт (pixel): ровный тон с редким зерном
function asphalt(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  return procTile(ctx, 'asphalt', 64, (g, n) => { g.fillStyle = T.asphalt; g.fillRect(0, 0, n, n); grain(g, n, 13, 70, 'rgba(255,255,255,.05)', 'rgba(0,0,0,.12)'); });
}
// Фонари по краю тротуара с обеих сторон: тёмный столбик каждые 320 px по s, в видимой области
function drawLights(ctx: CanvasRenderingContext2D, path: Path, wa: (s: number) => number): void {
  for (let s = 120; s < path.L - 100; s += 200) {
    const p = pathAt(path, s);
    if (!visible(p.x, p.y, 200)) continue;
    for (const side of [-1, 1]) {
      const off = side * (wa(s) / 2 + SIDEWALK - 9);
      ctx.save(); ctx.translate(p.x + p.nx * off, p.y + p.ny * off); ctx.rotate(heading(p.tx, p.ty));
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(-3, -6, 10, 14);
      ctx.fillStyle = T.lights!; ctx.fillRect(-5, -8, 10, 14);
      ctx.fillStyle = T.windows ? '#f0d890' : '#dcd6b8'; ctx.fillRect(-3, -6, 6, 4);
      ctx.restore();
    }
  }
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
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.fillStyle = T.ground; ctx.fillRect(0, 0, W, H);
  setCity(!!sc.props?.length);
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(z, z);
  if (sc.shake) ctx.translate((Math.random() - 0.5) * 2 * sc.shake, (Math.random() - 0.5) * 2 * sc.shake); // тряска — только картинка
  ctx.translate(-cam.x, -cam.y);
  if (T.sprites === 'hf') { // земля текстурой в мировых координатах: в городе бетон, за городом пустырь
    const g = tile(ctx, sc.props?.length ? 'pavement' : 'grass', 512);
    if (g) { ctx.fillStyle = g; ctx.fillRect(cam.x - W / 2 / z, cam.y - H / 2 / z, W / z, H / z); }
  }
  if (T.slabs && sc.props?.length) { // pixel: в городе вся земля между домами — плитка тротуара
    const g = slabs(ctx);
    if (g) { ctx.fillStyle = g; ctx.fillRect(cam.x - W / 2 / z, cam.y - H / 2 / z, W / z, H / z); }
  }
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
    else drawCar(ctx, v.x, v.y, v.h, c.W, c.L, c.crashed ? '#4a4d55' : c.col, false, c.pick, c.model);
    if (c.panic && !c.crashed) { // «!» над испуганным водителем
      ctx.fillStyle = '#f4b942'; ctx.beginPath(); ctx.arc(v.x, v.y - 34, 11, 0, 7); ctx.fill();
      ctx.fillStyle = '#1a1408'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', v.x, v.y - 33);
    }
  }
  if (sc.chaser) drawPolice(ctx, sc.chaser.x, sc.chaser.y, sc.chaser.h, sc.t ?? 0, true);
  if (sc.air !== undefined) {
    // в полёте: тень на земле, машина крупнее по дуге
    const k = Math.sin(Math.PI * sc.air), sc2 = 1 + 0.45 * k;
    ctx.fillStyle = `rgba(0,0,0,${0.35 - 0.2 * k})`; ctx.beginPath(); ctx.ellipse(car.x, car.y, car.W * 0.7, car.L * 0.55, car.h, 0, 7); ctx.fill();
    ctx.save(); ctx.translate(car.x, car.y - 30 * k); ctx.scale(sc2, sc2); ctx.translate(-car.x, -car.y);
    drawPlayer(ctx, car.x, car.y, car.h, sc.spec);
    ctx.restore();
  } else drawPlayer(ctx, car.x, car.y, car.h, sc.spec, sc.wrecked);
  if (sc.blasts?.length) drawBlasts(ctx, sc.blasts);
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
