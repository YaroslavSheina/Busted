// Одна попытка: состояние, обновление, цикл. Используется игрой (main.ts) и редактором («Играть»).
import { BLOCK, BRANCH, CAM_AHEAD, CAM_LERP, CARD_HOLD, CHASER_FOLLOW, CHASER_LINE, MAX_DT, P, PANIC, RAMP, SCORE, TRAFFIC_AI, TRAFFIC_SIZE } from './config';
import { layoutRails, trainObb, untilTrain, type Rail } from './rails';
import { RAIL } from './config';
import { engine as sfxEngine, play as sfx, siren as sfxSiren } from './audio';
import { crossCars, layoutCrossings, lightAt, type Crossing } from './crossings';
import { carByKey, type CarSpec } from './cars';
import { step, type CarState } from './physics';
import { buildPath, curvatureAt, heading, laneOff, nearest, nearestGlobal, pathAt, pathAtExt, type Path } from './road';
import { buildRoadPaths, parentEquivalent, parentRoad, type BranchDef } from './roads';
import { layoutBlocks, type Block, type Layout } from './blocks';
import { makeWidthFn, widthAt, type Narrow, type WidthFn } from './narrow';
import { NEAR, brushSide, collides, fullBlockAhead, hit, moveTraffic, obb, spawnTraffic, vehiclePose, type Obb, type TrafficCar, type Vehicle } from './traffic';
import { currentDir, holdText, initInput, resetHold, trackHold } from './input';
import { fmtScore, hudHtml, render, type Blast, type Cam, type Fx, type Mark, type RoadScene } from './render';
import type { LevelData } from './levels';

export interface GameUI {
  canvas: HTMLCanvasElement;
  hud: HTMLElement;
  overlay: HTMLElement;
  ovTitle: HTMLElement;
  ovSub: HTMLElement;
  ovHint: HTMLElement;
  ovName?: HTMLElement;   // полоса с именем уровня в интро (в редакторе нет)
  // игровой HUD (в редакторе и харнессе нет): очки, полоса маршрута с меткой машины, шкала копа, событие
  gscore?: HTMLElement; barFill?: HTMLElement; barCar?: HTMLElement; cop?: HTMLElement; copFill?: HTMLElement; gflash?: HTMLElement;
  left: HTMLElement;
  right: HTMLElement;
}
// Конец уровня: done — доставил, trap — ловушка по сценарию (тоже «пройдено»). Вернуть true, если следующий уровень уже загружен
export type EndHook = (how: 'done' | 'trap') => boolean;
export type ScoreHook = (points: number) => number; // уровень пройден: очки в славу, возвращает её сумму (для экрана DELIVERED)

export interface Game {
  load(level: LevelData): void;
  reset(): void;
  onEnd(hook: EndHook | null): void;
  onScore(hook: ScoreHook | null): void;
  pause(on: boolean): void; // меню открыто — мир стоит, кадр рисуется
  stop(): void;
}

type State = 'play' | 'busted' | 'done' | 'trap' | 'intro';
type Car = CarState & { s: number; off: number; W: number; L: number; road: number };

// Дорога графа: 0 — главная, дальше ветки. Всё, что живёт на дороге, лежит здесь
interface Road {
  path: Path;
  def: BranchDef | null;   // null — главная
  parent: number;          // индекс родительской дороги (−1 у главной)
  width: number | WidthFn; // ширина по s: базовая из P (слайдер) с сужениями уровня
  narrows?: Narrow[];
  blockDefs?: Block[];
  rails: Rail[];
  crossings: Crossing[];
  oncoming: number;
  blocks: Layout;
  solids: { obb: Obb; s: number; why: string }[];
  cars: TrafficCar[];
  traffic: Vehicle[];
}

