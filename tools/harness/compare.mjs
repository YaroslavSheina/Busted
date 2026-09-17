// Покадровое сравнение порта (port.mjs) с прототипом (prototype.html) на стабе DOM.
// Запуск: `npm run harness` (сборка, склейка, сравнение). Должно кончаться строкой «порт идентичен прототипу».
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..'); // корень репозитория: docs/prototype.html и docs/prototype-roads
let fakeNow = 0;
const fakePerf = { now: () => fakeNow };
Object.defineProperty(globalThis, 'performance', { value: fakePerf, configurable: true, writable: true });

// ---------- стаб DOM ----------
function makeDom() {
  const ctx = new Proxy({}, { get: () => () => {}, set: () => true });
  const byId = {};
  const win = { listeners: {} };
  function el(tag = 'div') {
    const e = {
      tag, _cls: new Set(), children: [], listeners: {}, _html: '', textContent: '', onclick: null, oninput: null, value: '', width: 0, height: 0,
      classList: { add: c => e._cls.add(c), remove: c => e._cls.delete(c), toggle: c => e._cls.has(c) ? e._cls.delete(c) : e._cls.add(c), contains: c => e._cls.has(c) },
      get className() { return [...e._cls].join(' '); },
      set className(v) { e._cls = new Set(v.split(' ').filter(Boolean)); },
      get innerHTML() { return e._html; },
      set innerHTML(v) { e._html = v; e.children = []; },
      addEventListener(t, f) { (e.listeners[t] ??= []).push(f); },
      appendChild(c) { e.children.push(c); return c; },
      querySelector(sel) {
        if (!e._q) e._q = {};
        if (!e._q[sel]) {
          const q = el(sel);
          if (sel === 'input') { const m = /value="([^"]*)"/.exec(e._html); q.value = m ? m[1] : ''; q.attrs = e._html.match(/<input[^>]*>/)?.[0]; }
          e._q[sel] = q;
        }
        return e._q[sel];
      },
      setPointerCapture() {}, getContext: () => ctx,
    };
    return e;
  }
  const document = {
    getElementById: id => (byId[id] ??= el(id)),
    createElement: tag => el(tag),
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const raf = { cb: null };
  return {
    document, byId, win, ctx,
    addEventListener: (t, f) => { (win.listeners[t] ??= []).push(f); },
    requestAnimationFrame: cb => { raf.cb = cb; },
    raf,
    key(type, key) { for (const f of win.listeners[type] ?? []) f({ key }); },
    frame(now) { const cb = raf.cb; raf.cb = null; cb(now); },
  };
}

// ---------- прототип ----------
function loadPrototype(dom) {
  const html = readFileSync(join(root, 'docs', 'prototype.html'), 'utf8');
  const body = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const fn = new Function('document', 'addEventListener', 'devicePixelRatio', 'innerWidth', 'innerHeight', 'performance', 'requestAnimationFrame', 'ovTitle', 'ovSub',
    body + '\nreturn { get car(){return car}, get traffic(){return traffic}, get cam(){return cam}, get state(){return state}, get hold(){return hold}, P };');
  return fn(dom.document, dom.addEventListener, 1, 390, 844, fakePerf, dom.requestAnimationFrame, dom.byId.ovTitle ?? dom.document.getElementById('ovTitle'), dom.document.getElementById('ovSub'));
}

// ---------- порт ----------
async function loadPort(dom) {
  Object.assign(globalThis, { document: dom.document, addEventListener: dom.addEventListener, requestAnimationFrame: dom.requestAnimationFrame, devicePixelRatio: 1, innerWidth: 390, innerHeight: 844 });
  await import(pathToFileURL(join(here, 'port.mjs')).href + '?t=' + Date.now());
}

// ---------- сценарий ----------
// [кадр, клавиша, 'keydown'|'keyup']
const SCRIPT = [
  [30, 'd', 'keydown'], [75, 'd', 'keyup'],
  [120, 'a', 'keydown'], [150, 'a', 'keyup'],
  [200, 'd', 'keydown'], [220, 'd', 'keyup'],
  [300, 'a', 'keydown'], [330, 'a', 'keyup'],
  [400, 'd', 'keydown'], [420, 'a', 'keydown'], [450, 'd', 'keyup'], [480, 'a', 'keyup'],
  [600, 'ArrowLeft', 'keydown'], [700, 'ArrowLeft', 'keyup'],
  [800, ' ', 'keydown'], [800, ' ', 'keyup'],
  [900, 'ArrowRight', 'keydown'], [1100, 'ArrowRight', 'keyup'], // длинное удержание → занос / вылет
  [1400, ' ', 'keydown'], [1400, ' ', 'keyup'],
  [2000, ' ', 'keydown'], [2000, ' ', 'keyup'],
];
const FRAMES = 3200;
const LEVELS = ['straight', 'bend', 'turn', 'uturn', 'ring'];

