// Генератор районов: сетка кварталов; дороги — списки узлов сетки (главная и ветки с родителем), между узлами
// прямые, на углах дуги радиуса R; перекрёстки там, где дорога проходит узел прямо; здания во всех кварталах.
// Ветка отходит от прямого участка родителя за R до узла дугой и вливается в прямой участок дугой через R после узла.
// Район = сетка, здания, машина, гараж; маршрут = свои дороги и старт при общем районе — один район даёт несколько уровней.
// Пишет levels/<file>.json для каждого маршрута из DISTRICTS. Фазы светофоров затем проверяются routebot.mjs (SWEEP).
const fs = require('fs');
process.chdir(require('path').join(__dirname, '..')); // корень проекта

const BX = 620, BY = 520;      // размер квартала между осями улиц
const ROAD = 180, R = 220, MARGIN = 26, LEAD = 60; // R: внутренняя полоса угла = R − 60 ≥ минимального радиуса седана (~150 после настройки 2026-09-08); LEAD = BRANCH.lead
const mkRnd = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const node = ([i, j]) => [i * BX, j * BY];

// --- та же выборка, что в road.ts — s точек дороги
function catmull(p0, p1, p2, p3, t) { const t2 = t * t, t3 = t2 * t; return [
  0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
  0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]; }
function sample(pts) {
  const out = []; let s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(i + 2, pts.length - 1)];
    const steps = Math.max(8, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 6));
    for (let k = 0; k < steps; k++) { const q = catmull(p0, p1, p2, p3, k / steps); if (out.length) s += Math.hypot(q[0] - out.at(-1).x, q[1] - out.at(-1).y); out.push({ x: q[0], y: q[1], s }); }
  }
  const l = pts.at(-1); s += Math.hypot(l[0] - out.at(-1).x, l[1] - out.at(-1).y); out.push({ x: l[0], y: l[1], s });
  return out;
}
const sAt = (sm, x, y) => { let best = Infinity, bs = 0; for (const p of sm) { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < best) { best = d; bs = p.s; } } return Math.round(bs); };
const at = (sm, s) => { s = Math.max(0, Math.min(sm.at(-1).s, s)); let i = 1; while (i < sm.length - 1 && sm[i].s < s) i++; const a = sm[i - 1], b = sm[i], t = (s - a.s) / ((b.s - a.s) || 1); return [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t]; };

// --- ноги между узлами и ломаная с дугами; соседние ноги одного направления сливаются в одну (узлы между ними — прямые проезды)
function legsOf(nodes) {
  const legs = [];
  for (let k = 0; k < nodes.length - 1; k++) {
    const a = node(nodes[k]), b = node(nodes[k + 1]), dx = Math.sign(b[0] - a[0]), dy = Math.sign(b[1] - a[1]);
    const last = legs.at(-1);
    if (last && last.dx === dx && last.dy === dy) { last.b = b; last.len = Math.hypot(b[0] - last.a[0], b[1] - last.a[1]); }
    else legs.push({ a, b, dx, dy, len: Math.hypot(b[0] - a[0], b[1] - a[1]) });
  }
  return legs;
}
// open — ветка: первая и последняя ноги виртуальные (лежат на родителе), от них берутся только дуги
function polyline(legs, open) {
  const pts = [];
  const push = p => { const q = [Math.round(p[0]), Math.round(p[1])]; const l = pts[pts.length - 1]; if (!l || l[0] !== q[0] || l[1] !== q[1]) pts.push(q); };
  if (!open) push(legs[0].a);
  for (let k = 0; k < legs.length; k++) {
    const L = legs[k], next = legs[k + 1], prev = legs[k - 1];
    const virt = open && (k === 0 || k === legs.length - 1);
    const start = prev ? [L.a[0] + L.dx * R, L.a[1] + L.dy * R] : L.a;   // после дуги
    const end = next ? [L.b[0] - L.dx * R, L.b[1] - L.dy * R] : L.b;     // до начала дуги
    if (!virt) {
      const span = Math.hypot(end[0] - start[0], end[1] - start[1]);
      const n = Math.max(1, Math.ceil(span / 500));
      for (let m = 0; m <= n; m++) push([start[0] + (end[0] - start[0]) * m / n, start[1] + (end[1] - start[1]) * m / n]);
    }
    if (next) { // дуга от end к точке после угла
      const cx = end[0] + next.dx * R, cy = end[1] + next.dy * R;
      const a0 = Math.atan2(end[1] - cy, end[0] - cx), a1 = Math.atan2((L.b[1] + next.dy * R) - cy, (L.b[0] + next.dx * R) - cx);
      let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      for (let m = 1; m <= 3; m++) { const a = a0 + da * m / 4; push([cx + R * Math.cos(a), cy + R * Math.sin(a)]); }
    }
  }
  return pts;
}
// Направление дороги в узле, через который она идёт прямо; null — узел не на прямом участке
function dirAt(legs, n) {
  const [x, y] = node(n);
  for (const L of legs) {
    const on = L.dx ? (y === L.a[1] && Math.min(L.a[0], L.b[0]) <= x && x <= Math.max(L.a[0], L.b[0])) : (x === L.a[0] && Math.min(L.a[1], L.b[1]) <= y && y <= Math.max(L.a[1], L.b[1]));
    if (!on) continue;
    const atEnd = (x === L.a[0] && y === L.a[1]) || (x === L.b[0] && y === L.b[1]);
    if (!atEnd) return [L.dx, L.dy];
    // конец ноги: прямо, только если соседняя нога идёт туда же
    const other = legs.find(o => o !== L && ((x === o.a[0] && y === o.a[1]) || (x === o.b[0] && y === o.b[1])));
    return other && other.dx === L.dx && other.dy === L.dy ? [L.dx, L.dy] : null;
  }
  return null;
}
// Узлы, через которые дорога идёт прямо (внутри ног)
function straightNodes(legs) {
  const out = [];
  for (const L of legs) {
    const steps = Math.round(L.len / (L.dx ? BX : BY));
    for (let m = 1; m < steps; m++) out.push([L.a[0] + L.dx * m * BX, L.a[1] + L.dy * m * BY]);
  }
  return out;
}

