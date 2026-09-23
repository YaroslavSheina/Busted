import './style.css';
import { createGame } from './game';
import { lockTheme, setTheme } from './render';
import { loadArt } from './art';
import { quietAudio, setAudioEnabled, unlockAudio } from './audio';
const query = new URLSearchParams(location.search);
if (query.get('theme')) { setTheme(query.get('theme')); lockTheme(); } // ?theme=night|comic|dark|bright|sprites|pixel|pixeldusk — сильнее темы уровня
loadArt();
if (query.get('mute')) setAudioEnabled(false); // ?mute=1 — без звука (настройки — позже)
import { LEVEL_KEYS, levelByName } from './levels';
import { buildPanel, initToggle } from './debug';
import { CARS, type CarKey, type CarSpec } from './cars';
import { CAMPAIGN, DISTRICTS, addFame, campaign, fame, progressOf, recordLevel, resetAll } from './campaign';
import { renderMap } from './map';
import { icon } from './icons';
import { chosenCar, districtToIntroduce, renderGarage, renderSettings, showDistrict, showNote, showPause, type ShellUi } from './shell';
import { setTester } from './tester';
import { attemptNo, device, logAttempt, logNote, logOpen, shareText } from './log';
if (query.get('tester') !== null) setTester(query.get('tester') === '1'); // ?tester=1 — все уровни открыты (tester.ts)

const $ = (id: string) => document.getElementById(id)!;
const panel = $('panel'), carPanel = $('carPanel');
if (query.get('debug')) document.body.classList.add('debug'); // ?debug=1 — отладочный HUD с ω и меню «авто»/«уровень»
// ?level=tut04 — открыть сразу нужный уровень (ключ = имя файла в levels/); без параметра — текущий уровень кампании
const FIRST = LEVEL_KEYS.includes(query.get('level') ?? '') ? query.get('level')! : campaign.current();
let levelKey = FIRST;
let carOverride: CarKey | null = null; // выбор в меню «авто» действует поверх машины уровня

const game = createGame({
  canvas: $('c') as HTMLCanvasElement,
  hud: $('hud'), overlay: $('overlay'), ovTitle: $('ovTitle'), ovSub: $('ovSub'), ovHint: $('ovHint'), ovName: $('ovName'),
  gscore: $('gscore'), barFill: $('barFill'), barCar: $('barCar'), cop: $('cop'), copFill: $('copFill'), gflash: $('gflash'), ovBody: $('ovBody'), barMarks: $('barMarks'),
  left: $('left'), right: $('right'),
}, levelByName(FIRST));
// Очки пройденного уровня — в славу (только уровни кампании)
game.onScore((points, meta) => {
  const inCamp = campaign.has(levelKey), prev = progressOf(levelKey).best;
  if (inCamp) recordLevel(levelKey, points, meta.clean, meta.target);
  const total = addFame(inCamp ? points : 0);
  // что открылось: следующий уровень в другом районе — его название и машина
  const idx = CAMPAIGN.indexOf(levelKey), next = idx >= 0 ? CAMPAIGN[idx + 1] : undefined;
  const dHere = DISTRICTS.find(d => d.levels.includes(levelKey)), dNext = next ? DISTRICTS.find(d => d.levels.includes(next)) : undefined;
  const unlock = dNext && dNext !== dHere && !progressOf(next!).done ? `${dNext.name} · ${CARS[dNext.car as CarKey].name}` : undefined;
  return { fame: total, best: prev, record: inCamp && points > prev && prev > 0, unlock };
});
game.onBest(() => progressOf(levelKey).best);
// Журнал теста: запуск игры и каждая попытка (log.ts) — где разбиваются, сколько попыток, какая частота кадров
logOpen();
game.onAttempt(a => logAttempt(levelKey, a));
// Пройденный уровень кампании (в том числе открытый из меню) ведёт к следующему по списку; последний — на карту
game.onEnd(how => {
  const next = campaign.advance(levelKey);
  if (!next) { if (levelKey === 'final' && how === 'done') { showEnding(); return true; } if (campaign.has(levelKey)) { openMap(); return true; } return false; }
  selectLevel(next);
  return true;
});

