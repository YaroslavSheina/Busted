import '../style.css';
import './editor.css';
import { P, type Param } from '../config';
import { LEVEL_KEYS, LEVELS, type LevelData } from '../levels';
import { CARS, DEFAULT_CAR, type CarKey } from '../cars';
import type { Block } from '../blocks';
import { pathAt } from '../road';
import { createGame, type Game } from '../game';
import { buildPath } from '../road';
import { initCanvas, type Sel } from './canvas';
import { fileName, formatLevel, parseLevel } from './io';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const inp = (id: string) => $<HTMLInputElement>(id);

// Стартовые значения — из config, чтобы новый уровень совпадал с тем, что крутится в панели тюнинга
const level: LevelData = { name: 'Новый уровень', points: [], width: P.width.v, traffic: P.traffic.v, seed: 1, car: DEFAULT_CAR };
let sel: Sel = null;

// ---------- холст ----------
const canvas = initCanvas($<HTMLCanvasElement>('ec'), {
  level: () => level,
  selected: () => sel,
  select: s => { sel = s; syncSel(); },
  carMode: () => inp('carMode').checked,
  addPoint: p => { level.points.push(p); select({ kind: 'point', i: level.points.length - 1, b: -1 }); changed(); },
  movePoint: (b, i, p) => { (b < 0 ? level.points : level.branches![b].points)[i] = p; changed(); },
  removePoint: (b, i) => {
    if (b < 0) level.points.splice(i, 1);
    else { const br = level.branches![b]; if (br.points.length > 1) br.points.splice(i, 1); } // у ветки хотя бы одна своя точка
    select(null); changed();
  },
  addCar: c => { (level.cars ??= []).push(c); select({ kind: 'car', i: level.cars.length - 1 }); changed(); },
  moveCar: (i, c) => { level.cars![i] = { ...c, ...(level.cars![i].type ? { type: level.cars![i].type } : {}) }; changed(); },
  removeCar: i => { level.cars!.splice(i, 1); select(null); changed(); },
});

function select(s: Sel): void { sel = s; syncSel(); }

function changed(): void {
  const n = level.points.length, cars = level.cars?.length ?? 0;
  $('stats').textContent = (n < 2 ? `${n} ${n === 1 ? 'точка' : 'точек'} — нужно минимум 2` : `${n} точек · длина ${Math.round(buildPath(level.points).L)} px`)
    + (cars ? ` · машин: ${cars}` : '')
    + (level.branches?.length ? ` · веток: ${level.branches.length}` : '');
  syncSel();
  syncBlocks();
  syncBranches();
  syncNarrows();
  syncRails();
}

// Блок выбранной машины: положение и скорость
function syncSel(): void {
  const box = $('carBox');
  if (sel?.kind !== 'car' || !level.cars?.[sel.i]) { box.hidden = true; return; }
  const c = level.cars[sel.i];
  box.hidden = false;
  $('carInfo').textContent = `${c.type === 'ramp' ? 'Рампа' : 'Машина'} ${sel.i} · s ${c.s} · полоса ${c.lane}`;
  if (document.activeElement !== inp('carSpeed')) inp('carSpeed').value = String(c.speed);
  inp('carRamp').checked = c.type === 'ramp';
}
inp('carRamp').onchange = () => {
  if (sel?.kind !== 'car' || !level.cars) return;
  if (inp('carRamp').checked) level.cars[sel.i].type = 'ramp'; else delete level.cars[sel.i].type;
  syncSel(); canvas.draw();
};
inp('carSpeed').oninput = () => {
  if (sel?.kind !== 'car' || !level.cars) return;
  level.cars[sel.i].speed = Math.max(0, parseFloat(inp('carSpeed').value) || 0);
  canvas.draw();
};
$('carDelete').onclick = () => { if (sel?.kind === 'car' && level.cars) { level.cars.splice(sel.i, 1); select(null); changed(); canvas.draw(); } };