export function createGame(ui: GameUI, first: LevelData): Game {
  const ctx = ui.canvas.getContext('2d')!;

  const view = { W: 0, H: 0, DPR: 1 };
  function resize(): void {
    view.DPR = Math.min(2, devicePixelRatio || 1);
    view.W = innerWidth; view.H = innerHeight;
    ui.canvas.width = view.W * view.DPR; ui.canvas.height = view.H * view.DPR;
  }

  let level: LevelData;
  let spec: CarSpec;
  let roads: Road[];
  let car: Car;
  let marks: Mark[];
  let cam: Cam;
  let state: State;
  let timeAlive = 0;
  let paused = false;
  let flat = false; // после ежей машина неуправляема
  // Преследователь едет по сплайну с той же скоростью и сворачивает туда же, куда свернул игрок
  let chaser: { road: number; s: number; off: number } | null = null;
  let taken: Set<number>; // ветки, на которые свернул игрок
  // Слоу-мо и зум провокации (M3): slow — остаток реального времени, zoom тянется к цели
  let slow = 0, zoom = 1;
  let flash: { text: string; t: number } | null = null; // короткая надпись в HUD («коп выбыл»)
  // Очки попытки (фаза B): дистанция + события; fx — всплывающие надписи и искры
  let score = 0;
  let fx: Fx[] = [];
  // Отклик на события (2026-09-14): взрывы и дым идут по своим часам и после BUSTED, тряска затухает, машина после удара разбита;
  // DELIVERED раскрывает строки результата по одной
  let blasts: Blast[] = [];
  let shake = 0;
  let wrecked = false;
  let reveal: { lines: string[]; at: number; t: number } | null = null;
  const boom = (x: number, y: number, size: number, dur = 0.9) => { blasts.push({ kind: 'boom', x, y, age: 0, size, dur }); };
  const puff = (x: number, y: number, size: number, dur = 0.8, delay = 0) => { blasts.push({ kind: 'smoke', x, y, age: -delay, size, dur }); };
  let buzzedPosts: Set<string>; // «дорога:индекс» полицейских машин постов, к которым уже прижимались
  // Прыжок с рампы (M8): t — прошло, over — что пролетели (объекты считаем один раз)
  let jump: { t: number; over: Set<object> } | null = null;
  const horned = new Set<Rail>();        // гудок поезда прозвучал для этого прохода состава
  let introN = 0;                        // последняя показанная цифра отсчёта (для бипов)
  // Сценарий (docs/progression.md): отсчёт при первом старте уровня, карточки по ходу, контрольные точки, коп по событию
  let firstStart = true;                 // отсчёт 3-2-1 только при первом старте уровня, рестарт после BUSTED мгновенный
  let intro: number | null = null;       // остаток отсчёта, с
  let cardIdx = 0, card: number | null = null; // следующая карточка и остаток стоп-кадра, с
  let cpS = 0;                           // s последней пройденной контрольной точки (0 — старт)
  let copIdx = 0;                        // сколько точек появления копа (chaser.at) уже пройдено; новый коп — только если прежний выбыл
  const copAts = () => !level.chaser ? [] : Array.isArray(level.chaser.at) ? level.chaser.at : [level.chaser.at ?? 0];
  let endHook: EndHook | null = null;
  let scoreHook: ScoreHook | null = null;

  function makeRoad(path: Path, def: BranchDef | null, blocks: Block[] | undefined, cars: TrafficCar[] | undefined, narrows: Narrow[] | undefined): Road {
    const r: Road = { path, def, parent: -1, width: P.width.v, narrows, blockDefs: blocks, rails: [], crossings: [], oncoming: 0, blocks: layoutBlocks(path, P.width.v, []), solids: [], cars: cars ?? [], traffic: [] };
    refreshRoad(r);
    return r;
  }
  // Ширина (слайдер панели + сужения) и разметка постов пересчитываются при каждом reset — слайдер ширины ведёт сюда
  function refreshRoad(r: Road): void {
    r.width = makeWidthFn(() => P.width.v, r.narrows);
    r.blocks = layoutBlocks(r.path, r.width, r.blockDefs);
    r.solids = [
      ...r.blocks.police.map(b => ({ obb: obb(b.x, b.y, b.h, b.w, b.l), s: b.s, why: 'врезался в пост' })),
      ...r.blocks.works.map(b => ({ obb: obb(b.x, b.y, b.h, b.w, b.l), s: b.s, why: 'заграждение' })),
    ];
  }

  function load(l: LevelData): void {
    level = l; firstStart = true; cpS = 0;
    spec = carByKey(l.car);
    // Машина и уровень задают стартовые значения, слайдеры панели тюнинга дальше крутят их поверх
    P.width.v = l.width; P.traffic.v = l.traffic;
    P.speed.v = spec.speed; P.steer.v = spec.steer; P.damp.v = spec.damp; P.grip.v = spec.grip * (l.grip ?? 1); P.spin.v = spec.spin; P.skidGrip.v = spec.skidGrip * (l.grip ?? 1); // grip уровня — «мокрая дорога»
    const main = buildPath(l.points);
    roads = [makeRoad(main, null, l.blocks, l.cars, l.narrows)];
    roads[0].oncoming = l.oncoming ?? 0;
    roads[0].rails = layoutRails(main, l.rails);
    roads[0].crossings = layoutCrossings(main, l.crossings, l.width);
    const paths = buildRoadPaths(main, l.branches);
    (l.branches ?? []).forEach((b, i) => {
      const path = paths[i + 1];
      if (!path) throw new Error(`Уровень «${l.name}»: ветка ${i} ссылается на родителя ${b.parent}, которого нет раньше неё`);
      const r = makeRoad(path, b, b.blocks, b.cars, b.narrows);
      r.parent = parentRoad(b); r.oncoming = b.oncoming ?? 0;
      r.rails = layoutRails(path, b.rails); r.crossings = layoutCrossings(path, b.crossings, l.width);
      roads.push(r);
    });
    reset();
  }

  function reset(): void {
    const p0 = pathAt(roads[0].path, 0);
    car = { x: p0.x, y: p0.y, h: heading(p0.tx, p0.ty), w: 0, vx: p0.tx * P.speed.v, vy: p0.ty * P.speed.v, s: 0, off: 0, skid: false, W: spec.W, L: spec.L, road: 0 };
    marks = [];
    cam = { x: car.x, y: car.y };
    state = 'play'; timeAlive = 0; resetHold();
    roads.forEach((r, i) => { refreshRoad(r); r.traffic = spawnTraffic(r.path, P.traffic.v, P.speed.v, level.seed + i * 7919, r.cars, r.blocks, r.width, r.oncoming, level.mix ?? 0, level.pace); });
    // перед ловушкой трафика нет: иначе к перекрытию собирается очередь, и игрок врезается в неё раньше, чем сработает сценарий
    if (level.trap) roads[0].traffic = roads[0].traffic.filter(c => c.kind === 'ramp' || c.s < level.trap!.s - 1200);
    chaser = null; copIdx = 0;
    taken = new Set();
    flat = false;
    slow = 0; zoom = 1; flash = null;
    score = 0; fx = []; buzzedPosts = new Set(); jump = null;
    blasts = []; shake = 0; wrecked = false; reveal = null;
    cardIdx = 0; card = null; horned.clear(); introN = 0;
    for (const r of roads) { for (const rl of r.rails) rl.t0 = undefined; for (const c of r.crossings) c.t0 = undefined; } // сценарные поезда и светофоры ждут игрока заново
    ui.overlay.className = '';
    // контрольная точка: после BUSTED продолжаем с неё — машина на оси, время как при прибытии с постоянной скоростью,
    // трафик рядом убран, коп (если уже был) снова на хвосте
    if (cpS > 0) {
      const p = pathAt(roads[0].path, cpS);
      car.x = p.x; car.y = p.y; car.h = heading(p.tx, p.ty); car.vx = p.tx * P.speed.v; car.vy = p.ty * P.speed.v; car.s = cpS;
      timeAlive = cpS / P.speed.v; cam = { x: car.x, y: car.y };
      roads[0].traffic = roads[0].traffic.filter(c => Math.abs(c.s - cpS) > 350);
      cardIdx = (level.cards ?? []).filter(c => c.s <= cpS).length;
      copIdx = Math.max(0, copAts().filter(a => a <= cpS).length - 1); // последняя пройденная точка копа срабатывает снова
    }
    if (firstStart) { firstStart = false; intro = 3; state = 'intro'; ui.overlay.className = 'show intro'; ui.ovTitle.textContent = '3'; ui.ovSub.textContent = level.intro ?? level.name; ui.ovHint.textContent = 'нажми, чтобы начать'; if (ui.ovName) ui.ovName.textContent = level.name; }
  }

  function busted(why: string): void {
    const soft = why === 'вылет с дороги' || why === 'съехал с маршрута' || why === 'ежи';
    sfx(why === 'догнали' ? 'caught' : why === 'поезд' ? 'train' : soft ? 'off' : 'crash');
    // удар — взрыв с дымом и тряска, машина разбита; вылет — только пыль
    if (soft) { for (let i = 0; i < 4; i++) puff(car.x + (Math.random() - 0.5) * 40, car.y + (Math.random() - 0.5) * 40, 70 + Math.random() * 30, 0.9, i * 0.08); shake = 5; }
    else { wrecked = true; shake = 14; boom(car.x, car.y, 170, 1.0); for (let i = 0; i < 3; i++) puff(car.x + (Math.random() - 0.5) * 50, car.y + (Math.random() - 0.5) * 50, 80 + Math.random() * 40, 1.2, 0.25 + i * 0.15); }
    state = 'busted'; ui.overlay.className = 'show busted';
    ui.ovTitle.textContent = 'BUSTED'; ui.ovSub.textContent = why + '\n' + holdText() + `\nочки ${fmtScore(score)}`;
    ui.ovHint.textContent = cpS > 0 ? 'нажми — продолжить с контрольной точки' : 'нажми, чтобы повторить';
  }
  function finish(): void {
    sfx('delivered');
    state = 'done'; cpS = 0; ui.overlay.className = 'show done'; // уровень пройден: повтор — с начала, а не с контрольной точки
    ui.ovTitle.textContent = 'DELIVERED';
    const total = scoreHook ? scoreHook(score * SCORE.finishMul) : null;
    // результат раскрывается по строчкам, слава — последней
    reveal = { lines: [`${timeAlive.toFixed(1)} с`, `очки ${fmtScore(score)}`, `× ${SCORE.finishMul} = ${fmtScore(score * SCORE.finishMul)}`, ...(total !== null ? [`слава ${fmtScore(total)}`] : [])], at: 1, t: 0.45 };
    ui.ovSub.textContent = reveal.lines[0]; // время сразу (харнесс сравнивает первую строку), очки и слава — по строчке
    ui.ovHint.textContent = endHook ? 'нажми — дальше' : 'нажми, чтобы повторить';
  }
  // Ловушка по сценарию: BUSTED с текстом уровня, но это «пройдено» — дальше следующий уровень
  function trap(text: string): void {
    sfx('trap');
    state = 'trap'; cpS = 0; ui.overlay.className = 'show busted trap';
    const total = scoreHook ? scoreHook(score) : null;
    ui.ovTitle.textContent = 'BUSTED'; ui.ovSub.textContent = text + `\nочки ${fmtScore(score)}` + (total !== null ? ` · слава ${fmtScore(total)}` : '');
    ui.ovHint.textContent = 'нажми — дальше';
  }

  // Начислить очки с надписью и искрами у борта машины (side: с какой стороны событие)
  function addScore(pts: number, label: string, side: 1 | -1): void {
    score += pts;
    sfx(label === 'NEAR MISS' ? 'near' : label === 'КОП ВЫБЫЛ' ? 'copOut' : label === 'ТРЮК' ? 'jump' : label === 'ПРОВОКАЦИЯ' ? 'big' : 'score');
    const rx = Math.cos(car.h), ry = Math.sin(car.h);
    const x = car.x + rx * side * (car.W / 2 + 10), y = car.y + ry * side * (car.W / 2 + 10);
    fx.push({ x, y: y - 20, t: 1.1, text: `+${pts} ${label}` });
    for (let k = 0; k < 6; k++) {
      const a = car.h + side * Math.PI / 2 + (k - 2.5) * 0.35;
      fx.push({ x, y, t: 0.45, vx: Math.sin(a) * 260, vy: -Math.cos(a) * 260 });
    }
  }

  // Прогресс по главной дороге, даже если машина на ветке (или на ветке ветки — вверх по родителям)
  function mainS(road: number, s: number): number {
    const r = roads[road];
    return r.def ? mainS(r.parent, parentEquivalent(r.def, r.path, s)) : s;
  }

  // Дорога — та, на чьём асфальте машина. Пока она в пределах текущей, остаётся на ней (прямой проезд через
  // развилку в любой полосе безопасен); вышла за край — в зоне развилки берём дочернюю ветку, на которой стоит,
  // в начале ветки можно вернуться на родителя, в конце ветки возвращаемся на родителя у to (обязательно, когда ветка кончилась)
  function switchRoad(who: { road: number; s: number }, x: number, y: number) {
    const cur = roads[who.road];
    let nr = nearest(cur.path, x, y, who.s);
    const inside = (r: Road, n: { s: number; off: number }) => Math.abs(n.off) <= widthAt(r.width, n.s) / 2 + P.tol.v;
    const ending = !!cur.def && who.s >= cur.path.L - BRANCH.lead;
    if (ending || !inside(cur, nr)) {
      let moved = false;
      for (let i = 1; i < roads.length && !moved; i++) {
        const b = roads[i].def!, L = roads[i].path.L;
        if (roads[i].parent !== who.road) continue;
        // подсказка для поиска на ветке: у развилки — от её начала, у слияния — от её конца (срезал угол и снова на дуге ветки)
        let hint: number | null = null;
        if (who.s >= b.from - BRANCH.lead && who.s <= b.from + BRANCH.zone) hint = who.s - (b.from - BRANCH.lead);
        else if (who.s >= b.to - BRANCH.zone && who.s <= b.to + BRANCH.lead) hint = L - (b.to + BRANCH.lead - who.s);
        if (hint === null) continue;
        const nb = nearest(roads[i].path, x, y, hint);
        if (nb.s > BRANCH.lead && nb.s < L - BRANCH.lead && inside(roads[i], nb)) { who.road = i; nr = nb; moved = true; }
      }
      if (!moved && cur.def) {
        const atStart = who.s < BRANCH.zone + BRANCH.lead, atEnd = who.s > cur.path.L - BRANCH.zone;
        if (atStart || atEnd) {
          const pr = roads[cur.parent];
          const np = nearest(pr.path, x, y, atEnd ? cur.def.to - (cur.path.L - who.s) : cur.def.from - BRANCH.lead + who.s);
          if (ending || inside(pr, np)) { who.road = cur.parent; nr = np; }
        }
      }
    }
    who.s = nr.s;
    return nr;
  }

  // Трафик на развилках (M4 + M5): с родительской дороги уходит на ветку, если впереди полное перекрытие или
  // выпала монетка; в конце ветки возвращается на родителя. Переезд между дорогами — перенос машины из списка в список
  function flowTraffic(): void {
    for (let i = 1; i < roads.length; i++) {
      const br = roads[i], b = br.def!, pr = roads[br.parent];
      pr.traffic = pr.traffic.filter(c => {
        if (c.dir === -1 || c.s < b.from || c.s >= b.from + 40) return true; // встречка на ветки не сворачивает
        const detour = fullBlockAhead(pr.blocks, c.s, TRAFFIC_AI.detourLook) || Math.abs(c.pick) < TRAFFIC_AI.detourShare;
        if (!detour) return true;
        br.traffic.push({ ...c, s: BRANCH.lead + (c.s - b.from), shift: 0 });
        return false;
      });
      br.traffic = br.traffic.filter(c => {
        if (c.dir === -1) return c.s > BRANCH.lead; // встречная на ветке доезжает до её начала и исчезает
        if (c.s < br.path.L - BRANCH.lead) return true;
        pr.traffic.push({ ...c, s: b.to + (c.s - (br.path.L - BRANCH.lead)), shift: 0 });
        return false;
      });
    }
  }

  // Коп выбыл: взрыв поменьше, дым, тряска и короткое слоу-мо — момент, который игра празднует
  function copOut(x: number, y: number): void { boom(x, y, 120, 0.8); puff(x, y, 90, 1.0, 0.3); shake = 8; slow = Math.max(slow, 0.45); }
  function chaserPose() {
    const p = pathAtExt(roads[chaser!.road].path, chaser!.s);
    return { x: p.x + p.nx * chaser!.off, y: p.y + p.ny * chaser!.off, h: heading(p.tx, p.ty) };
  }

  function update(dt: number): void {
    if (state !== 'play') return;
    timeAlive += dt;
    const dir = currentDir();
    trackHold(dir, dt);
    if (jump) {
      jump.t += dt;
      if (jump.t >= RAMP.air) {
        const n = jump.over.size; jump = null; sfx('land'); shake = Math.max(shake, 4);
        // приземление: искры из-под обоих бортов, клубы пыли, потом очки за перелёт
        const rx = Math.cos(car.h), ry = Math.sin(car.h);
        for (const side of [-1, 1]) puff(car.x + rx * side * car.W / 2, car.y + ry * side * car.W / 2, 50, 0.6);
        for (const side of [-1, 1]) for (let k = 0; k < 7; k++) {
          const a = car.h + side * Math.PI / 2 + (k - 3) * 0.3 + Math.PI * 0.15;
          fx.push({ x: car.x + rx * side * car.W / 2, y: car.y + ry * side * car.W / 2, t: 0.5, vx: Math.sin(a) * 300, vy: -Math.cos(a) * 300 });
        }
        if (n) addScore(SCORE.flyOver * n, `ПЕРЕЛЁТ×${n}`, 1);
      }
    }

    // После ежей сцепление — BLOCK.flatGrip: формула та же, меняются только числа
    const grip = flat ? BLOCK.flatGrip : P.grip.v, skidGrip = flat ? BLOCK.flatGrip : P.skidGrip.v;
    // в полёте руль не работает: та же формула, ввод 0
    step(car, jump ? 0 : dir, { speed: P.speed.v, steer: P.steer.v, damp: P.damp.v, grip, spin: P.spin.v, skidGrip, sens: P.sens.v }, dt);
    if (car.skid) marks.push({ x: car.x, y: car.y, a: 1 });
    for (const m of marks) m.a -= dt * 0.4;
    marks = marks.filter(m => m.a > 0).slice(-200);

    const before = car.road, beforeS = car.s, beforeMain = mainS(car.road, car.s);
    const nr = switchRoad(car, car.x, car.y);
    car.off = nr.off;
    // сценарий: контрольные точки, карточки, ловушка, появление копа — по s главной
    const ms = mainS(car.road, car.s);
    for (const c of level.checkpoints ?? []) if (ms >= c && c > cpS) cpS = c;
    if (level.cards && cardIdx < level.cards.length && ms >= level.cards[cardIdx].s) {
      card = CARD_HOLD; sfx('card'); ui.overlay.className = 'show card'; ui.ovTitle.textContent = level.cards[cardIdx].text; ui.ovSub.textContent = ''; ui.ovHint.textContent = ''; cardIdx++;
    }
    if (level.trap && ms >= level.trap.s) return trap(level.trap.text);
    for (const rl of roads[car.road].rails) {
      if (rl.def.after !== undefined && rl.t0 === undefined && car.s >= rl.s) rl.t0 = timeAlive;                       // игрок пересёк рельсы — поезд пошёл
      if (rl.def.before !== undefined && rl.t0 === undefined && car.s >= rl.s - rl.def.before) rl.t0 = timeAlive;     // игрок подъехал — поезд «перед носом» пошёл
    }
    for (const c of roads[car.road].crossings) if (c.def.before !== undefined && c.t0 === undefined && car.s >= c.s - c.def.before) c.t0 = timeAlive; // игрок подъехал — светофор пошёл на красный
    { const ats = copAts(); if (copIdx < ats.length && ms >= ats[copIdx]) { copIdx++; if (!chaser) chaser = { road: car.road, s: car.s - level.chaser!.gap, off: car.off }; } }
    // коп повторяет выбор: свернул на ветку — запомнить; передумал в её начале и вернулся — забыть
    if (car.road !== before) { if (roads[car.road].parent === before) taken.add(car.road); else if (beforeS < BRANCH.zone + BRANCH.lead) taken.delete(before); }
    const rd = roads[car.road];
    score += Math.max(0, mainS(car.road, car.s) - beforeMain) * SCORE.perPx;
    for (const f of fx) { f.t -= dt; if (f.vx !== undefined) { f.x += f.vx * dt; f.y += (f.vy ?? 0) * dt; f.vx *= 0.9; f.vy! *= 0.9; } else f.y -= 40 * dt; }
    fx = fx.filter(f => f.t > 0);

    // Обочина-объезд у полного перекрытия расширяет дорогу с одной стороны
    const wHere = widthAt(rd.width, car.s);
    let limit = wHere / 2 + P.tol.v;
    for (const b of rd.blocks.bypasses) if (car.s >= b.s0 && car.s <= b.s1 && Math.sign(car.off) === b.side) limit += BLOCK.bypassW;
    if (!jump && Math.abs(car.off) > limit) {
      if (flat) return busted('ежи');
      // Дорога под колёсами есть, но это другой участок маршрута (срезал кольцо, выехал на встречный рукав)
      const onOther = roads.some(r => { const n = nearestGlobal(r.path, car.x, car.y); return Math.abs(n.off) <= widthAt(r.width, n.s) / 2 + P.tol.v; });
      return busted(onOther ? 'съехал с маршрута' : 'вылет с дороги');
    }
    if (car.road === 0 && car.s >= rd.path.L - 60) return finish();

    for (const r of roads) {
      // на красный и жёлтый трафик встаёт перед перекрёстком
      const red = r.crossings.filter(c => lightAt(c, timeAlive) !== 'green');
      const stops = red.map(c => c.s - c.w / 2), stopsBack = red.map(c => c.s + c.w / 2);
      r.traffic = moveTraffic(r.traffic, r.path, dt, { layout: r.blocks, width: r.width, playerS: r === rd ? car.s : undefined, playerL: car.L, stops, stopsBack, oncoming: r.oncoming });
    }
    if (roads.length > 1) flowTraffic();
    const me = obb(car.x, car.y, car.h, car.W, car.L);
    // Заезд на рампу сзади, ровно и быстрее грузовика — прыжок (M8); с борта или под углом — обычное столкновение
    if (!jump) for (const c of rd.traffic) {
      if (c.kind !== 'ramp' || Math.abs(c.s - car.s) > 120) continue;
      const p = vehiclePose(rd.path, c, rd.width);
      let dh = car.h - p.h; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
      const rearOk = car.s < c.s && car.s + car.L / 2 >= c.s - c.L / 2;
      const off = laneOff(widthAt(rd.width, c.s), c.lane) + c.shift;
      const fits = Math.abs(car.off - off) <= (c.W - car.W) / 2 + RAMP.fit;
      if (rearOk && fits && Math.abs(dh) < RAMP.alignDeg * Math.PI / 180 && P.speed.v - c.v >= RAMP.minRel) {
        jump = { t: 0, over: new Set() }; addScore(SCORE.jump, 'ТРЮК', 1); break;
      }
    }
    if (jump) {
      // в полёте ничего не задевает, но всё, над чем пролетели, — в копилку
      for (const r of roads) for (const c of r.traffic) { if (c.kind === 'ramp' || (r === rd ? Math.abs(c.s - car.s) >= 120 : false)) continue; const p = vehiclePose(r.path, c, r.width); if ((r === rd || (p.x - car.x) ** 2 + (p.y - car.y) ** 2 < NEAR * NEAR) && hit(me, obb(p.x, p.y, p.h, c.W, c.L))) jump.over.add(c); }
      for (const o of rd.solids) if (Math.abs(o.s - car.s) < 400 && hit(me, o.obb)) jump.over.add(o);
      for (const r of rd.rails) { const t = trainObb(r, timeAlive); if (t && Math.abs(r.s - car.s) < 200 && hit(me, t)) jump.over.add(r); }
      for (const r of roads) for (const c of r.crossings) if (r === rd ? Math.abs(c.s - car.s) < 200 : (c.x - car.x) ** 2 + (c.y - car.y) ** 2 < 400 * 400) for (const cc of crossCars(c, timeAlive)) if (hit(me, cc.obb)) jump.over.add(c);
    } else {
      // Паникёр, пока мечется, не убивает игрока — провокация награда, а не ловушка; вставший у края — обычное препятствие
      // трафик всех дорог: на общем заходе развилки машина, уже переданная на ветку, для игрока на главной — не призрак
      for (const r of roads) if (collides(r.traffic.filter(c => !(c.panic && !c.crashed) && !(c.kind === 'ramp' && (r !== rd || car.s < c.s))), r.path, r.width, me, r === rd ? car : { x: car.x, y: car.y })) return busted('столкновение');
      for (const o of rd.solids) if (Math.abs(o.s - car.s) < 400 && hit(me, o.obb)) return busted(o.why);
      for (const r of rd.rails) { const t = trainObb(r, timeAlive); if (t && Math.abs(r.s - car.s) < 200 && hit(me, t)) return busted('поезд'); }
      for (const r of roads) for (const c of r.crossings) if (r === rd ? Math.abs(c.s - car.s) < 200 : (c.x - car.x) ** 2 + (c.y - car.y) ** 2 < 400 * 400) for (const cc of crossCars(c, timeAlive)) if (hit(me, cc.obb)) return busted('перекрёсток');
    }
    // Гудок поезда за RAIL.warn с до переезда, раз на проход состава, если переезд недалеко
    for (const r of rd.rails) {
      const u = untilTrain(r, timeAlive);
      if (u < RAIL.warn && Math.abs(r.s - car.s) < 1000) { if (!horned.has(r)) { horned.add(r); sfx('horn'); } }
      else if (u === Infinity || u > RAIL.warn + 1) horned.delete(r);
    }
    // Поезд сносит трафик на переезде
    for (const r of rd.rails) {
      const t = trainObb(r, timeAlive); if (!t) continue;
      for (const c of rd.traffic) if (!c.crashed && Math.abs(c.s - r.s) < 80) { const p = vehiclePose(rd.path, c, rd.width); if (hit(t, obb(p.x, p.y, p.h, c.W, c.L))) { c.crashed = true; c.v = 0; } }
    }
    // Проезд впритирку (M2): Near Miss, один на машину; с шансом level.panic водитель ещё и пугается (M3)
    for (const c of rd.traffic) {
      if (c.buzzed || c.crashed || c.kind === 'ramp' || jump || Math.abs(c.s - car.s) > 120) continue;
      const side = brushSide(car.off, car.W, car.s, car.L, c, rd.width, PANIC.margin);
      if (!side) continue;
      c.buzzed = true;
      addScore(SCORE.nearMiss, 'NEAR MISS', side);
      if (!level.panic || P.speed.v - c.v < PANIC.minRel) continue;
      const coin = ((Math.sin(c.pick * 91.7 + level.seed) * 10000) % 1 + 1) % 1;
      if (coin < level.panic) { c.panic = { side }; slow = PANIC.slow; sfx('panic'); }
    }
    // Впритирку к полицейской машине поста — дороже: она стоит поперёк, её длина — вдоль ширины дороги
    rd.blocks.police.forEach((p, i) => {
      const key = `${car.road}:${i}`;
      if (buzzedPosts.has(key) || Math.abs(p.s - car.s) > (car.L + p.w) / 2) return;
      const off = laneOff(widthAt(rd.width, p.s), p.lane), gap = Math.abs(off - car.off) - (car.W + p.l) / 2;
      if (gap < 0 || gap > PANIC.margin) return;
      buzzedPosts.add(key);
      addScore(SCORE.nearPolice, 'КОП', off > car.off ? 1 : -1);
    });
    // Спровоцированный паникёр встал в отбойник — очки за тактику
    for (const c of rd.traffic) if (c.panic && c.crashed && !c.scored) { c.scored = true; addScore(SCORE.panic, 'ПРОВОКАЦИЯ', c.panic.side); }
    if (!jump && !flat) for (const sp of rd.blocks.spikes) {
      if (Math.abs(sp.s - car.s) > 120 || !hit(me, obb(sp.x, sp.y, sp.h, sp.w, sp.l))) continue;
      // Ежи: сцепления больше нет, машину сносит к ближайшему кювету
      flat = true; car.skid = true; sfx('spikes');
      const side = car.off >= 0 ? 1 : -1;
      car.vx += nr.p.nx * side * BLOCK.flatKick; car.vy += nr.p.ny * side * BLOCK.flatKick;
    }

    if (chaser) {
      const cr = roads[chaser.road];
      // В повороте коп идёт по линии шириной CHASER_LINE и теряет ход, как приличный водитель; на прямой — нет
      const line = Math.max(0.5, 1 - CHASER_LINE * curvatureAt(cr.path, Math.max(0, chaser.s)));
      chaser.s += P.speed.v * level.chaser!.speed * line * dt;
      // Коп повторяет выбор игрока на развилках и возвращается на родительскую дорогу в конце ветки
      let turned = false;
      for (let i = 1; i < roads.length; i++) {
        const b = roads[i].def!;
        if (roads[i].parent === chaser.road && taken.has(i) && chaser.s >= b.from && chaser.s < b.from + BRANCH.zone) { chaser.road = i; chaser.s = BRANCH.lead + (chaser.s - b.from); turned = true; break; }
      }
      if (!turned && cr.def && chaser.s >= cr.path.L - BRANCH.lead) {
        chaser.s = cr.def.to + (chaser.s - (cr.path.L - BRANCH.lead)); chaser.road = cr.parent;
      }
      chaser.off += (car.off - chaser.off) * Math.min(1, CHASER_FOLLOW * dt);
      const lim = widthAt(cr.width, Math.max(0, chaser.s)) / 2 - TRAFFIC_SIZE.W / 2;
      chaser.off = Math.max(-lim, Math.min(lim, chaser.off));
      const c = chaserPose();
      const cop = obb(c.x, c.y, c.h, TRAFFIC_SIZE.W, TRAFFIC_SIZE.L);
      if (!jump && chaser.road === car.road && hit(me, cop)) return busted('догнали');
      // Коп под поездом или под поперечной машиной
      for (const r of cr.rails) { const t = trainObb(r, timeAlive); if (t && Math.abs(r.s - chaser.s) < 120 && hit(cop, t)) { chaser = null; copOut(c.x, c.y); flash = { text: 'коп под поездом', t: 1.5 }; addScore(SCORE.copOut, 'КОП ВЫБЫЛ', 1); break; } }
      if (chaser) for (const c of cr.crossings) { if (Math.abs(c.s - chaser.s) > 120) continue; if (crossCars(c, timeAlive).some(cc => hit(cop, cc.obb))) { const cp = chaserPose(); chaser = null; copOut(cp.x, cp.y); flash = { text: 'коп на перекрёстке', t: 1.5 }; addScore(SCORE.copOut, 'КОП ВЫБЫЛ', 1); break; } }
      if (!chaser) { const vl0 = Math.hypot(car.vx, car.vy) || 1; const cl0 = Math.min(1, CAM_LERP * dt); cam.x += (car.x + car.vx / vl0 * CAM_AHEAD - cam.x) * cl0; cam.y += (car.y + car.vy / vl0 * CAM_AHEAD - cam.y) * cl0; return; }
      // Паникёр снёс копа — полиция выбывает из погони
      for (const v of cr.traffic) {
        if (!v.panic || Math.abs(v.s - chaser.s) > 120) continue;
        const p = vehiclePose(cr.path, v, cr.width);
        if (hit(cop, obb(p.x, p.y, p.h, v.W, v.L))) { chaser = null; copOut(c.x, c.y); v.crashed = true; v.v = 0; v.scored = true; flash = { text: 'коп выбыл', t: 1.5 }; addScore(SCORE.copOut, 'КОП ВЫБЫЛ', v.panic.side); break; }
      }
    }

    // Камера: точка впереди по вектору скорости (не курса), плавный догон
    const vl = Math.hypot(car.vx, car.vy) || 1;
    const tx = car.x + car.vx / vl * CAM_AHEAD, ty = car.y + car.vy / vl * CAM_AHEAD;
    const cl = Math.min(1, CAM_LERP * dt);
    cam.x += (tx - cam.x) * cl; cam.y += (ty - cam.y) * cl;
  }

  const restart = () => {
    if (state === 'intro') { intro = null; state = 'play'; ui.overlay.className = ''; return; } // тап пропускает отсчёт
    if (card !== null) return;                                                                      // карточку тапом не снять: игрок должен её увидеть (решение 2026-09-10)
    if (state === 'play') return;
    if ((state === 'done' || state === 'trap') && endHook && endHook(state)) return;             // кампания загрузила следующий
    reset();
  };
  const onOverlay = (e: PointerEvent) => { e.preventDefault(); restart(); };
  const disposeInput = initInput({ left: ui.left, right: ui.right }, restart);
  ui.overlay.addEventListener('pointerdown', onOverlay);
  addEventListener('resize', resize); resize();

  let raf = 0, last = performance.now(), hudT = 0;
  function frame(now: number): void {
    const dt = Math.min(MAX_DT, (now - last) / 1000); last = now;
    // слоу-мо провокации: мир идёт медленнее, камера чуть ближе; формула физики та же, меняется только dt
    if (slow > 0) slow -= dt;
    zoom += ((slow > 0 ? PANIC.zoom : 1) - zoom) * Math.min(1, 8 * dt);
    if (flash) { flash.t -= dt; if (flash.t <= 0) flash = null; }
    // вспышки и тряска идут всегда (и после BUSTED), строки DELIVERED раскрываются по таймеру
    for (const b of blasts) b.age += dt; blasts = blasts.filter(b => b.age < b.dur);
    if (shake > 0) shake = Math.max(0, shake - dt * 30);
    if (reveal) { reveal.t -= dt; if (reveal.t <= 0 && reveal.at < reveal.lines.length) { ui.ovSub.textContent = reveal.lines.slice(0, ++reveal.at).join('\n'); reveal.t = 0.4; sfx(reveal.at === reveal.lines.length ? 'big' : 'score'); } }
    // отсчёт и карточка: мир стоит
    if (intro !== null && !paused) { intro -= dt; const n = Math.ceil(intro); if (n !== introN) { introN = n; sfx(n > 0 ? 'beep' : 'go'); } ui.ovTitle.textContent = n > 0 ? String(n) : 'GO'; if (intro <= 0) { intro = null; state = 'play'; ui.overlay.className = ''; } }
    else if (card !== null && !paused) { card -= dt; if (card <= 0) { card = null; ui.overlay.className = ''; } }
    else if (!paused) update(slow > 0 ? dt * PANIC.slowScale : dt);
    // Хвост считаем по главной дороге, чтобы сравнивать положение на разных ветках
    const tail = chaser ? mainS(car.road, car.s) - mainS(chaser.road, chaser.s) : undefined;
    // звук: мотор, пока мир идёт; сирена — пока коп на хвосте, громче с близостью
    sfxEngine(state === 'play' && !paused && intro === null && card === null, P.speed.v, Math.abs(car.w) / P.spin.v, car.skid, !!jump, slow > 0);
    sfxSiren(chaser && state === 'play' ? Math.max(0, 1 - tail! / level.chaser!.gap) : 0);
    const scene: RoadScene[] = roads.map(r => ({ path: r.path, traffic: r.traffic, blocks: r.blocks, width: r.width, rails: r.rails, crossings: r.crossings, oncoming: r.oncoming, from: r.def?.from, parent: r.def ? r.parent : undefined }));
    render(ctx, view, {
      roads: scene, car, spec, marks, cam, t: timeAlive, zoom, fx, air: jump ? jump.t / RAMP.air : undefined, props: level.props, nav: level.nav,
      chaser: chaser ? { ...chaserPose(), danger: 1 - tail! / level.chaser!.gap } : undefined,
      blasts, shake, wrecked,
    });
    hudT += dt;
    if (hudT > 0.1) {
      hudT = 0;
      const prog = mainS(car.road, car.s) / roads[0].path.L;
      ui.hud.innerHTML = hudHtml(`${level.name} · ${spec.name}`, prog, car, tail, score) + (flash ? ` <b>${flash.text}</b>` : '');
      // игровой HUD: очки крупно, метка машины на полосе маршрута, шкала копа по близости, событие
      if (ui.gscore) ui.gscore.textContent = fmtScore(score);
      const pct = `${Math.max(0, Math.min(100, prog * 100)).toFixed(1)}%`;
      if (ui.barFill?.style) ui.barFill.style.width = pct;
      if (ui.barCar?.style) ui.barCar.style.left = pct;
      if (ui.cop?.classList) ui.cop.classList.toggle('on', !!chaser && state === 'play');
      if (ui.copFill?.style) ui.copFill.style.width = `${Math.round(Math.max(0, Math.min(1, chaser ? 1 - tail! / level.chaser!.gap : 0)) * 100)}%`;
      if (ui.gflash) ui.gflash.textContent = flash ? flash.text : '';
    }
    raf = requestAnimationFrame(frame);
  }
  load(first);
  raf = requestAnimationFrame(frame);

  return {
    load, reset,
    onEnd(hook) { endHook = hook; },
    onScore(hook) { scoreHook = hook; },
    pause(on) { paused = on; },
    stop() {
      cancelAnimationFrame(raf);
      disposeInput();
      ui.overlay.removeEventListener('pointerdown', onOverlay);
      removeEventListener('resize', resize);
    },
  };
}