function currentLevel() {
  const l = levelByName(levelKey);
  // отладочный выбор «авто» сильнее всего; машина из гаража — только для повторов пройденных уровней кампании
  const replay = campaign.has(levelKey) && progressOf(levelKey).done ? chosenCar() : null;
  const car = carOverride ?? replay;
  return car ? { ...l, car } : l;
}
function selectLevel(key: string): void {
  levelKey = key;
  game.load(currentLevel());
  showPanel(key);
  hands();
  // первый маршрут ещё не начатого района — карточка района поверх интро (мир стоит, отсчёт ждёт)
  const d = districtToIntroduce(key);
  if (d && !query.get('level')) showDistrict($('dcard'), d, shell, () => { /* интро уровня уже на экране */ });
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
// Онбординг управления (docs/ui.md): руки над зонами LEFT/RIGHT на первом заезде пролога; каждая гаснет после первого нажатия своей зоны
for (const [id, zone] of [['handL', 'left'], ['handR', 'right']] as const) {
  $(id).innerHTML = icon('hand', 40);
  $(zone).addEventListener('pointerdown', () => $(id).classList.add('hide'));
}
addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'a') $('handL').classList.add('hide'); if (e.key === 'ArrowRight' || e.key === 'd') $('handR').classList.add('hide'); });
function hands(): void { const on = levelKey === 'prologue' && !progressOf('prologue').done; $('handL').classList.toggle('hide', !on); $('handR').classList.toggle('hide', !on); }
hands();
// Экраны оболочки: гараж, пауза, настройки, карточка района (shell.ts). Любой открытый экран ставит мир на паузу
const shellEls = () => [$('dcard'), $('garage'), $('pause'), $('settings'), $('note')];
const shell: ShellUi = {
  onChange: () => syncPause(),
  onMap: () => openMap(),
  onResume: () => syncPause(),
  onRestart: () => { game.restartLevel(); syncPause(); },
  onReset: () => { resetAll(); selectLevel(campaign.current()); },
  onSettings: () => renderSettings($('settings'), shell),
  onNote: () => openNote(),
};
// Заметка тестера (пауза, экран BUSTED): уровень, попытка, место на маршруте, причина и сборка подставляются сами —
// тестер пишет только «что не так». Сохраняется в журнал; «отправить» — ещё и сразу в мессенджер текстом
function openNote(): void {
  const i = game.info(), name = levelByName(levelKey).name;
  const ctx = `${name} · попытка ${attemptNo(levelKey, i.state)} · ${i.L ? Math.round(i.s / i.L * 100) : 0}% маршрута${i.state === 'busted' ? ` · ${i.why}` : ''} · сборка ${__BUILD__}`;
  showNote($('note'), ctx, shell, async (text, send) => {
    logNote(levelKey, i, text);
    if (!send) return 'сохранено в журнал';
    const d = device();
    return shareText(`BUSTED · ${ctx}\n${text}\n${d.vw}×${d.vh} @${d.dpr} · ${d.app ? 'с экрана «Домой»' : 'в браузере'} · ${d.ua}`);
  });
}
// кнопка «заметка» на экране BUSTED ловится до тапа по экрану, который перезапускает попытку
$('overlay').addEventListener('pointerdown', e => { if ((e.target as HTMLElement).closest('.nbtn')) { e.preventDefault(); e.stopPropagation(); openNote(); } }, true);
// Карта карьеры: районы и уровни, прогресс; открывается после загрузочного экрана (без ?level=) и по кнопке ☰; мир стоит
const mapEl = $('map');
function openMap(): void {
  for (const e of shellEls()) e.classList.add('hide');
  renderMap({ root: mapEl, onPlay: k => { closeMap(); if (k !== levelKey) selectLevel(k); else { game.restartLevel(); const d = districtToIntroduce(k); if (d) showDistrict($('dcard'), d, shell, () => {}); } },
    onClose: closeMap, onGarage: () => { mapEl.classList.add('hide'); renderGarage($('garage'), shell); }, onSettings: () => { mapEl.classList.add('hide'); renderSettings($('settings'), shell); } });
  mapEl.classList.remove('hide'); syncPause();
}
function closeMap(): void { mapEl.classList.add('hide'); syncPause(); }
// Кнопка в заезде — пауза (продолжить, заново, карта, звук, настройки)
$('mapBtn').innerHTML = icon('pause', 18);
$('mapBtn').onclick = () => { if ($('pause').classList.contains('hide')) showPause($('pause'), shell); };
// Загрузочный экран с ключевым артом: мир стоит (отсчёт не идёт), тап убирает экран
const splash = $('splash');
splash.style.backgroundImage = `url(${import.meta.env.BASE_URL}art/hero.jpg)`;
$('build').textContent = __BUILD__; // заметки и журнал тестеров привязаны к версии
// Новый игрок после загрузочного экрана сразу в прологе: сначала крючок, потом меню. Карта — когда пролог пройден
const firstRun = () => levelKey === 'prologue' && !progressOf('prologue').done;
splash.addEventListener('pointerdown', e => { e.preventDefault(); unlockAudio(); splash.classList.add('hide'); if (!query.get('level') && !firstRun()) openMap(); else syncPause(); }); // первый жест — можно включать звук
// Пока открыто меню, карта или загрузочный экран, мир стоит; тап по игровому полю закрывает меню и продолжает попытку
const menus = [panel, carPanel];
const syncPause = () => game.pause(!splash.classList.contains('hide') || !mapEl.classList.contains('hide') || !ending.classList.contains('hide') || shellEls().some(e => !e.classList.contains('hide')) || menus.some(m => m.classList.contains('open')));
syncPause();
initToggle($('levelBtn'), panel, [carPanel], syncPause);
initToggle($('carBtn'), carPanel, [panel], syncPause);
// Свернул игру, погасил экран, пришёл звонок — заезд встаёт на паузу с меню, звук молчит. Вернулся — едешь, когда сам нажмёшь
// «продолжить», а не в ту же секунду без рук на руле. Если мир уже стоит (карта, загрузочный экран, меню), меню паузы не нужно
function suspend(): void { if (!game.isPaused()) showPause($('pause'), shell); }
document.addEventListener('visibilitychange', () => { quietAudio(document.hidden); if (document.hidden) suspend(); });
addEventListener('blur', suspend);
addEventListener('pagehide', suspend);
document.addEventListener('pointerdown', () => unlockAudio(), true); // будит звук после звонка и блокировки (iOS)
document.addEventListener('pointerdown', e => {
  if (!menus.some(m => m.classList.contains('open'))) return;
  if ((e.target as HTMLElement).closest('.panel, #top')) return;
  for (const m of menus) m.classList.remove('open');
  syncPause();
}, true);
showPanel(FIRST);
showCarPanel();