// ---------- панель ----------
const status = (s: string) => { $('status').textContent = s; };
const setRange = (el: HTMLInputElement, p: Param) => { el.min = String(p.min); el.max = String(p.max); el.step = String(p.step); };
setRange(inp('width'), P.width); setRange(inp('traffic'), P.traffic);
const carSel = $<HTMLSelectElement>('car');
carSel.innerHTML = (Object.keys(CARS) as CarKey[]).map(k => `<option value="${k}">${CARS[k].name} · ${CARS[k].speed} px/с</option>`).join('');
carSel.onchange = () => { level.car = carSel.value; canvas.draw(); };

for (const k of ['width', 'traffic'] as const) {
  inp(k).oninput = () => { level[k] = parseFloat(inp(k).value); $(k + 'V').textContent = String(level[k]); canvas.draw(); };
}
inp('name').oninput = () => { level.name = inp('name').value; };
inp('panic').onchange = () => { const v = Math.max(0, Math.min(1, parseFloat(inp('panic').value) || 0)); if (v > 0) level.panic = v; else delete level.panic; inp('panic').value = String(v); };
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

// Заграждения: четыре типа как пресеты данных (docs/mechanics.md, M1)
const BLOCK_PRESETS: Record<string, (s: number) => Block> = {
  gap: s => ({ s, police: [0, 2] }),
  full: s => ({ s, police: [0, 1, 2], bypass: 'right' }),
  spikes: s => ({ s, police: [0], spikes: [2] }),
  works: s => ({ s, works: [1, 2], len: 500 }),
};
const blockLabel = (b: Block) => [b.police && `пост ${b.police.join('')}`, b.spikes && `ежи ${b.spikes.join('')}`, b.works && `ремонт ${b.works.join('')}×${b.len ?? ''}`, b.bypass && `обочина ${b.bypass}`].filter(Boolean).join(', ');
function syncBlocks(): void {
  const list = $('blockList'); list.innerHTML = '';
  (level.blocks ?? []).forEach((b, i) => {
    const row = document.createElement('div');
    const span = document.createElement('span'); span.textContent = `s ${b.s} · ${blockLabel(b)}`;
    const del = document.createElement('button'); del.textContent = '×';
    del.onclick = () => { level.blocks!.splice(i, 1); if (!level.blocks!.length) delete level.blocks; changed(); canvas.draw(); };
    row.appendChild(span); row.appendChild(del); list.appendChild(row);
  });
}
// Ветки (docs/mechanics.md, M5): создаётся с тремя точками справа от главной, дальше их тянут мышью
function syncBranches(): void {
  const list = $('branchList'); list.innerHTML = '';
  (level.branches ?? []).forEach((b, i) => {
    const row = document.createElement('div');
    const span = document.createElement('span'); span.textContent = `ветка ${i}: s ${b.from} → ${b.to}, точек ${b.points.length}`;
    const del = document.createElement('button'); del.textContent = '×';
    del.onclick = () => { level.branches!.splice(i, 1); if (!level.branches!.length) delete level.branches; select(null); changed(); canvas.draw(); };
    row.appendChild(span); row.appendChild(del); list.appendChild(row);
  });
}
// Сужения (docs/mechanics.md, M6)
function syncNarrows(): void {
  const list = $('narrowList'); list.innerHTML = '';
  (level.narrows ?? []).forEach((n, i) => {
    const row = document.createElement('div');
    const span = document.createElement('span'); span.textContent = `сужение ${i}: s ${n.from} → ${n.to}, ширина ${n.width}`;
    const del = document.createElement('button'); del.textContent = '×';
    del.onclick = () => { level.narrows!.splice(i, 1); if (!level.narrows!.length) delete level.narrows; changed(); canvas.draw(); };
    row.appendChild(span); row.appendChild(del); list.appendChild(row);
  });
}
// Переезды (docs/mechanics.md, M7)
function syncRails(): void {
  const list = $('railList'); list.innerHTML = '';
  (level.rails ?? []).forEach((r, i) => {
    const row = document.createElement('div');
    const span = document.createElement('span'); span.textContent = `переезд ${i}: s ${r.s}, поезд раз в ${r.period} с, ${r.speed} px/с, состав ${r.length}`;
    const del = document.createElement('button'); del.textContent = '×';
    del.onclick = () => { level.rails!.splice(i, 1); if (!level.rails!.length) delete level.rails; changed(); canvas.draw(); };
    row.appendChild(span); row.appendChild(del); list.appendChild(row);
  });
}
$('railAdd').onclick = () => {
  const s = Math.round(parseFloat(inp('railS').value)), period = parseFloat(inp('railPeriod').value) || 6, speed = Math.round(parseFloat(inp('railSpeed').value)) || 400;
  if (!Number.isFinite(s) || period < 2 || speed < 100) { status('Переезд: нужен s, период ≥ 2 с, скорость ≥ 100'); return; }
  (level.rails ??= []).push({ s, period, speed, length: 300 });
  level.rails.sort((a, b) => a.s - b.s);
  changed(); canvas.draw();
};

