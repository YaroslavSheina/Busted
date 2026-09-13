import './style.css';
import { createGame } from './game';
import { setTheme } from './render';
import { loadArt } from './art';
const query = new URLSearchParams(location.search);
setTheme(query.get('theme')); // ?theme=night|comic|dark|bright|sprites|pixel — эксперименты; без параметра pixelnight
loadArt();
import { LEVEL_KEYS, levelByName } from './levels';
import { buildPanel, initToggle } from './debug';
import { CARS, type CarKey, type CarSpec } from './cars';
import { addFame, campaign } from './campaign';

const $ = (id: string) => document.getElementById(id)!;
const panel = $('panel'), carPanel = $('carPanel');
// ?level=gfx — открыть сразу нужный уровень (ключ = имя файла в levels/); без параметра — текущий уровень кампании
const FIRST = LEVEL_KEYS.includes(query.get('level') ?? '') ? query.get('level')! : campaign.current();
let levelKey = FIRST;
let carOverride: CarKey | null = null; // выбор в меню «авто» действует поверх машины уровня

const game = createGame({
  canvas: $('c') as HTMLCanvasElement,
  hud: $('hud'), overlay: $('overlay'), ovTitle: $('ovTitle'), ovSub: $('ovSub'), ovHint: $('ovHint'), ovName: $('ovName'),
  left: $('left'), right: $('right'),
}, levelByName(FIRST));
// Очки пройденного уровня — в славу (только уровни кампании)
game.onScore(points => addFame(campaign.has(levelKey) ? points : 0));
// Пройденный уровень кампании (в том числе открытый из меню) ведёт к следующему по списку; уровень не из кампании — повтор
game.onEnd(() => {
  const next = campaign.advance(levelKey);
  if (!next) return false;
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

// Загрузочный экран с ключевым артом: мир стоит (отсчёт не идёт), тап убирает экран
const splash = $('splash');
splash.style.backgroundImage = `url(${import.meta.env.BASE_URL}art/hero.jpg)`;
splash.addEventListener('pointerdown', e => { e.preventDefault(); splash.classList.add('hide'); syncPause(); });
// Пока открыто меню или загрузочный экран, мир стоит; тап по игровому полю закрывает меню и продолжает попытку
const menus = [panel, carPanel];
const syncPause = () => game.pause(!splash.classList.contains('hide') || menus.some(m => m.classList.contains('open')));
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
