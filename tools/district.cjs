// Генератор районов: сетка кварталов; дороги — списки узлов сетки (главная и ветки с родителем), между узлами
// прямые, на углах дуги радиуса R; перекрёстки там, где дорога проходит узел прямо; здания во всех кварталах.
// Ветка отходит от прямого участка родителя за R до узла дугой и вливается в прямой участок дугой через R после узла.
// Район = сетка, здания, машина, гараж; маршрут = свои дороги и старт при общем районе — один район даёт несколько уровней.
// Пишет levels/<file>.json для каждого маршрута из DISTRICTS. Фазы светофоров затем проверяются routebot.mjs (SWEEP).
const fs = require('fs');
process.chdir(require('path').join(__dirname, '..')); // корень проекта

// Параметры сетки — по умолчанию как у «Района 1»; район может задать свои (grid: { bx, by, road, r }) — пролог шире и просторнее
let BX = 620, BY = 520;        // размер квартала между осями улиц
let ROAD = 180, R = 220;       // R: внутренняя полоса угла = R − 60 ≥ минимального радиуса седана (~150 после настройки 2026-09-08)
const MARGIN = 26, LEAD = 60;  // LEAD = BRANCH.lead
let SPEED = 300;               // скорость машины уровня — для прикидок времени прибытия
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
  ({ bx: BX = 620, by: BY = 520, road: ROAD = 180, r: R = 220 } = spec.grid ?? {});
  SPEED = spec.speed ?? 300;
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
    roads.push({ legs, pts, sm, def, straight: straightNodes(legs), offsets: rd.offsets ?? [], reds: rd.reds, noCross: rd.crossings === false, cars, oncoming: rd.oncoming ?? 0, L: helpers.L,
      parentIdx: idx ? (rd.parent === undefined ? 0 : rd.parent + 1) : -1, ends: idx ? [node(rd.nodes[0]), node(rd.nodes.at(-1))] : [] });
  });
  // Перекрёстки — на прямых узлах, кроме примыканий: где отходит или вливается ветка, светофора и поперечных нет
  // (боковая улица там — сама ветка; очередь поперечных стояла бы прямо на дуге поворота)
  roads.forEach((r, i) => {
    const junctions = new Set(roads.filter(o => o.parentIdx === i).flatMap(o => o.ends.map(p => p.join(','))));
    // offsets — 'green' для всех или массив по перекрёсткам: число, 'green' (красный через 2 с после прибытия, очередь
    // видна, но не мешает) или 'red' (красный за 0.8 с до прибытия — поперечные тронулись, средняя полоса проходит между ними)
    // reds: [[x, y]…] — красный при прибытии только на этих узлах, остальные зелёные (не нужно считать номера светофоров)
    const mode = (k, x, y) => r.reds ? (r.reds.some(p => p[0] * BX === x && p[1] * BY === y) ? 'red' : 'green') : (r.offsets === 'green' ? 'green' : r.offsets[k] ?? 0);
    // 'red' — сценарный: красный включается через 1.05 с после того, как игрок за before px до перекрёстка, так что при
    // прибытии красный горит 2.0 с и средняя полоса проходит между тронувшимися поперечными (по развёртке crosslanes)
    r.crossings = r.noCross ? [] : r.straight.filter(p => !junctions.has(p.join(','))).map(([x, y], k) => {
      const s = sAt(r.sm, x, y), arrive = s / SPEED, m = mode(k, x, y);
      if (m === 'red' && s < 3.05 * SPEED + 60) console.log(`   ! ${spec.name}: перекрёсток s${s} ближе ${Math.round(3.05 * SPEED)} px к старту — сценарный красный не успеет, оставлен зелёный`);
      if (m === 'red' && s >= 3.05 * SPEED + 60) return { s, period: 12, offset: 0, before: Math.round(3.05 * SPEED), arrive: +arrive.toFixed(1) };
      if (m === 'red') return { s, period: 12, offset: +(((arrive + 2) % 12).toFixed(1)), arrive: +arrive.toFixed(1) };
      const offset = m === 'green' ? +(((arrive + 2) % 12).toFixed(1)) : m;
      return { s, period: 12, offset, arrive: +arrive.toFixed(1) };
    });
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
        // offset 'behind': сценарный поезд — голова у края дороги через 0.5 с после того, как игрок пересёк рельсы
        // (снимает копа на дистанции ~200); 'ahead': по циклу, хвост сходит с дороги за 1.5 с до расчётного прибытия
        const speed = e.speed ?? 260, length = e.length ?? 400, period = e.period ?? 14;
        if (e.offset === 'behind') { rails.push({ s, period, speed, length, offset: 0, after: e.after ?? 0.5 }); }
        else if (e.offset === 'ahead') {
          // сценарный «перед носом» (2026-09-10, вместо расчёта по циклу): старт за before px до рельсов, хвост сходит с дороги
          // за 0.6 с до прибытия; при старте голова должна быть ещё далеко от дороги (иначе состав возникает на переезде)
          // длинному составу нужен ранний старт: голова при старте за 200 px до дороги — clear ≥ (length + 330)/speed («Товарняк»)
          const lead = Math.max(4.6, (length + 400) / speed + 0.6);
          const before = Math.min(Math.round(lead * SPEED), s - 60), clear = +(before / SPEED - 0.6).toFixed(2), h0 = length + 130 - speed * clear;
          if (h0 > -200) throw new Error(`${spec.name}: rails 'ahead' @s${s} слишком близко к старту (голова при старте ${Math.round(h0)})`);
          rails.push({ s, period, speed, length, offset: 0, before, clear });
        } else rails.push({ s, period, speed, length, offset: e.offset ?? 0 });
        const leg = main0.legs.find(L => L.dx ? Math.abs(e.at[1] * BY - L.a[1]) < 1 : Math.abs(e.at[0] * BX - L.a[0]) < 1);
        bands.push(leg && leg.dx ? { axis: 'x', c: e.at[0] * BX } : { axis: 'y', c: e.at[1] * BY }); // рельсы поперёк улицы — коридор через кварталы
        break;
      }
      case 'ramp': mainCars.push({ s, lane: e.lane ?? 1, speed: e.speed ?? 120, type: 'ramp' }); break;
      case 'parked': mainCars.push({ s, lane: e.lane ?? 2, speed: 0 }); break;
      case 'slow': mainCars.push({ s, lane: e.lane ?? 1, speed: e.speed ?? 60, ...(e.model ? { model: e.model } : {}) }); break; // медленная машина (model — длинная: «Колонна»)
      default: throw new Error(`${spec.name}: неизвестное событие ${e.type}`);
    }
  }
  blocks.sort((a, b) => a.s - b.s); mainCars.sort((a, b) => a.s - b.s);
  // сценарий (docs/progression.md): карточки, ловушка, контрольные точки — по координатам сетки; коп по событию
  const cards = (route.cards ?? []).map(c => ({ s: atS(c.at), text: c.text }));
  const trap = route.trap ? { s: atS(route.trap.at), text: route.trap.text } : null;
  const checkpoints = (route.checkpoints ?? []).map(atS);
  // chaserAt — координата или список координат: повторные погони, новый коп в каждой точке, если прежний выбыл
  const chaser = spec.chaser ? { ...spec.chaser, ...(route.chaserAt ? { at: Array.isArray(route.chaserAt[0]) ? route.chaserAt.map(atS) : atS(route.chaserAt) } : {}) } : null;
  if (!chaser && route.chaserAt) throw new Error(`${spec.name}: chaserAt без chaser`);

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
  "mix": ${spec.mix ?? 0.15},${route.pace ? `\n  "pace": ${JSON.stringify(route.pace)},` : ''}${route.grip ? `\n  "grip": ${route.grip},` : ''}${spec.theme ? `\n  "theme": ${JSON.stringify(spec.theme)},` : ''}
  "oncoming": ${main.oncoming},
  "chaser": ${JSON.stringify(chaser)},${route.intro ? `\n  "intro": ${JSON.stringify(route.intro)},` : ''}${cards.length ? `\n  "cards": [\n${cards.map(c => '    ' + JSON.stringify(c)).join(',\n')}\n  ],` : ''}${trap ? `\n  "trap": ${JSON.stringify(trap)},` : ''}${checkpoints.length ? `\n  "checkpoints": ${JSON.stringify(checkpoints)},` : ''}
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
  if (route.cards?.length) console.log(`   карточки: ${cards.map(c => `«${c.text}»@s${c.s}`).join(', ')}${trap ? `; ловушка @s${trap.s}` : ''}${checkpoints.length ? `; контрольные ${checkpoints.join(', ')}` : ''}`);
  console.log(`${spec.name}: точек ${main.pts.length}, зданий ${props.length}${ev ? `, события: ${ev}` : ''}\n   ${desc.join('\n   ')}`);
}

