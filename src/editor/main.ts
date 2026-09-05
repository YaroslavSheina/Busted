import '../style.css';
import './editor.css';
import { P, type Param } from '../config';
import { LEVELS, type LevelData } from '../levels';
import { createGame, type Game } from '../game';
import { buildPath } from '../road';
import { initCanvas } from './canvas';
import { fileName, formatLevel, parseLevel } from './io';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const inp = (id: string) => $<HTMLInputElement>(id);

// Стартовые значения — из config, чтобы новый уровень совпадал с тем, что крутится в панели тюнинга
const level: LevelData = { name: 'Новый уровень', points: [], width: P.width.v, traffic: P.traffic.v, speed: P.speed.v, seed: 1 };
let selected = -1;

// ---------- холст ----------
const canvas = initCanvas($<HTMLCanvasElement>('ec'), {
  points: () => level.points,
  width: () => level.width,
  selected: () => selected,
  add: p => { level.points.push(p); selected = level.points.length - 1; changed(); },
  move: (i, p) => { level.points[i] = p; changed(); },
  remove: i => { level.points.splice(i, 1); selected = -1; changed(); },
  select: i => { selected = i; },
});

function changed(): void {
  const n = level.points.length;
  $('stats').textContent = n < 2 ? `${n} ${n === 1 ? 'точка' : 'точек'} — нужно минимум 2` : `${n} точек · длина ${Math.round(buildPath(level.points).L)} px`;
}

// ---------- панель ----------
const status = (s: string) => { $('status').textContent = s; };
const setRange = (el: HTMLInputElement, p: Param) => { el.min = String(p.min); el.max = String(p.max); el.step = String(p.step); };
setRange(inp('width'), P.width); setRange(inp('traffic'), P.traffic); setRange(inp('speed'), P.speed);

for (const k of ['width', 'traffic', 'speed'] as const) {
  inp(k).oninput = () => { level[k] = parseFloat(inp(k).value); $(k + 'V').textContent = String(level[k]); canvas.draw(); };
}
inp('name').oninput = () => { level.name = inp('name').value; };
inp('seed').onchange = () => { level.seed = Math.round(parseFloat(inp('seed').value)) || 0; inp('seed').value = String(level.seed); };

function syncPanel(): void {
  inp('name').value = level.name;
  for (const k of ['width', 'traffic', 'speed'] as const) { inp(k).value = String(level[k]); $(k + 'V').textContent = String(level[k]); }
  inp('seed').value = String(level.seed);
  changed();
}

function load(l: LevelData): void {
  Object.assign(level, structuredClone(l));
  selected = -1;
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
  if (game || (e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected >= 0) { level.points.splice(selected, 1); selected = -1; changed(); canvas.draw(); }
  if (e.key === 'Escape') { selected = -1; canvas.draw(); }
});

syncPanel();
canvas.fit();
