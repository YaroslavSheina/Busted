// Оболочка вне заезда (docs/ui.md, §3): карточка района перед первым маршрутом, гараж, пауза, настройки.
// Каждый экран — один DOM-узел на весь экран; открытие/закрытие через класс hide, пауза мира — через onChange (main.ts: syncPause).
import { CARS, type CarKey, type CarSpec } from './cars';
import { CAMPAIGN, DISTRICTS, GARAGE, campaign, progressOf, type District } from './campaign';
import { audioEnabled, setAudioEnabled } from './audio';
import { hapticsEnabled, setHapticsEnabled } from './haptics';
import { icon } from './icons';
import { setTester, tester } from './tester';

export const CAR_SPRITE: Record<string, string> = { prologue: 'super_car', finale: 'super_car', minivan: 'happy_bus', sedan: 'white_sedan', muscle: 'muscle_car', sport: 'sport_car', supercar: 'super_car', bus: 'schoolbus' };
const base = () => import.meta.env.BASE_URL;

// Три полоски характеристик: скорость, руль, сцепление — доля от максимума по парку
export function statBars(spec: CarSpec): string {
  const rows: [string, number][] = [['скорость', spec.speed / 420], ['руль', spec.steer / 7.5], ['сцепление', spec.grip / 9.5]];
  return `<div class="stats">${rows.map(([l, v]) => `<div><small>${l}</small><i><b style="width:${Math.round(Math.min(1, v) * 100)}%"></b></i></div>`).join('')}</div>`;
}

// Машина открыта, когда открыт её район
export function carUnlocked(car: string): boolean {
  const g = GARAGE.find(x => x.car === car); if (!g) return true;
  const d = DISTRICTS.find(x => x.name === g.district), curIdx = CAMPAIGN.indexOf(campaign.current());
  return !!d && d.levels.some(k => CAMPAIGN.indexOf(k) <= curIdx);
}

// Выбор машины для повторов (кампания едет на своей): lr.car
const CAR_KEY = 'lr.car';
export function chosenCar(): CarKey | null { try { const k = localStorage.getItem(CAR_KEY); return k && k in CARS && carUnlocked(k) ? k as CarKey : null; } catch { return null; } }
export function chooseCar(k: CarKey | null): void { try { k ? localStorage.setItem(CAR_KEY, k) : localStorage.removeItem(CAR_KEY); } catch { /* приватный режим */ } }

export interface ShellUi { onChange: () => void; onMap: () => void; onRestart: () => void; onResume: () => void; onReset: () => void; onSettings?: () => void }

// ---------- карточка района: табличка, машина въезжает, характеристики, строка истории ----------
export function showDistrict(el: HTMLElement, d: District, ui: ShellUi, done: () => void): void {
  const spec = CARS[d.car as CarKey];
  el.innerHTML = `<div class="dbox"><div class="dsign">${d.name}</div>
    <img class="dcar" src="${base()}art/pixel/${CAR_SPRITE[d.car] ?? 'white_sedan'}.png" alt="">
    <h2>${spec.name}</h2>${statBars(spec)}${d.story ? `<p>${d.story}</p>` : ''}<small>нажми — поехали</small></div>`;
  el.classList.remove('hide'); ui.onChange();
  const close = (e: Event) => { e.preventDefault(); el.removeEventListener('pointerdown', close); el.classList.add('hide'); ui.onChange(); done(); };
  el.addEventListener('pointerdown', close);
}

// ---------- гараж: карусель машин по ярусам, выбор для повторов ----------
export function renderGarage(el: HTMLElement, ui: ShellUi): void {
  const chosen = chosenCar();
  el.innerHTML = `<div class="gtop"><h1>${icon('flag', 18)} гараж</h1><button class="gclose">${icon('map', 18)} карта</button></div>
    <p class="ghint">В кампании каждый район едет на своей машине. Выбранная здесь — для повторов пройденных уровней.</p>
    <div class="gcars">${GARAGE.map(g => {
      const spec = CARS[g.car as CarKey], open = carUnlocked(g.car), sel = chosen === g.car;
      return `<div class="gcar${open ? '' : ' locked'}${sel ? ' sel' : ''}" data-car="${g.car}">
        <img src="${base()}art/pixel/${CAR_SPRITE[g.car] ?? 'white_sedan'}.png" alt=""><h2>${spec.name}</h2><small>${open ? `${spec.speed} px/с · ${g.district}` : `${icon('lock', 12)} откроется: ${g.district}`}</small>
        ${statBars(spec)}${open ? `<button class="gpick">${sel ? 'выбрана' : 'выбрать'}</button>` : ''}</div>`;
    }).join('')}</div>`;
  el.querySelector<HTMLButtonElement>('.gclose')!.onclick = () => { el.classList.add('hide'); ui.onMap(); };
  el.querySelectorAll<HTMLButtonElement>('.gpick').forEach(b => { b.onclick = () => { const k = b.closest<HTMLElement>('.gcar')!.dataset.car as CarKey; chooseCar(chosen === k ? null : k); renderGarage(el, ui); }; });
  el.classList.remove('hide'); ui.onChange();
}

