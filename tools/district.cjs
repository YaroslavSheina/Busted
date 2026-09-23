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
// Кольцо (M11): радиус оси круга RR, радиус дуг въезда и съезда RE; RD — от центра узла до начала въезда по оси улицы
// (въезд — дуга вправо, касательная к улице и к кругу снаружи: |центр круга − центр дуги| = RR + RE)
let RR = 286, RE = 286, RD = 495;
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
function legsOf(nodes, rings = new Set()) {
  const legs = [];
  for (let k = 0; k < nodes.length - 1; k++) {
    const a = node(nodes[k]), b = node(nodes[k + 1]), dx = Math.sign(b[0] - a[0]), dy = Math.sign(b[1] - a[1]);
    const last = legs.at(-1);
    if (last && last.dx === dx && last.dy === dy && !rings.has(nodes[k].join(','))) { last.b = b; last.len = Math.hypot(b[0] - last.a[0], b[1] - last.a[1]); } // кольцо на прямой делит ногу
    else legs.push({ a, b, dx, dy, len: Math.hypot(b[0] - a[0], b[1] - a[1]) });
  }
  return legs;
}
// Кольцо на узле C: въезд с курсом hin, съезд по направлению u. Въезд — дуга вправо (угол растёт: на экране по часовой),
// круг — против часовой на экране (угол убывает), съезд — снова вправо. Точки каждые ~15°; T и U — касания круга
function ringPath(C, hin, u) {
  if (hin[0] === -u[0] && hin[1] === -u[1]) throw new Error(`кольцо у ${C}: разворот на кольце не поддерживается`);
  const nr = v => [-v[1], v[0]];                                   // правая нормаль к курсу
  const add = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k];
  const P0 = add(C, hin, -RD), E = add(P0, nr(hin), RE), Q0 = add(C, u, RD), F = add(Q0, nr(u), RE);
  const onRing = P => { const d = Math.hypot(P[0] - C[0], P[1] - C[1]); return [C[0] + (P[0] - C[0]) / d * RR, C[1] + (P[1] - C[1]) / d * RR]; };
  const T = onRing(E), U = onRing(F);
  const ang = (P, O) => Math.atan2(P[1] - O[1], P[0] - O[0]);
  const pos = a => { while (a <= 0) a += 2 * Math.PI; while (a > 2 * Math.PI) a -= 2 * Math.PI; return a; };
  const pts = [];
  const arc = (O, rad, a0, da) => { const n = Math.max(3, Math.ceil(Math.abs(da) / (Math.PI / 12))); for (let m = 1; m <= n; m++) { const a = a0 + da * m / n; pts.push([O[0] + rad * Math.cos(a), O[1] + rad * Math.sin(a)]); } };
  let a0 = ang(P0, E); arc(E, RE, a0, pos(ang(T, E) - a0));       // въезд
  a0 = ang(T, C); arc(C, RR, a0, -pos(a0 - ang(U, C)));           // круг
  a0 = ang(U, F); arc(F, RE, a0, pos(ang(Q0, F) - a0));           // съезд
  return { pts, T, U };
}
// open — ветка: первая и последняя ноги виртуальные (лежат на родителе), от них берутся только дуги.
// isRing(p) — узел p кольцо; rings — сюда складываются касания въезда и съезда для разметки круга
function polyline(legs, open, isRing = () => false, rings = []) {
  const pts = [];
  const push = p => { const q = [Math.round(p[0]), Math.round(p[1])]; const l = pts[pts.length - 1]; if (!l || l[0] !== q[0] || l[1] !== q[1]) pts.push(q); };
  if (!open) push(legs[0].a);
  for (let k = 0; k < legs.length; k++) {
    const L = legs[k], next = legs[k + 1], prev = legs[k - 1];
    const virt = open && (k === 0 || k === legs.length - 1);
    const offA = prev ? (isRing(L.a) ? RD : R) : 0, offB = next ? (isRing(L.b) ? RD : R) : 0;
    const start = [L.a[0] + L.dx * offA, L.a[1] + L.dy * offA];   // после дуги или съезда с кольца
    const end = [L.b[0] - L.dx * offB, L.b[1] - L.dy * offB];     // до начала дуги или въезда на кольцо
    if (!virt) {
      const span = L.len - offA - offB;
      if (span < 0) throw new Error(`отрезок ${L.a}→${L.b}: дуги и въезды на кольца не помещаются (не хватает ${Math.round(-span)} px) — нужна нога длиннее`);
      const n = Math.max(1, Math.ceil(span / 500));
      for (let m = 0; m <= n; m++) push([start[0] + (end[0] - start[0]) * m / n, start[1] + (end[1] - start[1]) * m / n]);
    }
    if (next && isRing(L.b)) {
      const rp = ringPath(L.b, [L.dx, L.dy], [next.dx, next.dy]);
      for (const p of rp.pts) push(p);
      rings.push({ C: L.b, T: rp.T, U: rp.U, P0: [L.b[0] - L.dx * RD, L.b[1] - L.dy * RD], hin: [L.dx, L.dy], u: [next.dx, next.dy] });
    } else if (next) { // дуга от end к точке после угла
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
  // 1.3 радиуса угла: масл-кар на Промзоне (R 260) проходит такое кольцо ботом из всех трёх полос; 1.2 срывал внешнюю на съезде
  ({ r: RR = Math.round(1.3 * R), entry: RE = Math.round(1.3 * R) } = spec.grid?.ring ?? {});
  RD = Math.round(Math.sqrt(RR * RR + 2 * RR * RE));
  SPEED = spec.speed ?? 300;
  const rnd = mkRnd(spec.seed);
  const roads = [], ringHits = [];
  spec.roads.forEach((rd, idx) => {
    if (rd.rings && idx > 0) throw new Error(`${spec.name}: кольца только на главной`);
    if (rd.rings?.length && rd.oncoming) throw new Error(`${spec.name}: на кольце движение одностороннее — oncoming: 0`);
    const ringKeys = new Set((rd.rings ?? []).map(n => n.join(',')));
    const legs = legsOf(rd.nodes, ringKeys);
    let pts, sm, def = null;
    if (idx === 0) { pts = polyline(legs, false, p => ringKeys.has([p[0] / BX, p[1] / BY].join(',')), ringHits); sm = sample(pts); }
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
    const nearRing = ([x, y]) => ringHits.some(g => Math.hypot(x - g.C[0], y - g.C[1]) < RD + ROAD / 2 + 80);
    r.crossings = r.noCross ? [] : r.straight.filter(p => !junctions.has(p.join(',')) && !nearRing(p)).map(([x, y], k) => {
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
  // заграждение посреди перекрёстка — ошибка расстановки: полиция стоит на поперечной улице, ремонт режет её
  for (const b of blocks) for (const c of main0.crossings) { const b1 = b.s + (b.works ? b.len ?? 400 : 0); if (b1 > c.s - 110 && b.s < c.s + 110) console.log(`   ! ${spec.name}: заграждение s${b.s}${b.works ? `–${b1}` : ''} на перекрёстке s${c.s}`); }
  // знаки перед препятствиями (docs/teaching.md): за ~1.7 с езды, не ближе 150 px к старту и не на поперечной улице;
  // одинаковые подряд ближе 500 px — один знак на серию
  const lead = Math.max(300, Math.round(1.7 * SPEED)), signs = [];
  const want = (s, kind) => { if (s - lead < 150) return; signs.push({ s: s - lead, kind }); };
  for (const b of blocks) want(b.s, b.works ? 'works' : 'police');
  for (const n of narrows) want(n.from, 'narrow');
  for (const r of rails) want(r.s, 'rails');
  for (const g of ringHits) want(sAt(main0.sm, g.P0[0], g.P0[1]) + lead - 120, 'ring');
  signs.sort((a, b) => a.s - b.s);
  for (const g of signs) for (const c of main0.crossings) { const half = c.width ?? 90; if (Math.abs(g.s - c.s) < half + 40) g.s = c.s - half - 40; }
  const signsOut = signs.filter((g, i) => g.s >= 150 && !signs.slice(0, i).some(o => o.kind === g.kind && g.s - o.s < 500));
  // сценарий (docs/progression.md): карточки, ловушка, контрольные точки — по координатам сетки; коп по событию
  const cards = (route.cards ?? []).map(c => ({ s: atS(c.at), text: c.text }));
  const trap = route.trap ? { s: atS(route.trap.at), text: route.trap.text } : null;
  const checkpoints = (route.checkpoints ?? []).map(atS);
  // друг-наставник (docs/teaching.md): план полос и «дальше сам» — координатами сетки или числом s; реплики — по s главной
  const toS = at => typeof at === 'number' ? at : atS(at);
  const mentor = route.mentor ? { ...(route.mentor.gap ? { gap: route.mentor.gap } : {}), plan: route.mentor.plan.map(([at, lane]) => [toS(at), lane]), until: toS(route.mentor.until), ...(route.mentor.bye ? { bye: route.mentor.bye } : {}) } : null;
  const talk = (route.talk ?? []).map(t => ({ s: atS(t.at), text: t.text }));
  const trafficFrom = route.trafficFrom ? toS(route.trafficFrom) : null;
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
  const trim = (list, cx, cy, rad) => list.flatMap(p => {
    const nx = Math.max(p.x, Math.min(cx, p.x + p.w)), ny = Math.max(p.y, Math.min(cy, p.y + p.h));
    if (Math.hypot(nx - cx, ny - cy) >= rad) return [p];
    const keep = [];                                                // часть здания целиком вне круга — какая больше
    if (p.x + p.w > cx + rad) keep.push({ ...p, x: cx + rad, w: p.x + p.w - (cx + rad) });
    if (p.x < cx - rad) keep.push({ ...p, w: cx - rad - p.x });
    if (p.y + p.h > cy + rad) keep.push({ ...p, y: cy + rad, h: p.y + p.h - (cy + rad) });
    if (p.y < cy - rad) keep.push({ ...p, h: cy - rad - p.y });
    const ok = keep.filter(o => o.w >= 80 && o.h >= 80).sort((a, b) => b.w * b.h - a.w * a.h);
    return ok.length ? [ok[0]] : [];
  });
  for (const g of ringHits) props = trim(props, g.C[0], g.C[1], RR + ROAD / 2 + 26 + 40);
  // кольца в уровень: центр, радиус, участок маршрута по кругу, рукава, по которым маршрут не идёт
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const rings = ringHits.map(g => ({ x: g.C[0], y: g.C[1], r: RR, s0: sAt(roads[0].sm, g.T[0], g.T[1]), s1: sAt(roads[0].sm, g.U[0], g.U[1]),
    arms: DIRS.filter(d => !(d[0] === -g.hin[0] && d[1] === -g.hin[1]) && !(d[0] === g.u[0] && d[1] === g.u[1])) }));

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
  "chaser": ${JSON.stringify(chaser)},${route.intro ? `\n  "intro": ${JSON.stringify(route.intro)},` : ''}${route.goal ? `\n  "goal": ${JSON.stringify(route.goal)},` : ''}${mentor ? `\n  "mentor": ${JSON.stringify(mentor)},` : ''}${talk.length ? `\n  "talk": [\n${talk.map(t => '    ' + JSON.stringify(t)).join(',\n')}\n  ],` : ''}${trafficFrom ? `\n  "trafficFrom": ${trafficFrom},` : ''}${cards.length ? `\n  "cards": [\n${cards.map(c => '    ' + JSON.stringify(c)).join(',\n')}\n  ],` : ''}${trap ? `\n  "trap": ${JSON.stringify(trap)},` : ''}${checkpoints.length ? `\n  "checkpoints": ${JSON.stringify(checkpoints)},` : ''}
  "cars": [
${mainCars.map(c => '    ' + JSON.stringify(c)).join(',\n')}
  ],${blocks.length ? `\n  "blocks": [\n${blocks.map(b => '    ' + JSON.stringify(b)).join(',\n')}\n  ],` : ''}${narrows.length ? `\n  "narrows": [\n${narrows.map(n => '    ' + JSON.stringify(n)).join(',\n')}\n  ],` : ''}${rails.length ? `\n  "rails": [\n${rails.map(r => '    ' + JSON.stringify(r)).join(',\n')}\n  ],` : ''}
  "crossings": [
${main.crossings.map(c => '    ' + JSON.stringify(strip(c))).join(',\n')}
  ],
  "branches": [
${roads.slice(1).map(branchJson).join(',\n')}
  ],${signsOut.length ? `\n  "signs": [\n${signsOut.map(g => '    ' + JSON.stringify(g)).join(',\n')}\n  ],` : ''}${rings.length ? `\n  "rings": [\n${rings.map(g => '    ' + JSON.stringify(g)).join(',\n')}\n  ],` : ''}
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
  // «Учебный район» — шесть уроков с другом (docs/teaching.md, решение 2026-09-24): после ловушки пролога и тюрьмы героя
  // встречает старый друг Штурман и учит ездить заново. Урок: друг впереди показывает (знакомство), с until растворяется —
  // «дальше сам» (проверка), в конце та же механика в новом месте (поворот). Всё на минивэне; седан приходит с Центром.
  // Третья звезда — цель урока (goal). Участок с другом — без случайного трафика (trafficFrom): друг его не видит
  { seed: 2026, car: 'minivan', speed: 240, traffic: 0, panic: 0, mix: 0, chaser: null, theme: 'pixel', blocks: { i: [-1, 7], j: [-11, 1] },
    routes: [
      // 1 · Руль: змейка из углов, два спуска — первый с другом, второй сам. Цель — ни одного заноса
      { file: 'tut01', name: '1 · Руль', goal: { type: 'noskid', n: 1 },
        intro: 'Два года за решёткой. У ворот ждёт Штурман: «Город изменился. Минивэн мой, тормозов у него нет. Держись за мной».',
        mentor: { plan: [[0, 1]], until: [2, -0.4], bye: 'Дальше сам. Жду в гараже.' },
        talk: [{ at: [0, -0.25], text: 'Жми коротко — машину несёт, отпускай заранее.' }, { at: [0, -1.25], text: 'Поворот начинай раньше, чем кажется. Как я.' },
          { at: [2, -1.65], text: 'Едем вниз: теперь LEFT уводит вправо. Смотри на машину, не на экран.' },
          { at: [6, -1.6], text: 'Опять вниз. Кнопки — от машины, не от экрана.' }],
        roads: [{ nodes: [[0, 0], [0, -2], [2, -2], [2, 0], [4, 0], [4, -2], [6, -2], [6, 0]], oncoming: 0, crossings: false }] },
      // 2 · Трафик: друг обходит медленные машины заранее; дальше плотный поток сам, обгон сразу за углом. Цель — near miss × 5
      { file: 'tut02', name: '2 · Трафик', traffic: 0.45, goal: { type: 'near', n: 5 }, trafficFrom: [0, -3.8],
        intro: 'Штурман: «Все медленнее тебя — обгоняй. Заранее, не в последний момент. Смотри, как я».',
        mentor: { plan: [[0, 1], [430, 0], [820, 1]], until: [0, -3.6], bye: 'Дальше сам. Поток плотнее.' },
        talk: [{ at: [0, -0.3], text: 'Медленный впереди — ухожу в соседнюю заранее.' }, { at: [0, -2.0], text: 'Прошёл впритирку — NEAR MISS. Пять — и я впечатлён.' },
          { at: [1, -4.45], text: 'Обгон сразу за углом — самый опасный.' }],
        events: [{ type: 'slow', at: [0, -1.1], lane: 1, speed: 70 }, { type: 'slow', at: [0, -2.2], lane: 0, speed: 70 }, { type: 'slow', at: [0, -3.0], lane: 2, speed: 60 }],
        roads: [{ nodes: [[0, 0], [0, -4], [1, -4], [1, -8]], oncoming: 0, crossings: false }] },
      // 3 · Посты и ремонт: с другом — просвет в твоей полосе, потом в соседней; сам — ремонт твоей полосы и пост за углом;
      // поворот — пост с ежами на спуске, просвет посередине. Цель — впритирку к посту × 3
      { file: 'tut03', name: '3 · Посты и ремонт', traffic: 0.15, goal: { type: 'police', n: 3 }, trafficFrom: [0, -2.9],
        intro: 'Штурман: «Полиция перекрывает улицы. Где просвет — видно издалека. Смотри, куда еду я».',
        mentor: { plan: [[0, 1], [700, 0]], until: [0, -2.5], bye: 'Дальше сам: ремонт закрывает твою полосу.' }, checkpoints: [[0, -2.55]],
        talk: [{ at: [0, -0.3], text: 'Пост. Просвет посередине — проезжай между ними.' }, { at: [0, -1.3], text: 'Просвет слева — ухожу заранее.' },
          { at: [0.9, -4], text: 'Впритирку к посту — очки. Три — и звезда твоя.' },
          { at: [2, -3.35], text: 'Вниз. Ежи по краю — просвет посередине.' }],
        events: [{ type: 'post', at: [0, -0.9] }, { type: 'post', at: [0, -2.1], lanes: [1, 2] }, { type: 'works', at: [0, -3.2], lanes: [0], len: 250 },
          { type: 'post', at: [1.0, -4], lanes: [0, 1] }, { type: 'spikes', at: [2, -2.6], lanes: [0], spikes: [2] }],
        roads: [{ nodes: [[0, 0], [0, -4], [2, -4], [2, -1]], oncoming: 0, crossings: false }] },
      // 4 · Светофор и поезд: с другом — зелёные; сам — красный с выбором полосы, ещё красный; поезд перед носом, поезд за спиной.
      // Цель — на красный × 2
      { file: 'tut04', name: '4 · Светофор и поезд', traffic: 0.15, goal: { type: 'red', n: 2 }, trafficFrom: [0, -2.9],
        intro: 'Штурман: «Светофоры и поезда. Зелёный — просто едем. Красный — это окно между машинами».',
        mentor: { plan: [[0, 1]], until: [0, -2.35], bye: 'Дальше сам. Впереди красный.' }, checkpoints: [[0, -2.4]],
        cards: [{ at: [0, -2.6], text: 'Красный: поперечные идут группой — проскочи между ними' }],
        talk: [{ at: [0, -0.3], text: 'Зелёный — едем. Поперечные ждут.' },
          { at: [0, -4.4], text: 'Ещё красный — выбирай полосу заранее.' }, { at: [1.0, -6], text: 'Переезд: поезд пройдёт перед тобой. Держи темп.' },
          { at: [2, -6.9], text: 'Этот пройдёт за спиной.' }],
        events: [{ type: 'rails', at: [1.5, -6], offset: 'ahead', length: 500 }, { type: 'rails', at: [2, -7.5], offset: 'behind', length: 500 }],
        roads: [{ nodes: [[0, 0], [0, -6], [2, -6], [2, -9]], oncoming: 0, reds: [[0, -3], [0, -5]] }] },
      // 5 · Рампа и погоня: друг прыгает первым — со свободной рампы и через перекрытие; сам — рампа через перекрытие, коп, поезд
      // за спиной снимает копа. Цель — перелёт × 2
      { file: 'tut05', name: '5 · Рампа и погоня', traffic: 0.1, goal: { type: 'flyover', n: 2 }, trafficFrom: [2, -5.2],
        chaser: { gap: 180, speed: 1.02 }, chaserAt: [2, -6.0],
        intro: 'Штурман: «Автовоз с опущенной рампой — твой трамплин. Сначала смотри, как прыгаю я».',
        mentor: { plan: [[0, 1]], until: [0, -3.7], bye: 'Дальше сам. Жду в гараже.' }, checkpoints: [[0, -3.75], [2, -5.6]],
        cards: [{ at: [0, -0.6], text: 'Рампа: заезжай сзади, по центру полосы' }],
        talk: [{ at: [0, -0.3], text: 'Автовоз с рампой. Сзади, по центру — и летим.' }, { at: [0, -2.35], text: 'Теперь через перекрытие. За мной.' },
          { at: [2, -5.95], text: 'Коп на хвосте! Ровно в поворотах — он отстанет.' },
          { at: [2, -7.9], text: 'Переезд. Поезд разберётся с копом.' }],
        events: [{ type: 'ramp', at: [0, -1.0], lane: 1, speed: 100 },
          { type: 'ramp', at: [0, -2.9], lane: 1, speed: 100 }, { type: 'closure', at: [0, -3.25] },
          { type: 'ramp', at: [2, -6.8], lane: 1, speed: 100 }, { type: 'closure', at: [2, -7.15] },
          { type: 'rails', at: [2, -8.5], offset: 'behind', after: 0.3, length: 500 }],
        roads: [{ nodes: [[0, 0], [0, -5], [2, -5], [2, -10]], oncoming: 0, crossings: false }] },
      // 6 · Экзамен: без друга — пост, ремонт, красный, поезд за спиной снимает копа, пост на спуске, кольцо налево, рампа
      { file: 'tut06', name: '6 · Экзамен', traffic: 0.3, mix: 0.1, chaser: { gap: 190, speed: 1.02 }, chaserAt: [0, -0.5],
        intro: 'Штурман: «Сегодня без меня. Посты, красный, поезд, спуск, кольцо, рампа — всё сам. Докажи, что готов».',
        talk: [{ at: [0, -0.6], text: 'Коп сзади. Не виляй — в поворотах он отстаёт.' }, { at: [2.1, -3], text: 'Поезд за спиной — снимет копа.' },
          { at: [3, -2.6], text: 'Вниз. Пост — просвет слева по ходу.' }, { at: [4.2, -1], text: 'Кольцо! Съезд — где разметка уходит с круга.' }],
        events: [{ type: 'post', at: [0, -1.5] }, { type: 'works', at: [1.5, -3], lanes: [2], len: 160 },
          { type: 'rails', at: [2.5, -3], offset: 'behind', length: 500 }, { type: 'post', at: [3, -1.75], lanes: [1, 2] },
          { type: 'ramp', at: [5, -3.2], lane: 1, speed: 100 }, { type: 'closure', at: [5, -3.5] }], // между перекрёстками (5,−3) и (5,−4), посадка до узла
        roads: [{ nodes: [[0, 0], [0, -3], [3, -3], [3, -1], [5, -1], [5, -5]], rings: [[5, -1]], oncoming: 0, reds: [[1, -3]] }] },
    ] },
  // «Пролог» (docs/progression.md): широкие улицы, спорткар, линейный длинный маршрут, финал — ловушка перед гаражом
  { seed: 31337, car: 'prologue', speed: 360, traffic: 0.1, panic: 0.4, mix: 0.1, chaser: { gap: 200, speed: 1 },
    grid: { bx: 760, by: 640, road: 220, r: 320 }, blocks: { i: [-1, 8], j: [-13, 1] },
    routes: [
      { file: 'prologue', name: 'Пролог',
        intro: 'Ночь. Чужой спорткар. Две кнопки: влево и вправо. Тормозов нет — машина едет сама. Довези её в гараж — и город твой.',
        chaserAt: [0, -2.4],
        cards: [{ at: [0, -2.5], text: 'Погоня!' }, { at: [0, -4.4], text: 'Переезд' }, { at: [6, -2.9], text: 'Автовоз впереди — прыгай!' },
          { at: [4, -3.5], text: 'Переулок' }, { at: [7, -7.3], text: 'Гараж уже виден' }],
        // спуск (2,−6)→(2,−3) пустой, с контрольной в начале; прыжок — на подъёме (6,−1)→(6,−6), тоже после контрольной (решение 2026-09-24)
        checkpoints: [[0, -5.4], [2, -5.4], [4, -1.6], [6, -2.4], [7, -7.6]],
        trap: { at: [7, -9.35], text: 'Ловушка. Тебя взяли.\nДва года за решёткой. Слава утеряна.' },
        events: [
          { type: 'parked', at: [0, -0.4] }, { type: 'parked', at: [0, -0.8] },
          { type: 'rails', at: [0, -4.6], period: 14, length: 500, offset: 'behind' },
          { type: 'works', at: [1.3, -6], lanes: [2], len: 300 },
          { type: 'ramp', at: [6, -3.3], lane: 1, speed: 120 }, { type: 'closure', at: [6, -3.65] }, // подъём между перекрёстками (6,−3) и (6,−4): посадка до узла; автовоз встаёт за RAMP.stopGap до перекрытия, ≥300 px после дуги
          { type: 'parked', at: [3.5, -3], lane: 2 },
          { type: 'narrow', at: [4, -2.3], to: [4, -1.7], width: 130 },
          { type: 'post', at: [4.75, -6] }, // за перекрёстком (5,−6), до дуги угла (4,−6); в середине прямой стоял прямо на перекрёстке
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
      { file: 'okr1', name: 'Окраина · 1', intro: 'Первый заказ от Штурмана. Минивэн тот же: тяжёлый, несёт широко — посты и ремонт читай заранее.',
        // спуск (2,−4)→(2,−2) пустой — первая встреча с инверсией в карьере (docs/teaching.md, §6); заграждения между перекрёстками
        events: [{ type: 'works', at: [0, -1.3], lanes: [2], len: 200 }, { type: 'post', at: [0, -2.5] }, { type: 'post', at: [4, -4.5], lanes: [0, 1] }],
        roads: [{ nodes: [[0, 0], [0, -4], [2, -4], [2, -2], [4, -2], [4, -6]], oncoming: 0, offsets: 'green' }] },
      { file: 'okr2', name: 'Окраина · 2', traffic: 0.25, intro: 'Окраина · 2. Ежи, сужение, просветы у постов с краю.',
        // в конце спуск к гаражу с постом: просвет слева по ходу — справа на экране
        events: [{ type: 'works', at: [3, -1.35], lanes: [0, 1], len: 200 }, { type: 'post', at: [1.65, -3] }, { type: 'spikes', at: [1, -4.5] },
          { type: 'narrow', at: [1, -5.3], to: [1, -5.65], width: 130 }, { type: 'works', at: [2.4, -6], lanes: [2], len: 150 }, { type: 'post', at: [5, -6.6], lanes: [1, 2] }],
        roads: [{ nodes: [[3, 0], [3, -3], [1, -3], [1, -6], [3, -6], [3, -8], [5, -8], [5, -6]], oncoming: 0, offsets: 'green' }] },
      // концептуальные (docs/career.md, §4): «Стройка» — ремонт на каждом квартале, свободная полоса каждый раз другая
      { file: 'okr_works', name: 'Окраина · Стройка', traffic: 0.15, intro: 'Стройка. Ремонт на каждом квартале, свободная полоса каждый раз другая. Читай на два квартала вперёд.',
        // свободная полоса каждый раз соседняя (0→1→2→1→0→1), между ремонтами 530 px: перестроение минивэна ~1.5 с = 360 px
        events: [{ type: 'works', at: [2, -1.3], lanes: [1, 2], len: 200 }, { type: 'works', at: [2, -2.7], lanes: [0, 2], len: 200 }, { type: 'works', at: [2, -4.1], lanes: [0, 1], len: 200 },
          { type: 'works', at: [2, -5.5], lanes: [0, 2], len: 200 }, { type: 'works', at: [2, -6.9], lanes: [1, 2], len: 200 }, { type: 'works', at: [2, -8.3], lanes: [0, 2], len: 200 }],
        roads: [{ nodes: [[2, 0], [2, -9]], oncoming: 0, crossings: false }] }, // улица на ремонте без поперечных: ремонт не режет перекрёстки
      // «Колонна» — грузовики парами занимают две полосы, свободная каждый раз другая; дальние пары медленнее, чтобы догнать до гаража
      { file: 'okr_convoy', name: 'Окраина · Колонна', traffic: 0, intro: 'Колонна. Грузовики идут парами и занимают две полосы. Свободная — каждый раз другая, ищи её заранее.',
        // свободная полоса: 0 → 1 → 2 → 1 (соседняя каждый раз); пары идут на 60, игрок догоняет их у s≈1100, 2100, 3050; последняя стоит.
        // Случайного трафика нет: медленная машина в свободной полосе — ловушка без выхода на 240 без тормозов
        events: [{ type: 'slow', at: [4, -1.6], lane: 1, speed: 60, model: 'truck' }, { type: 'slow', at: [4, -1.6], lane: 2, speed: 60, model: 'truck' },
          { type: 'slow', at: [4, -3.0], lane: 0, speed: 60, model: 'bus' }, { type: 'slow', at: [4, -3.0], lane: 2, speed: 60, model: 'bus' },
          { type: 'slow', at: [4, -4.4], lane: 0, speed: 60, model: 'truck' }, { type: 'slow', at: [4, -4.4], lane: 1, speed: 60, model: 'truck' },
          { type: 'slow', at: [2, -6.3], lane: 0, speed: 0, model: 'truck' }, { type: 'slow', at: [2, -6.3], lane: 2, speed: 0, model: 'truck' }],
        roads: [{ nodes: [[4, 0], [4, -5], [2, -5], [2, -9]], oncoming: 0, offsets: 'green' }] },
      { file: 'okr3', name: 'Окраина · 3', traffic: 0.3, mix: 0.1, intro: 'Окраина · 3. Два красных, ремонт на спуске — кнопки наоборот, — всё вместе.',
        // спуск (3,−4)→(3,−1) с ремонтом двух полос: свободна правая по ходу — слева на экране
        events: [{ type: 'post', at: [1, -1.5] }, { type: 'spikes', at: [1, -2.5] }, { type: 'works', at: [3, -2.5], lanes: [0, 1], len: 120 },
          { type: 'narrow', at: [5, -2.35], to: [5, -2.65], width: 130 }, { type: 'post', at: [5, -3.5], lanes: [1, 2] }],
        roads: [{ nodes: [[1, 0], [1, -4], [3, -4], [3, -1], [5, -1], [5, -5]], oncoming: 0, reds: [[1, -3], [5, -4]] }] },
    ] },
  // «Промзона»: масл-кар, широкие кварталы под его радиус, рельсы и автовозы; коп со второго маршрута
  { seed: 5202, car: 'muscle', speed: 330, traffic: 0.25, panic: 0.2, mix: 0.3, chaser: { gap: 200, speed: 1 }, theme: 'pixeldusk', grid: { bx: 700, by: 600, road: 200, r: 260 }, blocks: { i: [-1, 6], j: [-11, 0] },
    routes: [
      { file: 'ind1', name: 'Промзона · 1', chaser: null, intro: 'Масл-кар из порта — плата за центр. Быстрый на прямой, в заносе широкий. Рельсы режут район, автовозы ходят колоннами.',
        events: [{ type: 'rails', at: [0, -2.5], offset: 'behind', length: 600 }, { type: 'works', at: [0, -3.3], lanes: [2], len: 200 },
          { type: 'ramp', at: [2, -6.3], lane: 1, speed: 110 }, { type: 'post', at: [2, -6.6] }, { type: 'narrow', at: [3.4, -9], to: [3.7, -9], width: 140 }],
        roads: [{ nodes: [[0, 0], [0, -5], [2, -5], [2, -9], [5, -9]], oncoming: 0, offsets: 'green' }] },
      // «Кольца» (2026-09-24, вместо «Серпантина») — только геометрия, без трафика: масл-кар на трёх кольцах. Первое — прямо
      // (полкруга), второе и третье — налево (три четверти круга): курс проходит все стороны экрана, на спуске кнопки «наоборот»
      { file: 'ind_serp', name: 'Промзона · Кольца', traffic: 0, chaser: null,
        intro: 'Кольца. Только руль и масл-кар. На круге держи машину короткими нажатиями; съезд там, где разметка уходит с круга. Когда едешь вниз, LEFT уводит вправо.',
        roads: [{ nodes: [[0, 0], [0, -3], [0, -5], [2, -5], [2, -8], [0, -8], [0, -10]], rings: [[0, -3], [2, -5], [2, -8]], oncoming: 0, crossings: false }] },
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
  { seed: 777, car: 'sedan', traffic: 0.3, panic: 0.3, chaser: { gap: 160, speed: 1 }, blocks: { i: [-1, 6], j: [-9, 0] },
    routes: [
      // маршрут 1: старт (0,0), север 3, восток 3, север 1. Линейный (2026-09-24: ветки-объезды А и Б убраны — путь один)
      { file: 'district2', name: 'Центр · 1', traffic: 0.3, intro: 'Окраина тебя заметила — дали седан и заказы в центре. Слева встречка за двойной жёлтой. Прижмёшься к машине — водитель запаникует и может снести копа.',
        // вводный: пост с просветом после первого перекрёстка, ремонт правой полосы на восточном отрезке
        // встречка и паника переехали сюда из обучения (docs/teaching.md): медленная в правой — прижаться и напугать
        // спуск (2,−3)→(2,−1) по двусторонней улице: встречка слева по ходу — справа на экране (docs/teaching.md, §6)
        events: [{ type: 'slow', at: [0, -1.4], lane: 2, speed: 90 }, { type: 'post', at: [0, -2.5] }, { type: 'works', at: [4, -2.5], lanes: [2], len: 120 }],
        roads: [
        { nodes: [[0, 0], [0, -3], [2, -3], [2, -1], [4, -1], [4, -4]], oncoming: 1, reds: [[0, -2]], // красный на втором перекрёстке, остальные зелёные
          cars: h => [{ s: 340, lane: 2, speed: 0 }, { s: h.sAt(...h.node([1, -3])) + 220, lane: 2, speed: 0 }] },
      ] },
      // концептуальные: «Красная волна» — красный на каждом перекрёстке, средняя полоса проходит между поперечными (ритм)
      { file: 'ctr_red', name: 'Центр · Красная волна', traffic: 0.1, intro: 'Красная волна. Красный на каждом перекрёстке. Средняя полоса проходит между поперечными — держи ритм.',
        roads: [{ nodes: [[0, 0], [0, -8]], oncoming: 1, reds: [[0, -1], [0, -2], [0, -3], [0, -4], [0, -5], [0, -6], [0, -7]] }] },
      // «Пробка» — все ползут на 35–45 %, три полосы забиты; окна открываются и закрываются
      { file: 'ctr_jam', name: 'Центр · Пробка', traffic: 1.5, mix: 0.2, pace: [0.35, 0.45], intro: 'Пробка. Все ползут. Лавируй между рядами — окна открываются и закрываются.',
        roads: [{ nodes: [[3, 0], [3, -4], [1, -4], [1, -8]], oncoming: 0, crossings: false }] }, // три полосы попутные: плотность 1.5 — ~33 машины на маршрут
      // маршрут 2: старт (3,0), север 1, запад 2, север 2, восток 2, север 1. Линейный (2026-09-24: перекрытие с объездом по
      // боковой улице заменено постом с просветом справа): красный на (2,−1) и сразу ремонт правой полосы; за углом стоящая
      // в правой — обойти по средней; за перекрёстком (1,−2) пост — просвет справа, слева встречка
      { file: 'district2b', name: 'Центр · 2', traffic: 0.35, intro: 'Центр · 2. Красный, за ним ремонт справа. Пост — просвет справа, слева встречка. На спуске ещё красный: полосы вверх ногами.',
        // спуск (3,−4)→(3,−2) с красным на (3,−3) — выбор полосы, когда кнопки наоборот
        events: [{ type: 'works', at: [1.6, -1], lanes: [2], len: 150 }, { type: 'post', at: [1, -2.55], lanes: [0, 1] }],
        roads: [
        { nodes: [[3, 0], [3, -1], [1, -1], [1, -4], [3, -4], [3, -2], [5, -2], [5, -5]], oncoming: 1, reds: [[2, -1], [3, -3]],
          cars: h => [{ s: 300, lane: 2, speed: 0 }, { s: h.sAt(...h.node([1, -1])) + 260, lane: 2, speed: 0 }] },
      ] },
      // маршрут 3: старт (1,0), север 2, восток 2, север 2. Линейный (2026-09-24: ветка-объезд убрана)
      { file: 'district2c', name: 'Центр · 3', traffic: 0.4, intro: 'Центр · 3. Коп на хвосте — переезд его снимет, если держать темп. На спуске сужение и красный.',
        // переезд на первом отрезке (поезд проходит сразу за игроком — коп под поездом); спуск (3,−3)→(3,−1): сужение и сразу
        // красный — вверх ногами; пост на последнем отрезке
        events: [{ type: 'rails', at: [1, -0.6], period: 14, length: 500, offset: 2.9 }, { type: 'narrow', at: [3, -2.6], to: [3, -2.35], width: 110 },
          { type: 'post', at: [5, -2.5] }],
        roads: [
        { nodes: [[1, 0], [1, -3], [3, -3], [3, -1], [5, -1], [5, -5]], oncoming: 1, reds: [[3, -2], [5, -4]], // красный за сужением на спуске
          cars: h => [{ s: 320, lane: 2, speed: 0 }, { s: h.sAt(...h.node([2, -3])) + 240, lane: 2, speed: 0 }] },
      ] },
    ] },
];
for (const d of DISTRICTS) for (const r of d.routes) if (!process.argv[2] || r.file === process.argv[2]) build(d, r);
