// Карта карьеры как город (docs/ui.md, §3): дорога вьётся снизу вверх через районы, каждый район нарисован движком уровней в своей
// палитре (день, закат, ночь), на дороге — точки уровней: пройден (звёзды), текущий (машина игрока, пульс), закрыт (замок).
// Холст рисует город и дорогу один раз при открытии; точки, таблички районов и карточка уровня — DOM поверх холста.
import { CARS, type CarKey } from './cars';
import { tester } from './tester';
import { CAMPAIGN, DISTRICTS, GARAGE, campaign, fame, progressOf, starsOf, type District } from './campaign';
import { LEVELS } from './levels';
import { buildPath, pathAt, type Path, type Pt } from './road';
import { drawGround, drawProps, drawRoad, fmtScore, setCity, setClip, withTheme } from './render';
import { icon, stars as starIcons } from './icons';
import type { Prop } from './levels';

// спрайт машины района — файл из public/art/pixel (те же, что рисует игра)
const CAR_SPRITE: Record<string, string> = { prologue: 'super_car', finale: 'super_car', minivan: 'happy_bus', sedan: 'white_sedan', muscle: 'muscle_car', sport: 'sport_car', supercar: 'super_car', bus: 'schoolbus' };

export interface MapUi { root: HTMLElement; onPlay: (key: string) => void; onClose: () => void; onGarage?: () => void; onSettings?: () => void }

const ROAD_W = 180, MAP_SCALE = 0.55;            // ширина дороги как в игре; масштаб холста: дорога ~100 css px на телефоне
const HEAD_S = 260, LEVEL_STEP = 170, TAIL_S = 200;  // мировых px на табличку района, на уровень и хвост за гаражом
const seeded = (seed: number) => () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

interface Node { key: string; s: number; district: District }
interface Band { district: District; s0: number; s1: number; theme?: string }

