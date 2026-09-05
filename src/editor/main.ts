import '../style.css';
import './editor.css';
import { P, type Param } from '../config';
import { LEVELS, type LevelData } from '../levels';
import { createGame, type Game } from '../game';
import { buildPath } from '../road';
import { initCanvas, type Sel } from './canvas';
import { fileName, formatLevel, parseLevel } from './io';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const inp = (id: string) => $<HTMLInputElement>(id);

// Стартовые значения — из config, чтобы новый уровень совпадал с тем, что крутится в панели тюнинга
const level: LevelData = { name: 'Новый уровень', points: [], width: P.width.v, traffic: P.traffic.v, speed: P.speed.v, seed: 1 };
let sel: Sel = null;

// ---------- холст ----------
const canvas = initCanvas($<HTMLCanvasElement>('ec'), {
  level: () => level,
  selected: () => sel,
  select: s => { sel = s; syncSel(); },
  carMode: () => inp('carMode').checked,
  addPoint: p => { level.points.push(p); select({ kind: 'point', i: level.points.length - 1 }); changed(); },
  movePoint: (i, p) => { level.points[i] = p; changed(); },
  removePoint: i => { level.points.splice(i, 1); select(null); changed(); },
  addCar: c => { (level.cars ??= []).push(c); select({ kind: 'car', i: level.cars.length - 1 }); changed(); },
  moveCar: (i, c) => { level.cars![i] = c; changed(); },
  removeCar: i => { level.cars!.splice(i, 1); select(null); changed(); },
});

function select(s: Sel): void { sel = s; syncSel(); }

function changed(): void {
  const n = level.points.length, cars = level.cars?.length ?? 0;
  $('stats').textContent = (n < 2 ? `${n} ${n === 1 ? 'точка' : 'точек'} — нужно минимум 2` : `${n} точек · длина ${Math.round(buildPath(level.points).L)} px`)
    + (cars ? ` · машин: ${cars}` : '');
  syncSel();
}

// Блок выбранной машины: положение и скорость
function syncSel(): void {
  const box = $('carBox');
  if (sel?.kind !== 'car' || !level.cars?.[sel.i]) { box.hidden = true; return; }
  const c = level.cars[sel.i];
  box.hidden = false;
  $('carInfo').textContent = `Машина ${sel.i} · s ${c.s} · полоса ${c.lane}`;
  if (document.activeElement !== inp('carSpeed')) inp('carSpeed').value = String(c.speed);
}
inp('carSpeed').oninput = () => {
  if (sel?.kind !== 'car' || !level.cars) return;
  level.cars[sel.i].speed = Math.max(0, parseFloat(inp('carSpeed').value) || 0);
  canvas.draw();
};
$('carDelete').onclick = () => { if (sel?.kind === 'car' && level.cars) { level.cars.splice(sel.i, 1); select(null); changed(); canvas.draw(); } };

// ---------- панель ----------
const status = (s: string) => { $('status').textContent = s; };
const setRange = (el: HTMLInputElement, p: Param) => { el.min = String(p.min); el.max = String(p.max); el.step = String(p.step); };
setRange(inp('width'), P.width); setRange(inp('traffic'), P.traffic); setRange(inp('speed'), P.speed);

for (const k of ['width', 'traffic', 'speed'] as const) {
  inp(k).oninput = () => { level[k] = parseFloat(inp(k).value); $(k + 'V').textContent = String(level[k]); canvas.draw(); };
}
inp('name').oninput = () => { level.name = inp('name').value; };
inp('seed').onchange = () => { level.seed = Math.round(parseFloat(inp('seed').value)) || 0; inp('seed').value = String(level.seed); canvas.draw(); };

// Преследователь: включён — блок с дистанцией и скоростью
inp('chaser').onchange = () => {
  if (inp('chaser').checked) level.chaser = { gap: 200, speed: 1 }; else delete level.chaser;
  syncChaser(); canvas.draw();
};
inp('chaserGap').onchange = () => { if (level.chaser) { level.chaser.gap = Math.max(60, Math.round(parseFloat(inp('chaserGap').value) || 200)); inp('chaserGap').value = String(level.chaser.gap); canvas.draw(); } };
inp('chaserSpeed').onchange = () => { if (level.chaser) { level.chaser.speed = Math.max(0.5, parseFloat(inp('chaserSpeed').value) || 1); inp('chaserSpeed').value = String(level.chaser.speed); } };
function syncChaser(): void {
  inp('chaser').checked = !!level.chaser;
  $('chaserBox').hidden = !level.chaser;
  if (level.chaser) { inp('chaserGap').value = String(level.chaser.gap); inp('chaserSpeed').value = String(level.chaser.speed); }
}

function syncPanel(): void {
  syncChaser();
  inp('name').value = level.name;
  for (const k of ['width', 'traffic', 'speed'] as const) { inp(k).value = String(level[k]); $(k + 'V').textContent = String(level[k]); }
  inp('seed').value = String(level.seed);
  changed();
}

function load(l: LevelData): void {
  delete level.cars; delete level.chaser;
  Object.assign(level, structuredClone(l));
  select(null);
  syncPanel();
  canvas.fit();
}

const open = $<HTMLSelectElement>('open');
open.innerHTML = '<option value="">— новый —</option>' + Object.entries(LEVELS).map(([k, l]) => `<option value="${k}">${k} — ${l.name}</option>`).join('');
open.onchange = () => {
  if (open.value) load(LEVELS[open.value]);
  else load({ name: 'Новый уровень', points: [], width: level.width, traffic: level.traffic, speed: level.speed, seed: level.seed });
  status('');
};

$('toggle').onclick = () => { $('epanel').classList.toggle('collapsed'); };

// ---------- экспорт / импорт ----------
$('export').onclick = async () => {
  const json = formatLevel(level);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = fileName(level.name);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  try { await navigator.clipboard.writeText(json); status(`Скачан ${a.download}, JSON скопирован в буфер`); }
  catch { status(`Скачан ${a.download}; буфер обмена недоступен`); }
};

const file = inp('file');
$('import').onclick = () => file.click();
file.onchange = async () => {
  const f = file.files?.[0]; file.value = '';
  if (!f) return;
  try { const l = parseLevel(JSON.parse(await f.text())); load(l); open.value = ''; status(`Импортирован «${l.name}»`); }
  catch (err) { status('Ошибка импорта: ' + (err as Error).message); }
};

// ---------- играть ----------
let game: Game | null = null;
const editorEl = $('editor'), playEl = $('play-view');
$('play').onclick = () => {
  if (level.points.length < 2) { status('Нужно минимум 2 точки'); return; }
  editorEl.hidden = true; playEl.hidden = false;
  game = createGame({
    canvas: $<HTMLCanvasElement>('c'),
    hud: $('hud'), overlay: $('overlay'), ovTitle: $('ovTitle'), ovSub: $('ovSub'),
    left: $('left'), right: $('right'),
  }, structuredClone(level));
};
$('back').onclick = () => {
  game?.stop(); game = null;
  playEl.hidden = true; editorEl.hidden = false;
  canvas.draw();
};

// ---------- клавиатура ----------
addEventListener('keydown', e => {
  const tag = (e.target as HTMLElement).tagName;
  if (game || tag === 'INPUT' || tag === 'SELECT') return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
    if (sel.kind === 'point') level.points.splice(sel.i, 1);
    else level.cars?.splice(sel.i, 1);
    select(null); changed(); canvas.draw();
  }
  if (e.key === 'Escape') { select(null); canvas.draw(); }
});

syncPanel();
canvas.fit();
