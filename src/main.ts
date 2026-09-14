import './style.css';
import { createGame } from './game';
import { lockTheme, setTheme } from './render';
import { loadArt } from './art';
import { setAudioEnabled, unlockAudio } from './audio';
const query = new URLSearchParams(location.search);
if (query.get('theme')) { setTheme(query.get('theme')); lockTheme(); } // ?theme=night|comic|dark|bright|sprites|pixel|pixeldusk — сильнее темы уровня
loadArt();
if (query.get('mute')) setAudioEnabled(false); // ?mute=1 — без звука (настройки — позже)
import { LEVEL_KEYS, levelByName } from './levels';
import { buildPanel, initToggle } from './debug';
import { CARS, type CarKey, type CarSpec } from './cars';
import { addFame, campaign, fame, recordLevel } from './campaign';
import { renderMap } from './map';
import { icon } from './icons';

const $ = (id: string) => document.getElementById(id)!;
const panel = $('panel'), carPanel = $('carPanel');
if (query.get('debug')) document.body.classList.add('debug'); // ?debug=1 — отладочный HUD с ω и меню «авто»/«уровень»
// ?level=gfx — открыть сразу нужный уровень (ключ = имя файла в levels/); без параметра — текущий уровень кампании
const FIRST = LEVEL_KEYS.includes(query.get('level') ?? '') ? query.get('level')! : campaign.current();
let levelKey = FIRST;
let carOverride: CarKey | null = null; // выбор в меню «авто» действует поверх машины уровня

const game = createGame({
  canvas: $('c') as HTMLCanvasElement,
  hud: $('hud'), overlay: $('overlay'), ovTitle: $('ovTitle'), ovSub: $('ovSub'), ovHint: $('ovHint'), ovName: $('ovName'),
  gscore: $('gscore'), barFill: $('barFill'), barCar: $('barCar'), cop: $('cop'), copFill: $('copFill'), gflash: $('gflash'),
  left: $('left'), right: $('right'),
}, levelByName(FIRST));
// Очки пройденного уровня — в славу (только уровни кампании)
game.onScore((points, meta) => { if (campaign.has(levelKey)) recordLevel(levelKey, points, meta.clean, meta.target); return addFame(campaign.has(levelKey) ? points : 0); });
// Пройденный уровень кампании (в том числе открытый из меню) ведёт к следующему по списку; последний — на карту
game.onEnd(how => {
  const next = campaign.advance(levelKey);
  if (!next) { if (levelKey === 'final' && how === 'done') { showEnding(); return true; } if (campaign.has(levelKey)) { openMap(); return true; } return false; }
  selectLevel(next);
  return true;
});

function currentLevel() {
  const l = levelByName(levelKey);
  return carOverride ? { ...l, car: carOverride } : l;
}
function selectLevel(key: string): void {
  levelKey = key;
  game.load(currentLevel());
  showPanel(key);
}
function selectCar(key: CarKey | null): void {
  carOverride = key;
  game.load(currentLevel());
  showPanel(levelKey);
  showCarPanel();
}
function showCarPanel(): void {
  carPanel.innerHTML = '';
  const list = document.createElement('div'); list.className = 'levels';
  const add = (label: string, key: CarKey | null) => {
    const b = document.createElement('button'); b.textContent = label;
    if (key === carOverride) b.classList.add('on');
    b.onclick = () => selectCar(key);
    list.appendChild(b);
  };
  add('По уровню', null);
  for (const k of Object.keys(CARS) as CarKey[]) if (!(CARS[k] as CarSpec).hidden) add(`${CARS[k].name} · ${CARS[k].speed}`, k);
  carPanel.appendChild(list);
  const hint = document.createElement('div'); hint.className = 'hint';
  hint.textContent = 'Машина применяется к любому уровню поверх той, что задана в файле. Числа в панели тюнинга обновляются под неё.';
  carPanel.appendChild(hint);
}
function showPanel(key: string): void {
  buildPanel(panel, key, {
    onLevel: selectLevel,
    onParam: k => { if (k === 'width' || k === 'traffic') game.reset(); },
  });
}

// Титры после финала: история пролога закрыта — тот же гараж, в этот раз доехал
const ending = $('ending');
ending.style.backgroundImage = `url(${import.meta.env.BASE_URL}art/hero.jpg)`;
function showEnding(): void {
  $('endText').textContent = `Тот самый гараж. В этот раз — доехал.\nСпорткар твой, город твой, полиция знает номер.\n\nСлава ${fame().toLocaleString('ru-RU')}\n\nBUSTED — конец первой главы`;
  ending.classList.remove('hide'); syncPause();
}
ending.addEventListener('pointerdown', e => { e.preventDefault(); ending.classList.add('hide'); openMap(); });
// Карта карьеры: районы и уровни, прогресс; открывается после загрузочного экрана (без ?level=) и по кнопке ☰; мир стоит
const mapEl = $('map');
function openMap(): void { renderMap({ root: mapEl, onPlay: k => { closeMap(); if (k !== levelKey) selectLevel(k); else game.reset(); }, onClose: closeMap }); mapEl.classList.remove('hide'); syncPause(); }
function closeMap(): void { mapEl.classList.add('hide'); syncPause(); }
$('mapBtn').innerHTML = icon('map', 18);
$('mapBtn').onclick = () => { if (mapEl.classList.contains('hide')) openMap(); else closeMap(); };
// Загрузочный экран с ключевым артом: мир стоит (отсчёт не идёт), тап убирает экран
const splash = $('splash');
splash.style.backgroundImage = `url(${import.meta.env.BASE_URL}art/hero.jpg)`;
splash.addEventListener('pointerdown', e => { e.preventDefault(); unlockAudio(); splash.classList.add('hide'); if (!query.get('level')) openMap(); else syncPause(); }); // первый жест — можно включать звук
// Пока открыто меню, карта или загрузочный экран, мир стоит; тап по игровому полю закрывает меню и продолжает попытку
const menus = [panel, carPanel];
const syncPause = () => game.pause(!splash.classList.contains('hide') || !mapEl.classList.contains('hide') || !ending.classList.contains('hide') || menus.some(m => m.classList.contains('open')));
syncPause();
initToggle($('levelBtn'), panel, [carPanel], syncPause);
initToggle($('carBtn'), carPanel, [panel], syncPause);
document.addEventListener('pointerdown', e => {
  if (!menus.some(m => m.classList.contains('open'))) return;
  if ((e.target as HTMLElement).closest('.panel, #top')) return;
  for (const m of menus) m.classList.remove('open');
  syncPause();
}, true);
showPanel(FIRST);
showCarPanel();