function snap(dom, g) {
  const c = g.car, t = g.traffic, cam = g.cam;
  return {
    car: [c.x, c.y, c.h, c.w, c.vx, c.vy, c.skid, c.s, c.off],
    traffic: t.map(v => [v.s, v.lane, v.spd, v.col]),
    cam: [cam.x, cam.y],
    state: g.state,
    hud: dom.byId.hud.innerHTML.replace(/<span class="score">[^<]*<\/span><br>/, '').replace(' · Седан', ''),
    overlay: dom.byId.overlay.className.replace(' done', ''), // порт вешает класс done для штампа DELIVERED
    title: dom.byId.ovTitle.textContent,
    sub: dom.byId.ovSub.textContent.split('\n')[0].replace(/ · слава [\d ]+$/, '').replace(/ · очки .*$/, ''), // порт дописывает очки и славу строками ниже
    zones: [dom.byId.left.className, dom.byId.right.className],
  };
}

function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function panelSnapshot(dom) {
  const panel = dom.byId.panel;
  const levels = panel.children[0]?.children.map(b => [b.textContent, b.className]).filter(([n]) => Object.values(LEVELS_NAME).includes(n)).sort();
  const rows = panel.children.slice(1, -1).map(r => r.innerHTML);
  const hint = panel.children.at(-1)?.textContent;
  return { levels, rows, hint };
}


let failures = 0;
function fail(msg) { failures++; if (failures <= 20) console.log('FAIL', msg); }
const LEVELS_NAME = { straight: 'Прямая', bend: 'Изгиб 45°', turn: 'Поворот 90°', uturn: 'Разворот', ring: 'Кольцо' };

async function runScenario(name, level, sliders, script, frames) {
  fakeNow = 0;
  const dA = makeDom(); const proto = loadPrototype(dA);
  const dB = makeDom(); await loadPort(dB); const gB = globalThis.__lr;
  const pickA = dom => dom.byId.panel.children[0].children.find(b => b.textContent === LEVELS_NAME[level]).onclick();
  pickA(dA);
  gB.load(JSON.parse(readFileSync(join(root, 'docs', 'prototype-roads', level + '.json'), 'utf8')));
  { const PP = gB.P; PP.speed.v = 300; PP.steer.v = 5; PP.damp.v = 3; PP.grip.v = 7; PP.spin.v = 2.4; PP.skidGrip.v = 1.2; } // физика прототипа, независимо от таблицы машин
  for (const [label, value] of Object.entries(sliders)) {
    const set = dom => { const row = dom.byId.panel.children.flatMap(c => [c, ...c.children]).find(r => r.innerHTML.includes(label)); const inp = row.querySelector('input'); inp.value = String(value); inp.oninput(); };
    set(dA); set(dB);
  }
  let now = 0, mism = 0, busts = 0, finishes = 0, skids = 0, prevState = 'play'; const whys = new Set();
  for (let f = 0; f < frames; f++) {
    for (const [fr, k, t] of script) if (fr === f) { dA.key(t, k); dB.key(t, k); }
    now += 1000 / 60;
    dA.frame(now); dB.frame(now);
    const a = snap(dA, proto), b = snap(dB, gB);
    if (!eq(a, b)) { mism++; if (mism <= 3) fail(`${name} кадр ${f}:\n A ${JSON.stringify(a).slice(0, 400)}\n B ${JSON.stringify(b).slice(0, 400)}`); }
    if (a.state !== prevState) { if (a.state === 'busted') { busts++; whys.add(a.sub.split('\n')[0]); } if (a.state === 'done') finishes++; prevState = a.state; }
    if (a.car[6]) skids++;
  }
  console.log(`${name.padEnd(22)} расхождений ${mism} | busted ${busts} (${[...whys].join(', ') || '—'}) | delivered ${finishes} | кадров в заносе ${skids} | трафик ${proto.traffic.length}`);
}

const SPACE = f => [[f, ' ', 'keydown'], [f, ' ', 'keyup']];
for (const level of LEVELS) await runScenario(level, level, {}, SCRIPT, FRAMES);
await runScenario('straight/доставка', 'straight', {}, [], 1000);
await runScenario('straight/трафик 0', 'straight', { 'Плотность трафика': 0 }, [], 1000);
await runScenario('straight/трафик 1.5', 'straight', { 'Плотность трафика': 1.5 }, [], 1000);
await runScenario('bend/скорость 600', 'bend', { 'Скорость': 600 }, [[20, 'd', 'keydown'], [80, 'd', 'keyup'], [90, 'a', 'keydown'], [140, 'a', 'keyup'], ...SPACE(400), [420, 'a', 'keydown'], [520, 'a', 'keyup']], 800);
await runScenario('ring/ширина 260', 'ring', { 'Ширина дороги': 260, 'Прощение края': 30 }, [[10, 'd', 'keydown'], [40, 'd', 'keyup'], [200, 'a', 'keydown'], [230, 'a', 'keyup']], 1500);

console.log(failures ? `\nИТОГО расхождений: ${failures}` : '\nИТОГО: порт идентичен прототипу');
process.exit(failures ? 1 : 0);
