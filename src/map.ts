// Карта карьеры (docs/career.md): районы по порядку, в каждом — уровни с состоянием: пройден (лучший результат), текущий, закрыт.
// Тап по пройденному или текущему запускает уровень; закрытые не откликаются. Внизу — «Продолжить» на текущий уровень.
import { CARS, type CarKey } from './cars';
import { CAMPAIGN, DISTRICTS, GARAGE, campaign, fame, progressOf, starsOf } from './campaign';
import { LEVELS } from './levels';
import { fmtScore } from './render';

// спрайт машины района — файл из public/art/pixel (те же, что рисует игра)
const CAR_SPRITE: Record<string, string> = { prologue: 'super_car', finale: 'super_car', minivan: 'happy_bus', sedan: 'white_sedan', muscle: 'muscle_car', sport: 'sport_car', supercar: 'super_car', bus: 'schoolbus' };

export interface MapUi { root: HTMLElement; onPlay: (key: string) => void; onClose: () => void }

export function renderMap(ui: MapUi): void {
  const root = ui.root; root.innerHTML = '';
  const cur = campaign.current(), curIdx = CAMPAIGN.indexOf(cur);
  const base = import.meta.env.BASE_URL;
  const head = document.createElement('div'); head.className = 'mhead';
  head.innerHTML = `<h1>BUSTED</h1><div class="fame"><small>слава</small><b>${fmtScore(fame())}</b></div>`;
  root.appendChild(head);
  // гараж: машины по ярусам, открыта — когда открыт её район
  const garage = document.createElement('div'); garage.className = 'mgarage';
  const total = CAMPAIGN.reduce((n, k) => n + starsOf(k), 0);
  garage.innerHTML = `<small>гараж · ★ ${total} / ${CAMPAIGN.length * 3}</small><div class="cars">${GARAGE.map(g => {
    const d = DISTRICTS.find(x => x.name === g.district), spec = CARS[g.car as CarKey];
    const open = !!d && d.levels.some(k => CAMPAIGN.indexOf(k) <= curIdx);
    return `<div class="car${open ? '' : ' locked'}"><img src="${base}art/pixel/${CAR_SPRITE[g.car] ?? 'white_sedan'}.png" alt=""><b>${spec.name}</b><small>${open ? `${spec.speed} px/с` : '🔒 ' + g.district}</small></div>`;
  }).join('')}</div>`;
  root.appendChild(garage);
  const list = document.createElement('div'); list.className = 'mlist';
  for (const d of DISTRICTS) {
    const car = CARS[d.car as CarKey];
    const done = d.levels.filter(k => progressOf(k).done).length, stars = d.levels.reduce((n, k) => n + starsOf(k), 0);
    const open = d.levels.some(k => CAMPAIGN.indexOf(k) <= curIdx);
    const sec = document.createElement('section'); sec.className = 'mdist' + (open ? '' : ' locked');
    sec.innerHTML = `<header><img src="${base}art/pixel/${CAR_SPRITE[d.car] ?? 'white_sedan'}.png" alt=""><div><h2>${d.name}</h2><small>${car.name} · ${car.speed} px/с · ${done}/${d.levels.length} · ★ ${stars}/${d.levels.length * 3}</small></div></header>`;
    const rows = document.createElement('div'); rows.className = 'mrows';
    d.levels.forEach((k, i) => {
      const p = progressOf(k), idx = CAMPAIGN.indexOf(k);
      const state = idx < curIdx || p.done ? 'done' : idx === curIdx ? 'cur' : 'locked';
      const row = document.createElement('button'); row.className = 'mrow ' + state; row.disabled = state === 'locked';
      const name = LEVELS[k]?.name ?? k;
      const stars = starsOf(k), marks = state === 'locked' ? '' : `<span class="stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>`;
      row.innerHTML = `<span class="n">${i + 1}</span><span class="t">${name}</span>${marks}<span class="s">${state === 'done' ? (p.best ? fmtScore(p.best) : '✓') : state === 'cur' ? '▶' : ''}</span>`;
      if (state !== 'locked') row.onclick = () => ui.onPlay(k);
      rows.appendChild(row);
    });
    sec.appendChild(rows); list.appendChild(sec);
  }
  root.appendChild(list);
  const foot = document.createElement('div'); foot.className = 'mfoot';
  const go = document.createElement('button'); go.className = 'mgo'; go.textContent = curIdx >= CAMPAIGN.length - 1 && progressOf(cur).done ? 'Играть снова' : 'Продолжить';
  go.onclick = () => ui.onPlay(cur);
  foot.appendChild(go);
  root.appendChild(foot);
  // текущий уровень — в поле зрения
  requestAnimationFrame(() => root.querySelector('.mrow.cur')?.scrollIntoView({ block: 'center' }));
}