// ---------- пауза: продолжить, заново, карта, звук ----------
export function showPause(el: HTMLElement, ui: ShellUi): void {
  const draw = () => {
    el.innerHTML = `<div class="pbox"><h1>пауза</h1>
      <button class="pbtn" data-a="resume">${icon('next', 16)} продолжить</button>
      <button class="pbtn" data-a="restart">${icon('retry', 16)} заново</button>
      <button class="pbtn" data-a="map">${icon('map', 16)} карта</button>
      <button class="pbtn" data-a="sound">${icon(audioEnabled() ? 'sound' : 'mute', 16)} звук ${audioEnabled() ? 'вкл' : 'выкл'}</button>
      <button class="pbtn" data-a="settings">${icon('gear', 16)} настройки</button></div>`;
    el.querySelectorAll<HTMLButtonElement>('.pbtn').forEach(b => { b.onclick = () => act(b.dataset.a!); });
  };
  const hide = () => { el.classList.add('hide'); ui.onChange(); };
  const act = (a: string) => {
    if (a === 'sound') { setAudioEnabled(!audioEnabled()); draw(); return; }
    hide();
    if (a === 'resume') ui.onResume(); else if (a === 'restart') ui.onRestart(); else if (a === 'map') ui.onMap(); else if (a === 'settings') ui.onSettings?.();
  };
  draw(); el.classList.remove('hide'); ui.onChange();
}

// ---------- настройки: звук, вибрация, сброс прогресса ----------
export function renderSettings(el: HTMLElement, ui: ShellUi): void {
  let armed = false; // сброс — двумя тапами
  let taps = 0;      // пять тапов по номеру сборки — режим тестера
  const draw = () => {
    el.innerHTML = `<div class="sbox"><h1>${icon('gear', 18)} настройки</h1>
      <button class="srow" data-a="sound"><span>${icon(audioEnabled() ? 'sound' : 'mute', 16)} звук</span><b>${audioEnabled() ? 'вкл' : 'выкл'}</b></button>
      <button class="srow" data-a="haptics"><span>${icon('siren', 16)} вибрация</span><b>${hapticsEnabled() ? 'вкл' : 'выкл'}</b></button>
      <div class="srow static"><span>язык</span><b>русский</b></div>
      ${tester() ? `<button class="srow" data-a="tester"><span>${icon('flag', 16)} тестер: все уровни</span><b>вкл</b></button>` : ''}
      <button class="srow danger" data-a="reset"><span>${icon('cuffs', 16)} сбросить прогресс</span><b>${armed ? 'точно?' : ''}</b></button>
      <button class="sclose">${icon('map', 16)} на карту</button><small class="sbuild">сборка ${__BUILD__}</small></div>`;
    el.querySelector<HTMLElement>('.sbuild')!.onclick = () => { if (++taps >= 5) { taps = 0; setTester(!tester()); draw(); } };
    el.querySelectorAll<HTMLButtonElement>('.srow[data-a]').forEach(b => { b.onclick = () => act(b.dataset.a!); });
    el.querySelector<HTMLButtonElement>('.sclose')!.onclick = () => { el.classList.add('hide'); ui.onMap(); };
  };
  const act = (a: string) => {
    if (a === 'sound') setAudioEnabled(!audioEnabled());
    else if (a === 'haptics') setHapticsEnabled(!hapticsEnabled());
    else if (a === 'tester') setTester(false);
    else if (a === 'reset') { if (!armed) { armed = true; } else { armed = false; ui.onReset(); el.classList.add('hide'); ui.onMap(); return; } }
    draw();
  };
  draw(); el.classList.remove('hide'); ui.onChange();
}

// первый уровень района, который ещё не начат — показать карточку района
export function districtToIntroduce(key: string): District | null {
  const d = DISTRICTS.find(x => x.levels[0] === key);
  if (!d || d.name === 'Пролог') return null;
  return d.levels.some(k => progressOf(k).done) ? null : d;
}
