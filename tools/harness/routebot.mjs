// Бот с маршрутом по графу дорог: LEVEL — уровень, TAKE — индексы веток, на которые сворачивать (через запятую),
// LANE — полоса (0..2, по умолчанию 1). SWEEP=<дорога>:<перекрёсток> — перебор фазы этого перекрёстка, сколько полос проходит.
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
let fakeNow = 0;
Object.defineProperty(globalThis, 'performance', { value: { now: () => fakeNow }, configurable: true, writable: true });
const ctx = new Proxy({}, { get: () => () => ({ addColorStop() {} }), set: () => true });
const byId = {};
const el = () => { const e = { _cls: new Set(), children: [], textContent: '', _html: '', value: '', onclick: null, oninput: null,
  classList: { add: c => e._cls.add(c), remove: c => e._cls.delete(c), toggle(c) { return e._cls.has(c) ? (e._cls.delete(c), false) : (e._cls.add(c), true); }, contains: c => e._cls.has(c) },
  get className() { return [...e._cls].join(' '); }, set className(v) { e._cls = new Set(v.split(' ').filter(Boolean)); },
  get innerHTML() { return e._html; }, set innerHTML(v) { e._html = v; e.children = []; }, addEventListener() {}, removeEventListener() {}, appendChild(c) { e.children.push(c); return c; },
  querySelector() { return el(); }, setPointerCapture() {}, getContext: () => ctx }; return e; };
let raf = null; const win = {};
Object.assign(globalThis, { document: { getElementById: id => (byId[id] ??= el()), createElement: el, querySelectorAll: () => [], addEventListener() {} },
  addEventListener: (t, f) => { (win[t] ??= []).push(f); }, /* все обработчики типа: у игры их несколько (руль и руки-подсказки) */ removeEventListener() {}, requestAnimationFrame: cb => { raf = cb; }, cancelAnimationFrame() {}, devicePixelRatio: 1, innerWidth: 390, innerHeight: 844 });