$('narrowAdd').onclick = () => {
  const from = Math.round(parseFloat(inp('narrowFrom').value)), to = Math.round(parseFloat(inp('narrowTo').value)), width = Math.round(parseFloat(inp('narrowW').value));
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(width) || to <= from || width < 60) { status('Сужение: нужны from < to и ширина ≥ 60'); return; }
  (level.narrows ??= []).push({ from, to, width });
  level.narrows.sort((a, b) => a.from - b.from);
  changed(); canvas.draw();
};

$('branchAdd').onclick = () => {
  const from = Math.round(parseFloat(inp('branchFrom').value)), to = Math.round(parseFloat(inp('branchTo').value));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from + 200 || level.points.length < 2) { status('Ветка: нужны from и to (to − from ≥ 200) на готовой дороге'); return; }
  const main = buildPath(level.points);
  if (to > main.L - 100) { status(`Ветка: to не больше ${Math.round(main.L - 100)}`); return; }
  const side = 250;
  const points = [0.25, 0.5, 0.75].map(t => { const p = pathAt(main, from + (to - from) * t); return [Math.round(p.x + p.nx * side), Math.round(p.y + p.ny * side)] as [number, number]; });
  (level.branches ??= []).push({ from, to, points });
  changed(); canvas.draw();
};

$('blockAdd').onclick = () => {
  const s = Math.round(parseFloat(inp('blockS').value));
  if (!Number.isFinite(s)) { status('Укажи s заграждения'); return; }
  (level.blocks ??= []).push(BLOCK_PRESETS[$<HTMLSelectElement>('blockType').value](s));
  level.blocks.sort((a, b) => a.s - b.s);
  changed(); canvas.draw();
};

function syncPanel(): void {
  syncChaser();
  inp('name').value = level.name;
  for (const k of ['width', 'traffic'] as const) { inp(k).value = String(level[k]); $(k + 'V').textContent = String(level[k]); }
  carSel.value = level.car ?? DEFAULT_CAR;
  inp('seed').value = String(level.seed);
  inp('panic').value = String(level.panic ?? 0);
  changed();
}

function load(l: LevelData): void {
  delete level.cars; delete level.chaser; delete level.blocks; delete level.branches; delete level.panic; delete level.narrows; delete level.rails;
  Object.assign(level, structuredClone(l));
  level.car ??= DEFAULT_CAR;
  select(null);
  syncPanel();
  canvas.fit();
}

const open = $<HTMLSelectElement>('open');
open.innerHTML = '<option value="">— новый —</option>' + LEVEL_KEYS.map(k => `<option value="${k}">${k} — ${LEVELS[k].name}</option>`).join('');
open.onchange = () => {
  if (open.value) load(LEVELS[open.value]);
  else load({ name: 'Новый уровень', points: [], width: level.width, traffic: level.traffic, seed: level.seed, car: level.car });
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
    if (sel.kind === 'point') { if (sel.b < 0) level.points.splice(sel.i, 1); else if (level.branches![sel.b].points.length > 1) level.branches![sel.b].points.splice(sel.i, 1); }
    else level.cars?.splice(sel.i, 1);
    select(null); changed(); canvas.draw();
  }
  if (e.key === 'Escape') { select(null); canvas.draw(); }
});

syncPanel();
canvas.fit();