export function renderMap(ui: MapUi): void {
  const root = ui.root; root.innerHTML = '';
  const cur = campaign.current(), curIdx = CAMPAIGN.indexOf(cur);
  const base = import.meta.env.BASE_URL;

  // ---- шапка: название, слава, звук ----
  const head = document.createElement('div'); head.className = 'mhead';
  head.innerHTML = `<h1>BUSTED</h1><div class="fame"><small>слава</small><b>${icon('crown', 16)}${fmtScore(fame())}</b></div>`;
  const gear = document.createElement('button'); gear.className = 'msnd'; gear.innerHTML = icon('gear', 16); gear.setAttribute('aria-label', 'настройки');
  gear.onclick = () => ui.onSettings?.();
  head.appendChild(gear);
  root.appendChild(head);

  // ---- гараж: машины по ярусам ----
  const garage = document.createElement('div'); garage.className = 'mgarage';
  const total = CAMPAIGN.reduce((n, k) => n + starsOf(k), 0);
  garage.innerHTML = `<small>${icon('flag', 12)} гараж · ${icon('star', 12)} ${total} / ${CAMPAIGN.length * 3} <em>открыть ›</em></small><div class="cars">${GARAGE.map(g => {
    const d = DISTRICTS.find(x => x.name === g.district), spec = CARS[g.car as CarKey];
    const open = !!d && d.levels.some(k => CAMPAIGN.indexOf(k) <= curIdx);
    return `<div class="car${open ? '' : ' locked'}"><img src="${base}art/pixel/${CAR_SPRITE[g.car] ?? 'white_sedan'}.png" alt=""><b>${spec.name}</b><small>${open ? `${spec.speed} px/с` : `${icon('lock', 12)} ${g.district}`}</small></div>`;
  }).join('')}</div>`;
  garage.onclick = () => ui.onGarage?.();
  root.appendChild(garage);

  // ---- раскладка: дорога снизу вверх, район за районом ----
  const nodes: Node[] = [], bands: Band[] = [];
  let s = 120;
  for (const d of DISTRICTS) {
    const s0 = s; s += HEAD_S;
    for (const k of d.levels) { nodes.push({ key: k, s, district: d }); s += LEVEL_STEP; }
    bands.push({ district: d, s0, s1: s, theme: d.levels.length ? LEVELS[d.levels[0]]?.theme : undefined });
  }
  const totalS = s + TAIL_S;
  // дорога вьётся: x качается синусом, y — вверх (мировые координаты как в игре: y вниз, старт внизу)
  const pts: Pt[] = [];
  for (let t = 0; t <= totalS; t += 90) pts.push([70 * Math.sin(t / 620), -t]);
  const path = buildPath(pts);

  // ---- холст города ----
  const city = document.createElement('div'); city.className = 'mcity';
  const W = Math.min(root.clientWidth || 390, 520), H = Math.round(totalS * MAP_SCALE);
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  const cv = document.createElement('canvas'); cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  cv.style.width = `${W}px`; cv.style.height = `${H}px`;
  city.style.height = `${H}px`; city.style.width = `${W}px`;
  city.appendChild(cv);
  const ctx = cv.getContext('2d');
  if (ctx) {
    const half = W / 2 / MAP_SCALE;
    ctx.setTransform(DPR * MAP_SCALE, 0, 0, DPR * MAP_SCALE, DPR * W / 2, DPR * H);
    setCity(true);
    for (const b of bands) {
      // полоса района: земля, здания и дорога своей палитрой, обрезано по полосе
      const y0 = -b.s1, y1 = -b.s0;
      ctx.save(); ctx.beginPath(); ctx.rect(-half, y0, half * 2, y1 - y0); ctx.clip();
      setClip({ x0: -half, y0, x1: half, y1 });
      withTheme(b.theme, () => {
        drawGround(ctx, -half, y0, half * 2, y1 - y0);
        drawProps(ctx, buildings(b, half, path));
        drawRoad(ctx, path, ROAD_W, false, 0);
      });
      ctx.restore();
    }
    setClip(null);
  }
  // ---- точки уровней и таблички районов поверх холста ----
  const toCss = (ws: number): [number, number] => { const p = pathAt(path, ws); return [W / 2 + p.x * MAP_SCALE, H + p.y * MAP_SCALE]; };
  let selected = cur;
  const pins = new Map<string, HTMLButtonElement>();
  bands.forEach((b, i) => {
    const [x, y] = toCss(b.s0 + 60);
    const sign = document.createElement('div'); sign.className = 'msign ' + (i % 2 ? 'r' : 'l');
    const car = CARS[b.district.car as CarKey], done = b.district.levels.filter(k => progressOf(k).done).length;
    const open = b.district.levels.some(k => CAMPAIGN.indexOf(k) <= curIdx);
    sign.innerHTML = `<img src="${base}art/pixel/${CAR_SPRITE[b.district.car] ?? 'white_sedan'}.png" alt=""><div><h2>${b.district.name}</h2><small>${car.name} · ${done}/${b.district.levels.length}${open ? '' : ` · ${icon('lock', 10)}`}</small></div>`;
    sign.style.top = `${y}px`; sign.style.setProperty('--x', `${x}px`);
    city.appendChild(sign);
  });
  for (const n of nodes) {
    const idx = CAMPAIGN.indexOf(n.key), p = progressOf(n.key);
    const state = idx < curIdx || p.done ? 'done' : idx === curIdx ? 'cur' : 'locked';
    const [x, y] = toCss(n.s);
    const pin = document.createElement('button'); pin.className = `mpin ${state}`; pin.disabled = state === 'locked' && !tester();
    pin.style.left = `${x}px`; pin.style.top = `${y}px`;
    const num = n.district.levels.indexOf(n.key) + 1;
    pin.innerHTML = state === 'cur' ? `<img src="${base}art/pixel/${CAR_SPRITE[n.district.car] ?? 'white_sedan'}.png" alt="">`
      : state === 'locked' && !tester() ? icon('lock', 14) : `<b>${num}</b>`;
    if (state === 'done') pin.insertAdjacentHTML('beforeend', `<span class="pstars">${starIcons(starsOf(n.key), 9)}</span>`);
    pin.onclick = () => select(n.key);
    pins.set(n.key, pin); city.appendChild(pin);
  }
  root.appendChild(city);

  // ---- карточка выбранного уровня внизу: имя, звёзды, лучший и цель, «Ехать» ----
  const foot = document.createElement('div'); foot.className = 'mfoot';
  root.appendChild(foot);
  function select(key: string): void {
    selected = key;
    for (const [k, el] of pins) el.classList.toggle('sel', k === key);
    const lv = LEVELS[key], p = progressOf(key), d = DISTRICTS.find(x => x.levels.includes(key));
    const st = starsOf(key);
    foot.innerHTML = `<div class="mcard"><div class="mcard-t"><small>${d?.name ?? ''}</small><b>${lv?.name ?? key}</b></div>
      <div class="mcard-s">${starIcons(st, 16)}${p.done ? `<small>лучший ${fmtScore(p.best)}${p.target ? ` · цель ${fmtScore(p.target)}` : ''}</small>` : `<small>${key === cur ? 'текущий' : ''}</small>`}</div>
      <button class="mgo">${!p.done ? 'ехать' : 'ещё раз'} ${icon('next', 14)}</button></div>`;
    foot.querySelector<HTMLButtonElement>('.mgo')!.onclick = () => ui.onPlay(selected);
  }
  select(cur);
  // текущий уровень — в поле зрения
  requestAnimationFrame(() => pins.get(cur)?.scrollIntoView({ block: 'center' }));
}

// Здания района по обе стороны дороги: колонки коробок вдоль полосы, детерминированно от района
function buildings(b: Band, half: number, path: Path): Prop[] {
  const rnd = seeded(b.district.name.length * 7919 + Math.round(b.s0));
  const out: Prop[] = [];
  const gap = ROAD_W / 2 + 26 + 40; // полдороги, тротуар, отступ
  for (const side of [-1, 1]) {
    let y = -b.s1 + 20;
    while (y < -b.s0 - 40) {
      const h = 120 + Math.floor(rnd() * 160), sMid = -(y + h / 2);
      const p = pathAt(path, Math.max(0, Math.min(path.L, sMid)));
      const edge = p.x + side * gap;                       // край тротуара с этой стороны, у дороги
      const w = 110 + Math.floor(rnd() * 150);
      const x = side < 0 ? edge - w : edge;
      if (x > -half - 200 && x < half + 200) out.push({ type: 'building', x, y, w, h, tone: +rnd().toFixed(2) });
      y += h + 30 + Math.floor(rnd() * 30);
    }
  }
  return out;
}