function build(district, route) {
  const spec = { ...district, ...route };
  const rnd = mkRnd(spec.seed);
  const roads = [];
  spec.roads.forEach((rd, idx) => {
    const legs = legsOf(rd.nodes);
    let pts, sm, def = null;
    if (idx === 0) { pts = polyline(legs, false); sm = sample(pts); }
    else {
      const parent = roads[rd.parent === undefined ? 0 : rd.parent + 1];
      const n0 = rd.nodes[0], nk = rd.nodes.at(-1);
      const d0 = dirAt(parent.legs, n0), dk = dirAt(parent.legs, nk);
      if (!d0 || !dk) throw new Error(`${spec.name}: ветка ${idx - 1} должна отходить от прямого участка родителя и вливаться в прямой участок (${n0} / ${nk})`);
      const [x0, y0] = node(n0), [xk, yk] = node(nk);
      const full = [{ a: [x0 - d0[0] * 2 * R, y0 - d0[1] * 2 * R], b: [x0, y0], dx: d0[0], dy: d0[1] }, ...legs, { a: [xk, yk], b: [xk + dk[0] * 2 * R, yk + dk[1] * 2 * R], dx: dk[0], dy: dk[1] }];
      pts = polyline(full, true);
      const from = sAt(parent.sm, x0 - d0[0] * R, y0 - d0[1] * R) - LEAD, to = sAt(parent.sm, xk + dk[0] * R, yk + dk[1] * R) + LEAD;
      const pAt = s => at(parent.sm, s);
      sm = sample([pAt(from - LEAD), pAt(from), pAt(from + LEAD), ...pts, pAt(to - LEAD), pAt(to), pAt(to + LEAD)]);
      def = { from, to, parent: rd.parent };
    }
    const helpers = { sAt: (x, y) => sAt(sm, x, y), node, L: Math.round(sm.at(-1).s) };
    const cars = typeof rd.cars === 'function' ? rd.cars(helpers) : rd.cars;
    roads.push({ legs, pts, sm, def, straight: straightNodes(legs), offsets: rd.offsets ?? [], cars, oncoming: rd.oncoming ?? 0, L: helpers.L,
      parentIdx: idx ? (rd.parent === undefined ? 0 : rd.parent + 1) : -1, ends: idx ? [node(rd.nodes[0]), node(rd.nodes.at(-1))] : [] });
  });
  // Перекрёстки — на прямых узлах, кроме примыканий: где отходит или вливается ветка, светофора и поперечных нет
  // (боковая улица там — сама ветка; очередь поперечных стояла бы прямо на дуге поворота)
  roads.forEach((r, i) => {
    const junctions = new Set(roads.filter(o => o.parentIdx === i).flatMap(o => o.ends.map(p => p.join(','))));
    r.crossings = r.straight.filter(p => !junctions.has(p.join(','))).map(([x, y], k) => ({ s: sAt(r.sm, x, y), period: 12, offset: r.offsets[k] ?? 0, arrive: +(sAt(r.sm, x, y) / 300).toFixed(1) }));
  });

  // события маршрута на главной: at — координата сетки (дробная — между узлами), s по главной считается сам
  const main0 = roads[0], mainCars = [...(main0.cars ?? [])], blocks = [], narrows = [], rails = [], bands = [];
  const atS = at => sAt(main0.sm, at[0] * BX, at[1] * BY);
  for (const e of route.events ?? []) {
    const s = atS(e.at);
    switch (e.type) {
      case 'post': blocks.push({ s, police: e.lanes ?? [0, 2] }); break;                        // пост с просветом в средней
      case 'spikes': blocks.push({ s, police: e.lanes ?? [0], spikes: e.spikes ?? [2] }); break; // машина слева, ежи справа
      case 'works': blocks.push({ s, works: e.lanes ?? [1, 2], len: e.len ?? 400 }); break;      // ремонт: полосы закрыты на len
      case 'closure': blocks.push({ s, police: [0, 1, 2] }); break;                             // полное перекрытие — объезд по ветке
      case 'narrow': narrows.push({ from: s, to: atS(e.to), width: e.width ?? 110 }); break;
      case 'rails': {
        rails.push({ s, period: e.period ?? 14, speed: e.speed ?? 260, length: e.length ?? 400, offset: e.offset ?? 0 });
        const leg = main0.legs.find(L => L.dx ? Math.abs(e.at[1] * BY - L.a[1]) < 1 : Math.abs(e.at[0] * BX - L.a[0]) < 1);
        bands.push(leg && leg.dx ? { axis: 'x', c: e.at[0] * BX } : { axis: 'y', c: e.at[1] * BY }); // рельсы поперёк улицы — коридор через кварталы
        break;
      }
      case 'ramp': mainCars.push({ s, lane: e.lane ?? 1, speed: e.speed ?? 120, type: 'ramp' }); break;
      case 'parked': mainCars.push({ s, lane: e.lane ?? 2, speed: 0 }); break;
      default: throw new Error(`${spec.name}: неизвестное событие ${e.type}`);
    }
  }
  blocks.sort((a, b) => a.s - b.s); mainCars.sort((a, b) => a.s - b.s);

  // здания: все кварталы в диапазоне, отступ от осей улиц
  let props = [];
  for (let i = spec.blocks.i[0]; i <= spec.blocks.i[1]; i++) for (let j = spec.blocks.j[0]; j <= spec.blocks.j[1]; j++) {
    const x0 = i * BX + ROAD / 2 + MARGIN, x1 = (i + 1) * BX - ROAD / 2 - MARGIN;
    const y0 = j * BY + ROAD / 2 + MARGIN, y1 = (j + 1) * BY - ROAD / 2 - MARGIN;
    if (x1 - x0 < 120 || y1 - y0 < 120) continue;
    const split = rnd() < 0.5;
    if (!split) props.push({ type: 'building', x: x0, y: y0, w: x1 - x0, h: y1 - y0, tone: +rnd().toFixed(2) });
    else { const gap = 40, wA = Math.round((x1 - x0 - gap) * (0.35 + rnd() * 0.3)); props.push({ type: 'building', x: x0, y: y0, w: wA, h: y1 - y0, tone: +rnd().toFixed(2) }, { type: 'building', x: x0 + wA + gap, y: y0, w: x1 - x0 - wA - gap, h: y1 - y0, tone: +rnd().toFixed(2) }); }
  }

  // железнодорожный коридор режет здания
  const cut = (list, band) => list.flatMap(p => {
    const [p0, p1] = band.axis === 'y' ? [p.y, p.y + p.h] : [p.x, p.x + p.w], b0 = band.c - 40, b1 = band.c + 40;
    if (p1 <= b0 || p0 >= b1) return [p];
    return [[p0, Math.min(p1, b0)], [Math.max(p0, b1), p1]].filter(([a, b]) => b - a >= 80).map(([a, b]) => band.axis === 'y' ? { ...p, y: a, h: b - a } : { ...p, x: a, w: b - a });
  });
  for (const band of bands) props = cut(props, band);

  const main = roads[0];
  const strip = c => { const { arrive, ...r } = c; return r; };
  const branchJson = b => {
    const parts = [`"from": ${b.def.from}`, `"to": ${b.def.to}`];
    if (b.def.parent !== undefined) parts.push(`"parent": ${b.def.parent}`);
    parts.push(`"oncoming": ${b.oncoming}`);
    if (b.cars?.length) parts.push(`"cars": ${JSON.stringify(b.cars)}`);
    if (b.crossings.length) parts.push(`"crossings": ${JSON.stringify(b.crossings.map(strip))}`);
    parts.push(`"points": [${b.pts.map(p => `[${p[0]}, ${p[1]}]`).join(', ')}]`);
    return `    { ${parts.join(', ')} }`;
  };
  const json = `{
  "name": ${JSON.stringify(spec.name)},
  "points": [
${main.pts.map(p => `    [${p[0]}, ${p[1]}]`).join(',\n')}
  ],
  "width": ${ROAD},
  "traffic": ${spec.traffic},
  "seed": ${spec.seed},
  "car": "${spec.car}",
  "panic": ${spec.panic},
  "nav": true,
  "mix": ${spec.mix ?? 0.15},
  "oncoming": ${main.oncoming},
  "chaser": ${JSON.stringify(spec.chaser)},
  "cars": [
${mainCars.map(c => '    ' + JSON.stringify(c)).join(',\n')}
  ],${blocks.length ? `\n  "blocks": [\n${blocks.map(b => '    ' + JSON.stringify(b)).join(',\n')}\n  ],` : ''}${narrows.length ? `\n  "narrows": [\n${narrows.map(n => '    ' + JSON.stringify(n)).join(',\n')}\n  ],` : ''}${rails.length ? `\n  "rails": [\n${rails.map(r => '    ' + JSON.stringify(r)).join(',\n')}\n  ],` : ''}
  "crossings": [
${main.crossings.map(c => '    ' + JSON.stringify(strip(c))).join(',\n')}
  ],
  "branches": [
${roads.slice(1).map(branchJson).join(',\n')}
  ],
  "props": [
${props.map(p => '    ' + JSON.stringify(p)).join(',\n')}
  ]
}
`;
  fs.writeFileSync(`levels/${spec.file}.json`, json);
  const desc = roads.map((r, i) => `${i ? `ветка ${i - 1}${r.def.parent !== undefined ? ` (от ветки ${r.def.parent})` : ''} ${r.def.from}→${r.def.to}` : 'главная'}: длина ${r.L}, перекрёстки ${r.crossings.map(c => `s${c.s}@${c.arrive}с`).join(', ') || '—'}`);
  const ev = (route.events ?? []).map(e => `${e.type}@s${atS(e.at)}`).join(', ');
  console.log(`${spec.name}: точек ${main.pts.length}, зданий ${props.length}${ev ? `, события: ${ev}` : ''}\n   ${desc.join('\n   ')}`);
}