await import(pathToFileURL(join(here, 'port.mjs')).href + '?t=' + Date.now());
const g = globalThis.__lr;
byId.panel.children[0].children.find(b => b.textContent === (process.env.LEVEL ?? 'Район 2 · маршрут 1')).onclick();
const level0 = { ...g.level };
const step = () => { const cb = raf; raf = null; fakeNow += 1000 / 60; cb(fakeNow); };
const why = () => byId.ovSub.textContent.split('\n')[0];
const take = new Set((process.env.TAKE ?? '').split(',').filter(Boolean).map(n => +n + 1));
const laneW = level0.width / 3, LOOK = +(process.env.LOOK ?? 150);
const PLAN = (process.env.PLAN ?? '').split(',').filter(Boolean).map(x => x.split(':').map(Number));
// куда целиться: если впереди развилка на нужную ветку — на её ось, иначе на ось текущей дороги
function aim() {
  const r = g.car.road;
  for (let i = 1; i < g.roads.length; i++) {
    const rd = g.roads[i]; if (rd.parent !== r || !take.has(i)) continue;
    const b = rd.def; if (g.car.s < b.from - 200 || g.car.s > b.from + 300) continue;
    return { path: rd.path, s: g.car.s - (b.from - 60) + LOOK };
  }
  return { path: g.path, s: g.car.s + LOOK };
}
function botDir(off) {
  const { path, s } = aim(); const pt = path.pt, sAim = Math.max(0, Math.min(path.L, s));
  let lo = 0, hi = pt.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (pt[m].s < sAim) lo = m + 1; else hi = m; }
  const a = pt[lo]; const hd = Math.atan2(a.x + a.nx * off - g.car.x, -(a.y + a.ny * off - g.car.y));
  let e = hd - g.car.h; while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI;
  // не давить кнопку, если вращение уже у порога заноса (масл-кар: низкий порог) — человек в такой момент отпускает
  const u = e - 0.35 * g.car.w, lim = 0.75 * g.P.spin.v; return u > 0.04 && g.car.w < lim ? 1 : u < -0.04 && g.car.w > -lim ? -1 : 0;
}
const fire = (t, key) => { for (const f of win[t] ?? []) f({ key }); };
const press = d => { fire('keydown', d < 0 ? 'a' : 'd'); fire('keyup', d < 0 ? 'd' : 'a'); if (d === 0) { fire('keyup', 'a'); fire('keyup', 'd'); } };
// OVERTAKE=1: если в целевой полосе впереди медленная машина, уйти в соседнюю свободную (без машин рядом и без заграждений впереди);
// встречные полосы не годятся. Возврат в целевую, как только она свободна. Полосу держим, пока не сменилась цель (без дёрганья)
let lastLane = null, lastDir = 0;
function freeLane(target) {
  if (!process.env.OVERTAKE) return target;
  const rd = g.roads[g.car.road], s = g.car.s, onc = g.level.oncoming ?? 0;
  const carsIn = l => g.traffic.filter(c => c.lane === l && c.dir !== -1 && c.kind !== 'ramp');
  const look = 2.0 * g.P.speed.v; // окно обгона — две секунды хода (минивэн перестраивается ~1.5 с)
  const busy = l => carsIn(l).some(c => c.s > s - 120 && c.s < s + look && c.v < g.P.speed.v - 30);
  const near = l => carsIn(l).some(c => Math.abs(c.s - s) < 140);
  const blocked = l => [...rd.blocks.police, ...rd.blocks.spikes].some(b => b.lane === l && b.s > s - 40 && b.s < s + look + 100) || rd.blocks.works.some(w => w.lane === l && w.s + w.l / 2 > s - 40 && w.s - w.l / 2 < s + look + 100);
  const ok = l => l >= onc && l < 3 && !busy(l) && !blocked(l);
  if (ok(target)) { lastLane = null; return target; }
  if (lastLane !== null && lastLane !== target && ok(lastLane)) return lastLane;
  for (const l of [target - 1, target + 1]) if (ok(l) && !near(l)) { lastLane = l; return l; }
  return lastLane !== null && !blocked(lastLane) ? lastLane : target;
}
function run(lvl, lane, frames = +(process.env.FRAMES ?? 2400), stopAt = null) {
  g.load(lvl); press(0); press(0); step(); byId.ovSub.textContent = '';
  let road = g.car.road, croad = g.chaser?.road; const log = []; let f = 0; let passed = false;
  for (; f < frames && g.state === 'play'; f++) {
    const planned = PLAN.length ? (PLAN.filter(([ps]) => g.car.s >= ps).at(-1)?.[1] ?? lane) : lane; // PLAN=s:lane,s:lane — полоса по s
    lastDir = botDir((freeLane(planned) - 1) * laneW); press(lastDir); step();
    if (process.env.TRACE && f >= +process.env.TRACE && f < +process.env.TRACE + 40) { const near = (path) => { let b = Infinity, bs = 0; for (const p of path.pt) { const d = Math.hypot(p.x - g.car.x, p.y - g.car.y); if (d < b) { b = d; bs = p.s; } } return `${Math.round(b)}@${Math.round(bs)}`; }; console.log(`   f${f} road ${g.car.road} s ${Math.round(g.car.s)} off ${g.car.off.toFixed(0)} xy ${Math.round(g.car.x)},${Math.round(g.car.y)} h ${g.car.h.toFixed(2)} | до оси главной ${near(g.roads[0].path)}${g.roads[1] ? ` | до оси А ${near(g.roads[1].path)}` : ''} | рампы ${g.traffic.filter(c => c.kind === 'ramp').map(c => `${Math.round(c.s)}/${Math.round(c.v)}`).join(',')} | air ${g.air ?? '-'} | w ${g.car.w.toFixed(2)} нажал ${lastDir} | цель ${freeLane(planned)} | рядом ${g.traffic.filter(c => Math.abs(c.s - g.car.s) < 600).map(c => `${c.lane}${c.dir === -1 ? 'в' : ''}:${Math.round(c.s - g.car.s)}/${Math.round(c.v)}${c.panic ? '!' : ''}`).join(' ')}`); }
    if (g.car.road !== road) { road = g.car.road; log.push(`→ ${road} @s${Math.round(g.car.s)} ${(f / 60).toFixed(1)}с`); }
    if (g.chaser && g.chaser.road !== croad) { croad = g.chaser.road; log.push(`коп → ${croad}`); }
    if (stopAt && g.car.road === stopAt.road && g.car.s > stopAt.s + 100) { passed = true; break; }
  }
  return { state: g.state, why: why(), s: Math.round(g.car.s), road: g.car.road, log, t: f / 60, passed };
}
if (process.env.SWEEP) {
  const [ri, ci] = process.env.SWEEP.split(':').map(Number);
  const defs = ri === 0 ? level0.crossings : level0.branches[ri - 1].crossings; const c = defs[ci];
  const line = [];
  for (let off = 0; off < c.period; off += 0.5) {
    let ok = 0;
    for (const lane of [0, 1, 2]) {
      const lvl = { ...level0, traffic: 0, cars: [], chaser: undefined, crossings: ri === 0 ? level0.crossings.map((d, i) => i === ci ? { ...d, offset: off } : d) : level0.crossings,
        branches: level0.branches.map((b, bi) => bi === ri - 1 ? { ...b, cars: [], crossings: b.crossings.map((d, i) => i === ci ? { ...d, offset: off } : d) } : { ...b, cars: [] }) };
      if (run(lvl, lane, 2400, { road: ri, s: c.s }).passed) ok++;
    }
    line.push(`${off}:${ok}`);
  }
  console.log(`дорога ${ri}, перекрёсток s${c.s} (цикл ${c.period}, сейчас offset ${c.offset}): полос проходит →\n   ${line.join('  ')}`);
} else {
  for (const lane of process.env.LANE ? [+process.env.LANE] : [0, 1, 2]) {
    const clean = { ...level0, traffic: 0, cars: process.env.KEEPRAMP ? (level0.cars ?? []).filter(c => c.type === 'ramp') : [], chaser: process.env.KEEPCOP ? level0.chaser : undefined, branches: (level0.branches ?? []).map(b => ({ ...b, cars: [], ...(process.env.NOCROSS ? { crossings: [] } : {}) })), ...(process.env.NOCROSS ? { crossings: [] } : {}) };
    const r = run(process.env.CLEAN ? clean : level0, lane);
    if (process.env.BODY) console.log(byId.ovBody?._html ?? '', '|', byId.ovSub?.textContent ?? '', '|', byId.gflash?.textContent ?? ''); // BODY=1 — экран результата
    console.log(`полоса ${lane}: ${r.state} ${r.why} @${r.s} дорога ${r.road} ${r.t.toFixed(1)}с${process.env.KEEPCOP ? (g.chaser ? ` | коп жив, хвост ${Math.round(g.car.s - g.chaser.s)}` : ' | коп выбыл') : ''} | ${r.log.join(' | ') || 'без переходов'}`);
  }
}