const DISTRICTS = [
  // «Учебный район» (docs/progression.md): десять коротких уровней по одной механике, один город на всех.
  // Минивэн на 1–5, седан на 6–10. Ветки не используются — уровни линейные (объезды в пост-MVP).
  { seed: 2026, car: 'minivan', speed: 240, traffic: 0, panic: 0, mix: 0, chaser: null, theme: 'pixel', blocks: { i: [-1, 4], j: [-14, 0] },
    routes: [
      { file: 'tut01', name: '1 · Руль', intro: 'Минивэн. Машины разные: эта тяжелее, и в повороте её несёт шире. Камера не поворачивает — жми заранее и смотри, как машина ведёт себя в дуге.',
        cards: [{ at: [0, -2.3], text: 'Поворот: жми заранее — машину несёт' }, { at: [2, -1.6], text: 'Теперь налево' }],
        roads: [{ nodes: [[0, 0], [0, -3], [2, -3], [2, -1], [4, -1], [4, -4]], oncoming: 0, crossings: false }] },
      { file: 'tut02', name: '2 · Трафик', traffic: 0.5, intro: 'Впереди машины. Обгоняй — меняй полосу заранее.',
        cards: [{ at: [0, -0.8], text: 'Проезд впритирку — NEAR MISS, +100' }],
        roads: [{ nodes: [[0, 0], [0, -4], [1, -4], [1, -8]], oncoming: 0, crossings: false }] },
      { file: 'tut03', name: '3 · Перекрёсток', traffic: 0.1, intro: 'Светофоры. На зелёный — езжай. На красный поперечные идут друг за другом — проскочи между ними. Кирпич на поперечной улице: туда нельзя.',
        cards: [{ at: [0, -0.5], text: 'Кирпич — на поперечную не сворачивать' }, { at: [0, -2.5], text: 'Впереди красный: смотри на поперечные' }],
        roads: [{ nodes: [[0, 0], [0, -4], [2, -4], [2, -7]], oncoming: 0, offsets: ['green', 'green', 'red', 'green', 'red', 'green'] }] },
      { file: 'tut04', name: '4 · Пост', traffic: 0.15, intro: 'Посты полиции перекрывают полосы. Ищи просвет и перестраивайся заранее.',
        cards: [{ at: [0, -1.0], text: 'Пост: просвет посередине' }, { at: [0, -2.3], text: 'Просвет слева' }, { at: [1, -5.0], text: 'Просвет справа' }, { at: [1, -6.5], text: 'Ежи справа — только середина' }],
        events: [{ type: 'post', at: [0, -1.5] }, { type: 'post', at: [0, -2.8], lanes: [1, 2] }, { type: 'post', at: [1, -5.9], lanes: [0, 1] }, { type: 'spikes', at: [1, -7.2] }], // после дуги угла 600 px на перестроение
        roads: [{ nodes: [[0, 0], [0, -4], [1, -4], [1, -8]], oncoming: 0, crossings: false }] },
      { file: 'tut05', name: '5 · Ремонт', traffic: 0.2, intro: 'Ремонт закрывает полосы. Сужение — держись середины.',
        cards: [{ at: [0, -0.7], text: 'Ремонт справа: уходи в левую полосу' }, { at: [1, -4.8], text: 'Сужение впереди' }],
        events: [{ type: 'works', at: [0, -1.2], lanes: [1, 2], len: 400 }, { type: 'works', at: [0, -2.8], lanes: [0], len: 300 },
          { type: 'narrow', at: [1, -5.2], to: [1, -5.8], width: 110 }, { type: 'works', at: [1, -6.8], lanes: [2], len: 300 }],
        roads: [{ nodes: [[0, 0], [0, -4], [1, -4], [1, -8]], oncoming: 0, crossings: false }] },
      // переезд: первый поезд «перед носом» — сценарный по дистанции (rails.before), второй и третий сразу за спиной (rails.after)
      { file: 'tut06', name: '6 · Переезд', car: 'sedan', speed: 300, traffic: 0.15, intro: 'Переезд. Поезд не ждёт — и не догонит. Держи темп.',
        cards: [{ at: [0, -1.6], text: 'Переезд: поезд пройдёт перед тобой' }, { at: [0, -3.5], text: 'Этот пройдёт сразу за тобой' }],
        events: [{ type: 'rails', at: [0, -2.5], offset: 'ahead', length: 500 }, { type: 'rails', at: [0, -4.2], offset: 'behind', length: 500 }, { type: 'rails', at: [1, -7], offset: 'behind', length: 600 }],
        roads: [{ nodes: [[0, 0], [0, -5], [1, -5], [1, -9]], oncoming: 0, crossings: false }] },
      // погоня: коп чуть быстрее на прямой (1.02: +6 px/с) и отстаёт в поворотах (~25 px за дугу) — за уровень подтягивается со 180 до ~120 px;
      // 1.05 догонял бота на 15 с, 1.03 доводил хвост до 60 px — поезд в конце уже не успевал его снять
      { file: 'tut07', name: '7 · Погоня', car: 'sedan', speed: 300, traffic: 0.15, chaser: { gap: 180, speed: 1.02 }, chaserAt: [0, -0.8],
        intro: 'Полиция на хвосте. На прямой коп быстрее, в поворотах отстаёт — не сбавляй и не виляй.',
        cards: [{ at: [0, -0.9], text: 'Погоня! Держи дистанцию в поворотах' }, { at: [2, -6.5], text: 'Переезд впереди: поезд разберётся с копом' }],
        events: [{ type: 'rails', at: [2, -7], offset: 'behind', after: 0.2, length: 500 }], // коп подтянулся до ~0.4 с — поезд идёт раньше, чем в прологе (0.5)
        roads: [{ nodes: [[0, 0], [0, -2], [2, -2], [2, -4], [0, -4], [0, -6], [2, -6], [2, -8]], oncoming: 0, crossings: false }] },
      // рампы: первые две в двух кварталах друг от друга; автовоз встаёт за RAMP.stopGap до преграды, ремонт за рампой короткий (100)
      { file: 'tut08', name: '8 · Рампа', car: 'sedan', speed: 300, traffic: 0.1, intro: 'Автовоз с рампой. Заезжай сзади ровно и быстрее него — полетишь.',
        cards: [{ at: [0, -0.5], text: 'Рампа: заезжай сзади по центру' }, { at: [0, -3.0], text: 'Перелети ремонт' }, { at: [1, -7.0], text: 'Перелети пост' }],
        events: [{ type: 'ramp', at: [0, -1.0], lane: 1, speed: 100 }, { type: 'ramp', at: [0, -3.5], lane: 1, speed: 100 }, { type: 'works', at: [0, -3.85], lanes: [0, 1, 2], len: 100 },
          { type: 'ramp', at: [1, -7.5], lane: 1, speed: 100 }, { type: 'closure', at: [1, -7.85] }],
        roads: [{ nodes: [[0, 0], [0, -5], [1, -5], [1, -10]], oncoming: 0, crossings: false }] },
      // встречка: после карточки про панику — медленные и стоящие машины, есть кого обойти впритирку
      { file: 'tut09', name: '9 · Встречка', car: 'sedan', speed: 300, traffic: 0.4, panic: 0.5, mix: 0.1, intro: 'Левая полоса — встречная. Проезд впритирку пугает водителей: паника — очки.',
        cards: [{ at: [0, -0.7], text: 'Двойная жёлтая: слева встречка' }, { at: [0, -2.5], text: 'Прижмись к машине — ПАНИКА +300' }],
        events: [{ type: 'slow', at: [0, -2.8], lane: 2, speed: 90 }, { type: 'slow', at: [1, -4.8], lane: 1, speed: 90 }, { type: 'parked', at: [1, -6.3], lane: 2 }],
        roads: [{ nodes: [[0, 0], [0, -4], [1, -4], [1, -8]], oncoming: 1, crossings: false }] },
      // экзамен: длиннее (7 ног), два копа — второй появляется после того, как первый попал под поезд; события между перекрёстками
      { file: 'tut10', name: '10 · Экзамен', car: 'sedan', speed: 300, traffic: 0.35, mix: 0.15, panic: 0.3, chaser: { gap: 190, speed: 1.04 }, chaserAt: [[0, -0.5], [2, -9.6]],
        intro: 'Экзамен. Всё, что умеешь: посты, ремонт, поезда, рампа, встречка. Копов будет двое. Гараж в конце.',
        cards: [{ at: [2, -9.5], text: 'Второй коп на хвосте' }],
        events: [{ type: 'post', at: [0, -1.5] }, { type: 'works', at: [1.5, -3], lanes: [2], len: 300 }, { type: 'rails', at: [2, -4.5], offset: 'behind', length: 500 },
          { type: 'ramp', at: [4, -7.5], lane: 1, speed: 100 }, { type: 'closure', at: [4, -7.8] }, { type: 'narrow', at: [4, -8.3], to: [4, -8.7], width: 110 },
          { type: 'spikes', at: [2, -10.5] }, { type: 'post', at: [2, -11.5], lanes: [0, 1] }, { type: 'rails', at: [2, -12.5], offset: 'behind', length: 500 }],
        roads: [{ nodes: [[0, 0], [0, -3], [2, -3], [2, -6], [4, -6], [4, -9], [2, -9], [2, -13]], oncoming: 1,
          // на последней ноге красный только у (2,−10): дальше пост с просветом справа, а на красный проходит лишь средняя
          offsets: ['green', 'red', 'green', 'red', 'green', 'red', 'green', 'green', 'red', 'red', 'green', 'green'] }] },
    ] },
  // «Пролог» (docs/progression.md): широкие улицы, спорткар, линейный длинный маршрут, финал — ловушка перед гаражом
  { seed: 31337, car: 'prologue', speed: 360, traffic: 0.1, panic: 0.4, mix: 0.1, chaser: { gap: 200, speed: 1 },
    grid: { bx: 760, by: 640, road: 220, r: 320 }, blocks: { i: [-1, 8], j: [-13, 1] },
    routes: [
      { file: 'prologue', name: 'Пролог',
        intro: 'Ночь. Чужой спорткар. Две кнопки: влево и вправо. Тормозов нет — машина едет сама. Довези её в гараж — и город твой.',
        chaserAt: [0, -2.4],
        cards: [{ at: [0, -2.5], text: 'Погоня!' }, { at: [0, -4.4], text: 'Переезд' }, { at: [2, -5.6], text: 'Автовоз впереди — прыгай!' },
          { at: [4, -3.5], text: 'Переулок' }, { at: [7, -7.3], text: 'Гараж уже виден' }],
        checkpoints: [[0, -5.4], [2, -4.3], [4, -1.6], [7, -7.6]],
        trap: { at: [7, -9.35], text: 'Ловушка. Тебя взяли.\nСлава утеряна — начинаем с нуля.' },
        events: [
          { type: 'parked', at: [0, -0.4] }, { type: 'parked', at: [0, -0.8] },
          { type: 'rails', at: [0, -4.6], period: 14, length: 500, offset: 'behind' },
          { type: 'works', at: [1.3, -6], lanes: [2], len: 300 },
          { type: 'ramp', at: [2, -5.05], lane: 1, speed: 120 }, { type: 'closure', at: [2, -4.7] }, // отрезок идёт на юг: −5.05 раньше −4.7; автовоз встаёт за RAMP.stopGap до перекрытия, ≥300 px после дуги
          { type: 'parked', at: [3.5, -3], lane: 2 },
          { type: 'narrow', at: [4, -2.3], to: [4, -1.7], width: 130 },
          { type: 'post', at: [5.0, -6] }, // середина прямой между дугами углов
          { type: 'closure', at: [7, -9.6] },
        ],
        roads: [
          // север 6, восток 2, юг 2 (переезд был на севере), восток 2, север 2, ... — змейка по сетке, ~20 000 px
          { nodes: [[0, 0], [0, -6], [2, -6], [2, -3], [4, -3], [4, -1], [6, -1], [6, -6], [4, -6], [4, -8], [7, -8], [7, -10]], oncoming: 0, offsets: 'green',
            cars: () => [] },
        ] },
      // Финал (docs/career.md): тот же красный спорткар на полной скорости, тот же гараж — с другого конца района, 22 000 px, без контрольных точек
      { file: 'final', name: 'Финал', car: 'finale', speed: 420, traffic: 0.2, mix: 0.1, panic: 0.4, chaser: { gap: 260, speed: 1.02 }, chaserAt: [[7, -1.5], [3, -2.0], [3, -10.5]], // gap 260: к первому переезду коп подтягивается до ~0.48 с и попадает под поезд (after 0.3)
        intro: 'Тот самый спорткар — теперь твой, на полной скорости. Тот самый гараж, в который тогда не доехал. Доедь.',
        cards: [{ at: [7, -1.4], text: 'Он вернулся. И полиция тоже' }, { at: [7, -11.6], text: 'Гараж. В этот раз — доедем' }],
        events: [
          { type: 'parked', at: [7, -0.4] }, { type: 'parked', at: [7, -0.8] },
          { type: 'post', at: [7, -2.6] },
          { type: 'rails', at: [6.4, -4], offset: 'behind', after: 0.3, length: 600 },
          { type: 'works', at: [5, -2.4], lanes: [2], len: 300 },
          { type: 'spikes', at: [3, -2.5] },
          { type: 'ramp', at: [3, -3.35], lane: 1, speed: 120 }, { type: 'closure', at: [3, -3.65] }, // между перекрёстками (3,−3) и (3,−4): посадка на зелёный узел
          { type: 'rails', at: [3, -4.5], offset: 'behind', after: 0.3, length: 600 },
          { type: 'narrow', at: [1, -7.6], to: [1, -8.1], width: 140 },
          { type: 'post', at: [3, -10.4], lanes: [1, 2] },
          { type: 'rails', at: [4.6, -12], offset: 'behind', after: 0.3, length: 600 },
          { type: 'post', at: [7, -10.8], lanes: [0, 2] }, // отрезок на юг: −10.8 в 450 px после дуги угла (7,−12) и в 500 px до гаража
        ],
        roads: [
          // север 4, запад 2, юг 3, запад 2, север 5, запад 2, север 3, восток 2, север 3, восток 4, юг 2 — к гаражу (7,−10) с севера
          { nodes: [[7, 0], [7, -4], [5, -4], [5, -1], [3, -1], [3, -6], [1, -6], [1, -9], [3, -9], [3, -12], [7, -12], [7, -10]], oncoming: 0, offsets: 'green', cars: () => [] },
        ] },
    ] },
  // ---------- Карьера (docs/career.md): районы по нарастающей, машина на район, все уровни линейные ----------
  // «Окраина»: минивэн, посты и ремонт, светофоры все зелёные — игрок учится читать дорогу впереди
  { seed: 4101, car: 'minivan', speed: 240, traffic: 0.2, panic: 0, mix: 0, chaser: null, theme: 'pixel', blocks: { i: [-1, 5], j: [-10, 0] },
    routes: [
      { file: 'okr1', name: 'Окраина · 1', intro: 'Слава на нуле, из машин — чужой минивэн. Заказы только на окраине. Минивэн тяжёлый, несёт широко: посты и ремонт читай заранее.',
        events: [{ type: 'post', at: [0, -2.5] }, { type: 'works', at: [2, -5.6], lanes: [2], len: 300 }, { type: 'post', at: [4, -8.2], lanes: [0, 1] }],
        roads: [{ nodes: [[0, 0], [0, -4], [2, -4], [2, -7], [4, -7], [4, -9]], oncoming: 0, offsets: 'green' }] },
      { file: 'okr2', name: 'Окраина · 2', traffic: 0.25, intro: 'Окраина · 2. Ежи, сужение, просветы у постов с краю.',
        events: [{ type: 'works', at: [3, -1.4], lanes: [0, 1], len: 300 }, { type: 'post', at: [1.7, -3] }, { type: 'spikes', at: [1, -4.6] },
          { type: 'narrow', at: [1, -5.0], to: [1, -5.4], width: 130 }, { type: 'works', at: [2.2, -6], lanes: [2], len: 200 }, { type: 'post', at: [3, -7.6], lanes: [1, 2] }],
        roads: [{ nodes: [[3, 0], [3, -3], [1, -3], [1, -6], [3, -6], [3, -9]], oncoming: 0, offsets: 'green' }] },
      // концептуальные (docs/career.md, §4): «Стройка» — ремонт на каждом квартале, свободная полоса каждый раз другая
      { file: 'okr_works', name: 'Окраина · Стройка', traffic: 0.15, intro: 'Стройка. Ремонт на каждом квартале, свободная полоса каждый раз другая. Читай на два квартала вперёд.',
        // свободная полоса каждый раз соседняя (0→1→2→1→0→1), между ремонтами 530 px: перестроение минивэна ~1.5 с = 360 px
        events: [{ type: 'works', at: [2, -1.3], lanes: [1, 2], len: 200 }, { type: 'works', at: [2, -2.7], lanes: [0, 2], len: 200 }, { type: 'works', at: [2, -4.1], lanes: [0, 1], len: 200 },
          { type: 'works', at: [2, -5.5], lanes: [0, 2], len: 200 }, { type: 'works', at: [2, -6.9], lanes: [1, 2], len: 200 }, { type: 'works', at: [2, -8.3], lanes: [0, 2], len: 200 }],
        roads: [{ nodes: [[2, 0], [2, -9]], oncoming: 0, offsets: 'green' }] },
      // «Колонна» — грузовики парами занимают две полосы, свободная каждый раз другая; дальние пары медленнее, чтобы догнать до гаража
      { file: 'okr_convoy', name: 'Окраина · Колонна', traffic: 0, intro: 'Колонна. Грузовики идут парами и занимают две полосы. Свободная — каждый раз другая, ищи её заранее.',
        // свободная полоса: 0 → 1 → 2 → 1 (соседняя каждый раз); пары идут на 60, игрок догоняет их у s≈1100, 2100, 3050; последняя стоит.
        // Случайного трафика нет: медленная машина в свободной полосе — ловушка без выхода на 240 без тормозов
        events: [{ type: 'slow', at: [4, -1.6], lane: 1, speed: 60, model: 'truck' }, { type: 'slow', at: [4, -1.6], lane: 2, speed: 60, model: 'truck' },
          { type: 'slow', at: [4, -3.0], lane: 0, speed: 60, model: 'bus' }, { type: 'slow', at: [4, -3.0], lane: 2, speed: 60, model: 'bus' },
          { type: 'slow', at: [4, -4.4], lane: 0, speed: 60, model: 'truck' }, { type: 'slow', at: [4, -4.4], lane: 1, speed: 60, model: 'truck' },
          { type: 'slow', at: [2, -6.3], lane: 0, speed: 0, model: 'truck' }, { type: 'slow', at: [2, -6.3], lane: 2, speed: 0, model: 'truck' }],
        roads: [{ nodes: [[4, 0], [4, -5], [2, -5], [2, -9]], oncoming: 0, offsets: 'green' }] },
      { file: 'okr3', name: 'Окраина · 3', traffic: 0.3, mix: 0.1, intro: 'Окраина · 3. Длинный маршрут, два красных, всё вместе.',
        events: [{ type: 'post', at: [1, -1.3] }, { type: 'works', at: [2.4, -2], lanes: [1, 2], len: 300 }, { type: 'spikes', at: [4, -3.5] },
          { type: 'post', at: [2.5, -5], lanes: [0, 2] }, { type: 'narrow', at: [0, -6.35], to: [0, -6.65], width: 130 }, { type: 'post', at: [0, -7.6], lanes: [1, 2] }],
        roads: [{ nodes: [[1, 0], [1, -2], [4, -2], [4, -5], [0, -5], [0, -8]], oncoming: 0, reds: [[3, -5], [0, -6]] }] },
    ] },
  // «Промзона»: масл-кар, широкие кварталы под его радиус, рельсы и автовозы; коп со второго маршрута
  { seed: 5202, car: 'muscle', speed: 330, traffic: 0.25, panic: 0.2, mix: 0.3, chaser: { gap: 200, speed: 1 }, theme: 'pixeldusk', grid: { bx: 700, by: 600, road: 200, r: 260 }, blocks: { i: [-1, 6], j: [-11, 0] },
    routes: [
      { file: 'ind1', name: 'Промзона · 1', chaser: null, intro: 'Масл-кар из порта — плата за центр. Быстрый на прямой, в заносе широкий. Рельсы режут район, автовозы ходят колоннами.',
        events: [{ type: 'rails', at: [0, -2.5], offset: 'behind', length: 600 }, { type: 'works', at: [0, -3.3], lanes: [2], len: 200 },
          { type: 'ramp', at: [2, -6.3], lane: 1, speed: 110 }, { type: 'post', at: [2, -6.6] }, { type: 'narrow', at: [3.4, -9], to: [3.7, -9], width: 140 }],
        roads: [{ nodes: [[0, 0], [0, -5], [2, -5], [2, -9], [5, -9]], oncoming: 0, offsets: 'green' }] },
      // «Серпантин» — только геометрия: S-повороты через квартал, без трафика — знакомство с масл-каром в чистом виде
      { file: 'ind_serp', name: 'Промзона · Серпантин', traffic: 0, chaser: null, intro: 'Серпантин. Только руль и масл-кар. Держи кнопку коротко — длинное удержание срывает в занос.',
        roads: [{ nodes: [[0, 0], [0, -2], [1, -2], [1, -4], [0, -4], [0, -6], [1, -6], [1, -8], [0, -8], [0, -10]], oncoming: 0, crossings: false }] },
      // «Товарняк» — два длинных состава: первый проходит перед носом (сценарный по дистанции), второй сразу за спиной и снимает копа
      { file: 'ind_train', name: 'Промзона · Товарняк', traffic: 0.2, chaserAt: [3, -0.5], intro: 'Товарняк. Составы длинные. Первый пройдёт перед носом, второй — сразу за спиной. Не сбавляй.',
        events: [{ type: 'post', at: [3, -2.2] }, { type: 'rails', at: [5, -6], offset: 'ahead', length: 1200 }, { type: 'rails', at: [5, -8], offset: 'behind', length: 1200 }],
        roads: [{ nodes: [[3, 0], [3, -4], [5, -4], [5, -9]], oncoming: 0, crossings: false }] },
      // «Автовозы» — четыре рампы подряд, за каждой преграда: уровень-трюк
      { file: 'ind_ramps', name: 'Промзона · Автовозы', traffic: 0.1, chaser: null, intro: 'Автовозы. Четыре рампы подряд, за каждой преграда. Заезжай сзади ровно — и лети.',
        events: [{ type: 'ramp', at: [1, -1.3], lane: 1, speed: 110 }, { type: 'post', at: [1, -1.6] },
          { type: 'ramp', at: [1, -2.9], lane: 1, speed: 110 }, { type: 'works', at: [1, -3.25], lanes: [0, 1, 2], len: 100 },
          { type: 'ramp', at: [1, -4.5], lane: 1, speed: 110 }, { type: 'closure', at: [1, -4.8] },
          { type: 'ramp', at: [3, -7.5], lane: 1, speed: 110 }, { type: 'closure', at: [3, -7.8] }, { type: 'narrow', at: [3, -8.8], to: [3, -9.2], width: 140 }],
        roads: [{ nodes: [[1, 0], [1, -6], [3, -6], [3, -10]], oncoming: 0, crossings: false }] },
      { file: 'ind2', name: 'Промзона · 2', traffic: 0.25, chaserAt: [3, -3.3], intro: 'Промзона · 2. Коп появится в середине. Поезд в спину его снимет — держи темп после переезда.',
        events: [{ type: 'post', at: [3, -1.5] }, { type: 'works', at: [1.75, -3], lanes: [0, 1], len: 200 }, { type: 'spikes', at: [1, -4.3] }, // ежи ≥400 px после дуги: ремонт выгоняет в крайнюю, обратно после угла
          { type: 'rails', at: [1, -4.9], offset: 'behind', length: 600 }, { type: 'ramp', at: [1, -5.6], lane: 1, speed: 110 }, { type: 'closure', at: [1, -5.9] },
          { type: 'post', at: [2.2, -7], lanes: [1, 2] }, { type: 'narrow', at: [4, -7.9], to: [4, -8.3], width: 140 }],
        roads: [{ nodes: [[3, 0], [3, -3], [1, -3], [1, -7], [4, -7], [4, -9]], oncoming: 0, crossings: false }] },
      { file: 'ind3', name: 'Промзона · 3', traffic: 0.3, chaserAt: [[1, -0.5], [2, -6.5]], intro: 'Промзона · 3. Два копа за маршрут: обоих снимают поезда. Между ними — всё остальное.',
        events: [{ type: 'post', at: [2.3, -2], lanes: [0, 2] }, { type: 'works', at: [3.2, -2], lanes: [2], len: 250 }, { type: 'spikes', at: [4, -3.5] },
          { type: 'rails', at: [4, -4.5], offset: 'behind', length: 600 }, { type: 'narrow', at: [2, -7.35], to: [2, -7.65], width: 140 }, { type: 'post', at: [2, -8.35], lanes: [1, 2] },
          { type: 'rails', at: [3.5, -9], offset: 'behind', length: 600 }],
        roads: [{ nodes: [[1, 0], [1, -2], [4, -2], [4, -6], [2, -6], [2, -9], [5, -9]], oncoming: 0, reds: [[4, -5], [2, -8]] }] },
    ] },
  // «Ночной город»: спорт, кварталы мельче и углы теснее (R 200 при радиусе спорта ~150), встречка, плотный трафик, повторные погони
  { seed: 6303, car: 'sport', speed: 350, traffic: 0.4, panic: 0.3, mix: 0.15, chaser: { gap: 200, speed: 1.02 }, grid: { bx: 600, by: 520, road: 180, r: 200 }, blocks: { i: [-1, 7], j: [-13, 0] },
    routes: [
      { file: 'night1', name: 'Ночной город · 1', chaser: null, traffic: 0.35, intro: 'О тебе говорят. Спорт: острый руль, быстро гасит вираж. Улицы тесные, слева встречка, и полиция уже знает номер.',
        events: [{ type: 'post', at: [0, -2.5] }, { type: 'works', at: [2, -6.4], lanes: [2], len: 200 }, { type: 'narrow', at: [5, -9.4], to: [5, -9.7], width: 120 }],
        roads: [{ nodes: [[0, 0], [0, -4], [2, -4], [2, -8], [5, -8], [5, -12]], oncoming: 1, reds: [[0, -3], [2, -6]] }] },
      // «Тоннель» — шесть кварталов в две полосы без единого поворота: коп не отстаёт, спасение — переезд в конце
      { file: 'night_tunnel', name: 'Ночной город · Тоннель', traffic: 0.3, chaser: { gap: 240, speed: 1.02 }, chaserAt: [1, -0.5], // 1.04 догонял в тоннеле; 1.02 к переезду подтягивается до ~150 px
        intro: 'Тоннель. Две полосы и ни одного поворота — коп не отстанет. Спасение в конце.',
        events: [{ type: 'narrow', at: [3, -4.5], to: [3, -10.5], width: 120 }, { type: 'rails', at: [3, -11.2], offset: 'behind', after: 0.2, length: 500 }],
        roads: [{ nodes: [[1, 0], [1, -3], [3, -3], [3, -12]], oncoming: 0, crossings: false }] },
      // «Дождь» — сцепление 0.7: машину несёт дольше, поворачивать раньше; та же механика, другой ритм
      { file: 'night_wet', name: 'Ночной город · Дождь', traffic: 0.3, chaser: null, grip: 0.7, intro: 'Дождь. Сцепление ниже — машину несёт дольше. Поворачивай раньше, чем привык.',
        events: [{ type: 'post', at: [4, -2.5] }, { type: 'works', at: [2, -6.4], lanes: [2], len: 200 }, { type: 'narrow', at: [5, -10.4], to: [5, -10.7], width: 120 }],
        roads: [{ nodes: [[4, 0], [4, -4], [2, -4], [2, -9], [5, -9], [5, -12]], oncoming: 1, reds: [[4, -2], [2, -7]] }] },
      { file: 'night2', name: 'Ночной город · 2', chaserAt: [[3, -0.5], [1, -3.6]], intro: 'Ночной город · 2. Коп с самого старта и второй после первого. Переезды — твоё оружие.',
        events: [{ type: 'rails', at: [3, -1.6], offset: 'behind', length: 500 }, { type: 'spikes', at: [1, -4.5] }, { type: 'works', at: [1, -5.35], lanes: [2], len: 180 },
          { type: 'rails', at: [3, -8.5], offset: 'behind', length: 500 }, { type: 'narrow', at: [5, -10.9], to: [5, -11.2], width: 120 }],
        roads: [{ nodes: [[3, 0], [3, -3], [1, -3], [1, -7], [3, -7], [3, -10], [5, -10], [5, -12]], oncoming: 1, reds: [[1, -5], [3, -9]] }] },
      { file: 'night3', name: 'Ночной город · 3', traffic: 0.45, chaser: { gap: 200, speed: 1.03 }, chaserAt: [[2, -0.5], [4, -5.5], [6, -9.5]],
        intro: 'Ночной город · 3. Три копа. Снять их можно на переездах и на красном — поперечные бьют и копа.',
        events: [{ type: 'post', at: [2, -1.5], lanes: [0, 2] }, { type: 'rails', at: [2, -2.5], offset: 'behind', length: 500 }, { type: 'works', at: [3.4, -3], lanes: [2], len: 200 },
          { type: 'spikes', at: [4, -4.5] }, { type: 'rails', at: [4, -6.5], offset: 'behind', length: 500 }, { type: 'post', at: [5.4, -8], lanes: [1, 2] },
          { type: 'narrow', at: [6, -10.4], to: [6, -10.7], width: 120 }, { type: 'rails', at: [6, -11.5], offset: 'behind', length: 500 }],
        roads: [{ nodes: [[2, 0], [2, -3], [4, -3], [4, -8], [6, -8], [6, -13]], oncoming: 1, reds: [[2, -2], [4, -5], [4, -7], [6, -9], [6, -12]] }] },
    ] },
  // «Район 2» → «Центр»: гараж у (3,−4), три старта — три уровня в одном городе
  { seed: 777, car: 'sedan', traffic: 0.3, panic: 0.3, chaser: { gap: 160, speed: 1 }, blocks: { i: [-1, 4], j: [-9, 0] },
    routes: [
      // маршрут 1: старт (0,0), север 3, восток 3, север 1. Ветка А: направо у (0,−1), прямо через (1,−1), налево у (2,−1),
      // прямо через (2,−2), вливается в главную у (2,−3). Ветка Б от А: налево у (1,−1), направо у (1,−2), вливается в А у (2,−2)
      { file: 'district2', name: 'Центр · 1', traffic: 0.3, intro: 'Окраина тебя заметила — дали седан и заказы в центре. Перекрёстки на красный, поперечные идут: проскакивай между ними.',
        // вводный: пост с просветом после первого перекрёстка, ремонт правой полосы на восточном отрезке
        events: [{ type: 'post', at: [0, -2.5] }, { type: 'works', at: [1.6, -3], lanes: [2], len: 400 }],
        roads: [
        { nodes: [[0, 0], [0, -3], [3, -3], [3, -4]], oncoming: 1, offsets: [3.0, 9.5], // (0,−2) красный, (1,−3) зелёный при прибытии (routebot SWEEP)
          cars: h => [{ s: 340, lane: 2, speed: 0 }, { s: h.sAt(...h.node([1, -3])) + 220, lane: 2, speed: 0 }] },
        { nodes: [[0, -1], [1, -1], [2, -1], [2, -2], [2, -3]], oncoming: 1 }, // её прямые узлы — примыкания ветки Б, перекрёстков нет
        { nodes: [[1, -1], [1, -2], [2, -2]], parent: 0, oncoming: 1 },
      ] },
      // концептуальные: «Красная волна» — красный на каждом перекрёстке, средняя полоса проходит между поперечными (ритм)
      { file: 'ctr_red', name: 'Центр · Красная волна', traffic: 0.1, intro: 'Красная волна. Красный на каждом перекрёстке. Средняя полоса проходит между поперечными — держи ритм.',
        roads: [{ nodes: [[0, 0], [0, -8]], oncoming: 1, reds: [[0, -1], [0, -2], [0, -3], [0, -4], [0, -5], [0, -6], [0, -7]] }] },
      // «Пробка» — все ползут на 35–45 %, три полосы забиты; окна открываются и закрываются
      { file: 'ctr_jam', name: 'Центр · Пробка', traffic: 1.5, mix: 0.2, pace: [0.35, 0.45], intro: 'Пробка. Все ползут. Лавируй между рядами — окна открываются и закрываются.',
        roads: [{ nodes: [[3, 0], [3, -4], [1, -4], [1, -8]], oncoming: 0, crossings: false }] }, // три полосы попутные: плотность 1.5 — ~33 машины на маршрут
      // маршрут 2: старт (3,0), север 1, запад 2, север 2, восток 2, север 1. Ветка: направо у (1,−2), налево у (2,−2), вливается у (2,−3)
      { file: 'district2b', name: 'Центр · 2', traffic: 0.35, intro: 'Центр · 2. Перекрытие впереди — объезд по боковой улице, стрелка покажет.',
        // ремонт правой полосы на западном отрезке, полное перекрытие северного отрезка за (1,−2) — объезд по ветке
        events: [{ type: 'works', at: [1.85, -1], lanes: [2], len: 220 }, { type: 'closure', at: [1, -2.55] }],
        roads: [
        { nodes: [[3, 0], [3, -1], [1, -1], [1, -3], [3, -3], [3, -4]], oncoming: 1, offsets: [5.0], // (2,−1) зелёный при прибытии
          cars: h => [{ s: 300, lane: 2, speed: 0 }, { s: h.sAt(...h.node([1, -1])) + 260, lane: 2, speed: 0 }] },
        { nodes: [[1, -2], [2, -2], [2, -3]], oncoming: 1 },
      ] },
      // маршрут 3: старт (1,0), север 2, восток 2, север 2. Ветка: направо у (1,−1), налево у (2,−1), вливается у (2,−2)
      { file: 'district2c', name: 'Центр · 3', traffic: 0.4, intro: 'Центр · 3. Коп на хвосте. Переезд его снимет, если держать темп.',
        // переезд на первом отрезке (поезд проходит сразу за игроком — коп под поездом), сужение и пост на последнем
        events: [{ type: 'rails', at: [1, -0.6], period: 14, length: 500, offset: 2.9 }, { type: 'narrow', at: [3, -2.25], to: [3, -2.65], width: 110 },
          { type: 'post', at: [3, -3.5] }],
        roads: [
        { nodes: [[1, 0], [1, -2], [3, -2], [3, -4]], oncoming: 1, offsets: [7.5], // (3,−3) красный при прибытии, как в «Районе 1»
          cars: h => [{ s: 320, lane: 2, speed: 0 }, { s: h.sAt(...h.node([2, -2])) + 240, lane: 2, speed: 0 }] },
        { nodes: [[1, -1], [2, -1], [2, -2]], oncoming: 1 },
      ] },
    ] },
];
for (const d of DISTRICTS) for (const r of d.routes) if (!process.argv[2] || r.file === process.argv[2]) build(d, r);