const DISTRICTS = [
  // «Район 1»: север 2 квартала, восток 2, север 2, восток 1 — гараж; квартальный объезд веткой через (1,−1)
  { seed: 4242, car: 'sedan', traffic: 0.3, panic: 0.3, chaser: { gap: 160, speed: 1 }, blocks: { i: [-1, 3], j: [-5, 0] },
    routes: [
      { file: 'district1', name: 'Район 1', roads: [
        { nodes: [[0, 0], [0, -2], [2, -2], [2, -4], [3, -4]], oncoming: 1, offsets: [7.5], // перекрёсток (2,−3): красный при прибытии, средняя полоса проходит
          cars: h => [{ s: 300, lane: 2, speed: 0 }, { s: 620, lane: 2, speed: 0 }, { s: h.sAt(...h.node([1, -2])) + 200, lane: 2, speed: 0 }] },
        { nodes: [[0, -1], [1, -1], [1, -2]], oncoming: 1 },
      ] },
    ] },
  // «Район 2»: гараж у (3,−4), три старта — три уровня в одном городе
  { seed: 777, car: 'sedan', traffic: 0.3, panic: 0.3, chaser: { gap: 160, speed: 1 }, blocks: { i: [-1, 3], j: [-5, 0] },
    routes: [
      // маршрут 1: старт (0,0), север 3, восток 3, север 1. Ветка А: направо у (0,−1), прямо через (1,−1), налево у (2,−1),
      // прямо через (2,−2), вливается в главную у (2,−3). Ветка Б от А: налево у (1,−1), направо у (1,−2), вливается в А у (2,−2)
      { file: 'district2', name: 'Район 2 · маршрут 1', traffic: 0.3,
        // вводный: пост с просветом после первого перекрёстка, ремонт правой полосы на восточном отрезке
        events: [{ type: 'post', at: [0, -2.5] }, { type: 'works', at: [1.6, -3], lanes: [2], len: 400 }],
        roads: [
        { nodes: [[0, 0], [0, -3], [3, -3], [3, -4]], oncoming: 1, offsets: [3.0, 9.5], // (0,−2) красный, (1,−3) зелёный при прибытии (routebot SWEEP)
          cars: h => [{ s: 340, lane: 2, speed: 0 }, { s: h.sAt(...h.node([1, -3])) + 220, lane: 2, speed: 0 }] },
        { nodes: [[0, -1], [1, -1], [2, -1], [2, -2], [2, -3]], oncoming: 1 }, // её прямые узлы — примыкания ветки Б, перекрёстков нет
        { nodes: [[1, -1], [1, -2], [2, -2]], parent: 0, oncoming: 1 },
      ] },
      // маршрут 2: старт (3,0), север 1, запад 2, север 2, восток 2, север 1. Ветка: направо у (1,−2), налево у (2,−2), вливается у (2,−3)
      { file: 'district2b', name: 'Район 2 · маршрут 2', traffic: 0.35,
        // ремонт правой полосы на западном отрезке, полное перекрытие северного отрезка за (1,−2) — объезд по ветке
        events: [{ type: 'works', at: [1.85, -1], lanes: [2], len: 220 }, { type: 'closure', at: [1, -2.55] }],
        roads: [
        { nodes: [[3, 0], [3, -1], [1, -1], [1, -3], [3, -3], [3, -4]], oncoming: 1, offsets: [5.0], // (2,−1) зелёный при прибытии
          cars: h => [{ s: 300, lane: 2, speed: 0 }, { s: h.sAt(...h.node([1, -1])) + 260, lane: 2, speed: 0 }] },
        { nodes: [[1, -2], [2, -2], [2, -3]], oncoming: 1 },
      ] },
      // маршрут 3: старт (1,0), север 2, восток 2, север 2. Ветка: направо у (1,−1), налево у (2,−1), вливается у (2,−2)
      { file: 'district2c', name: 'Район 2 · маршрут 3', traffic: 0.4,
        // переезд на первом отрезке (поезд проходит сразу за игроком — коп под поездом), сужение и пост на последнем
        events: [{ type: 'rails', at: [1, -0.6], period: 14, length: 500, offset: 2.9 }, { type: 'narrow', at: [3, -2.25], to: [3, -2.65], width: 110 },
          { type: 'post', at: [3, -3.5] }],
        roads: [
        { nodes: [[1, 0], [1, -2], [3, -2], [3, -4]], oncoming: 1, offsets: [7.5], // (3,−3) красный при прибытии, как в «Районе 1»
          cars: h => [{ s: 320, lane: 2, speed: 0 }, { s: h.sAt(...h.node([2, -2])) + 240, lane: 2, speed: 0 }] },
        { nodes: [[1, -1], [2, -1], [2, -2]], oncoming: 1 },
      ] },
    ] },
  // «Графика»: витрина для теста визуала — за один проезд видно всё, что рисуется.
  // Север 4 квартала (перекрёстки (0,−1), (0,−3), между ними переезд, рампа с ежами за третьим перекрёстком),
  // восток 2, север 1 — гараж с сужением перед ним. Ветка: направо у (0,−2), прямо через перекрёсток (1,−3), вливается у (1,−4)
  { seed: 999, car: 'sedan', traffic: 0.35, panic: 0.3, chaser: { gap: 160, speed: 1 }, blocks: { i: [-1, 2], j: [-6, 0] },
    routes: [
      { file: 'gfx', name: 'Графика', roads: [
        { nodes: [[0, 0], [0, -4], [2, -4], [2, -5]], oncoming: 1, offsets: [3.0, 6.5],
          cars: h => [{ s: 260, lane: 2, speed: 0 }, { s: 420, lane: 2, speed: 0 }] },
        { nodes: [[0, -2], [1, -2], [1, -4]], oncoming: 1, offsets: [8.0] }, // на ветку сворачивают на 3.5 с, к её перекрёстку подъезжают на 7 с — зелёный
      ],
        events: [{ type: 'rails', at: [0, -1.5], period: 14, length: 500, offset: 1.4 }, { type: 'ramp', at: [0, -3.3], lane: 1, speed: 120 },
          { type: 'spikes', at: [0, -3.6] }, { type: 'narrow', at: [2, -4.45], to: [2, -4.75], width: 110 }] },
    ] },
];
for (const d of DISTRICTS) for (const r of d.routes) if (!process.argv[2] || r.file === process.argv[2]) build(d, r);
