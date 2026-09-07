// Одна попытка: состояние, обновление, цикл. Используется игрой (main.ts) и редактором («Играть»).
import { BLOCK, BRANCH, CAM_AHEAD, CAM_LERP, CHASER_FOLLOW, CHASER_LINE, MAX_DT, P, PANIC, SCORE, TRAFFIC_AI, TRAFFIC_SIZE } from './config';
import { carByKey, type CarSpec } from './cars';
import { step, type CarState } from './physics';
import { buildPath, curvatureAt, heading, laneOff, nearest, nearestGlobal, pathAt, pathAtExt, type Path } from './road';
import { buildBranchPath, mainEquivalent, type BranchDef } from './roads';
import { layoutBlocks, type Block, type Layout } from './blocks';
import { brushSide, collides, fullBlockAhead, hit, moveTraffic, obb, spawnTraffic, vehiclePose, type Obb, type TrafficCar, type Vehicle } from './traffic';
import { currentDir, holdText, initInput, resetHold, trackHold } from './input';
import { fmtScore, hudHtml, render, type Cam, type Fx, type Mark, type RoadScene } from './render';
import type { LevelData } from './levels';

export interface GameUI {
  canvas: HTMLCanvasElement;
  hud: HTMLElement;
  overlay: HTMLElement;
  ovTitle: HTMLElement;
  ovSub: HTMLElement;
  left: HTMLElement;
  right: HTMLElement;
}

export interface Game {
  load(level: LevelData): void;
  reset(): void;
  pause(on: boolean): void; // меню открыто — мир стоит, кадр рисуется
  stop(): void;
}

type State = 'play' | 'busted' | 'done';
type Car = CarState & { s: number; off: number; W: number; L: number; road: number };

// Дорога графа: 0 — главная, дальше ветки. Всё, что живёт на дороге, лежит здесь
interface Road {
  path: Path;
  def: BranchDef | null;   // null — главная
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
  let buzzedPosts: Set<string>; // «дорога:индекс» полицейских машин постов, к которым уже прижимались

  function makeRoad(path: Path, def: BranchDef | null, blocks: Block[] | undefined, cars: TrafficCar[] | undefined): Road {
    const layout = layoutBlocks(path, P.width.v, blocks);
    return {
      path, def, blocks: layout, cars: cars ?? [], traffic: [],
      solids: [
        ...layout.police.map(b => ({ obb: obb(b.x, b.y, b.h, b.w, b.l), s: b.s, why: 'врезался в пост' })),
        ...layout.works.map(b => ({ obb: obb(b.x, b.y, b.h, b.w, b.l), s: b.s, why: 'заграждение' })),
      ],
    };
  }

  function load(l: LevelData): void {
    level = l;
    spec = carByKey(l.car);
    // Машина и уровень задают стартовые значения, слайдеры панели тюнинга дальше крутят их поверх
    P.width.v = l.width; P.traffic.v = l.traffic;
    P.speed.v = spec.speed; P.steer.v = spec.steer; P.damp.v = spec.damp; P.grip.v = spec.grip; P.spin.v = spec.spin; P.skidGrip.v = spec.skidGrip;
    const main = buildPath(l.points);
    roads = [makeRoad(main, null, l.blocks, l.cars)];
    for (const b of l.branches ?? []) roads.push(makeRoad(buildBranchPath(main, b), b, b.blocks, b.cars));
    reset();
  }

  function reset(): void {
    const p0 = pathAt(roads[0].path, 0);
    car = { x: p0.x, y: p0.y, h: heading(p0.tx, p0.ty), w: 0, vx: p0.tx * P.speed.v, vy: p0.ty * P.speed.v, s: 0, off: 0, skid: false, W: spec.W, L: spec.L, road: 0 };
    marks = [];
    cam = { x: car.x, y: car.y };
    state = 'play'; timeAlive = 0; resetHold();
    roads.forEach((r, i) => { r.traffic = spawnTraffic(r.path, P.traffic.v, P.speed.v, level.seed + i * 7919, r.cars, r.blocks); });
    chaser = level.chaser ? { road: 0, s: -level.chaser.gap, off: 0 } : null;
    taken = new Set();
    flat = false;
    slow = 0; zoom = 1; flash = null;
    score = 0; fx = []; buzzedPosts = new Set();
    ui.overlay.className = '';
  }

  function busted(why: string): void {
    state = 'busted'; ui.overlay.className = 'show busted';
    ui.ovTitle.textContent = 'BUSTED'; ui.ovSub.textContent = why + '\n' + holdText() + `\nочки ${fmtScore(score)}`;
  }
  function finish(): void {
    state = 'done'; ui.overlay.className = 'show';
    ui.ovTitle.textContent = 'DELIVERED';
    ui.ovSub.textContent = `${timeAlive.toFixed(1)} с · очки ${fmtScore(score)} × ${SCORE.finishMul} = ${fmtScore(score * SCORE.finishMul)}`;
  }

  // Начислить очки с надписью и искрами у борта машины (side: с какой стороны событие)
  function addScore(pts: number, label: string, side: 1 | -1): void {
    score += pts;
    const rx = Math.cos(car.h), ry = Math.sin(car.h);
    const x = car.x + rx * side * (car.W / 2 + 10), y = car.y + ry * side * (car.W / 2 + 10);
    fx.push({ x, y: y - 20, t: 1.1, text: `+${pts} ${label}` });
    for (let k = 0; k < 6; k++) {
      const a = car.h + side * Math.PI / 2 + (k - 2.5) * 0.35;
      fx.push({ x, y, t: 0.45, vx: Math.sin(a) * 260, vy: -Math.cos(a) * 260 });
    }
  }

  // Прогресс по главной дороге, даже если машина на ветке
  function mainS(road: number, s: number): number {
    const r = roads[road];
    return r.def ? mainEquivalent(r.def, r.path, s) : s;
  }

  // Развилка: в зоне после from сравниваем близость к главной и к ветке, ближняя побеждает.
  // Слияние: в зоне перед концом ветки возвращаемся на главную у to.
  function switchRoad(who: { road: number; s: number }, x: number, y: number) {
    let nr = nearest(roads[who.road].path, x, y, who.s);
    if (who.road === 0) {
      for (let i = 1; i < roads.length; i++) {
        const b = roads[i].def!;
        if (who.s < b.from - BRANCH.lead || who.s > b.from + BRANCH.zone) continue;
        const nb = nearest(roads[i].path, x, y, who.s - (b.from - BRANCH.lead));
        if (nb.s > BRANCH.lead && Math.abs(nb.off) < Math.abs(nr.off)) { who.road = i; nr = nb; }
      }
    } else {
      const r = roads[who.road], b = r.def!;
      if (who.s > r.path.L - BRANCH.zone) {
        const nm = nearest(roads[0].path, x, y, b.to - (r.path.L - who.s));
        if (Math.abs(nm.off) <= Math.abs(nr.off) || who.s >= r.path.L - BRANCH.lead) { who.road = 0; nr = nm; }
      }
    }
    who.s = nr.s;
    return nr;
  }

  // Трафик на развилках (M4 + M5): с главной уходит на ветку, если впереди полное перекрытие или выпала монетка;
  // в конце ветки возвращается на главную. Переезд между дорогами — перенос машины из одного списка в другой
  function flowTraffic(): void {
    const main = roads[0];
    for (let i = 1; i < roads.length; i++) {
      const br = roads[i], b = br.def!;
      main.traffic = main.traffic.filter(c => {
        if (c.s < b.from || c.s >= b.from + 40) return true;
        const detour = fullBlockAhead(main.blocks, c.s, TRAFFIC_AI.detourLook) || Math.abs(c.pick) < TRAFFIC_AI.detourShare;
        if (!detour) return true;
        br.traffic.push({ ...c, s: BRANCH.lead + (c.s - b.from), shift: 0 });
        return false;
      });
      br.traffic = br.traffic.filter(c => {
        if (c.s < br.path.L - BRANCH.lead) return true;
        main.traffic.push({ ...c, s: b.to + (c.s - (br.path.L - BRANCH.lead)), shift: 0 });
        return false;
      });
    }
  }

  function chaserPose() {
    const p = pathAtExt(roads[chaser!.road].path, chaser!.s);
    return { x: p.x + p.nx * chaser!.off, y: p.y + p.ny * chaser!.off, h: heading(p.tx, p.ty) };
  }

  function update(dt: number): void {
    if (state !== 'play') return;
    timeAlive += dt;
    const dir = currentDir();
    trackHold(dir, dt);

    // После ежей сцепление — BLOCK.flatGrip: формула та же, меняются только числа
    const grip = flat ? BLOCK.flatGrip : P.grip.v, skidGrip = flat ? BLOCK.flatGrip : P.skidGrip.v;
    step(car, dir, { speed: P.speed.v, steer: P.steer.v, damp: P.damp.v, grip, spin: P.spin.v, skidGrip, sens: P.sens.v }, dt);
    if (car.skid) marks.push({ x: car.x, y: car.y, a: 1 });
    for (const m of marks) m.a -= dt * 0.4;
    marks = marks.filter(m => m.a > 0).slice(-200);

    const before = car.road, beforeMain = mainS(car.road, car.s);
    const nr = switchRoad(car, car.x, car.y);
    car.off = nr.off;
    if (car.road !== before && car.road !== 0) taken.add(car.road);
    const rd = roads[car.road];
    score += Math.max(0, mainS(car.road, car.s) - beforeMain) * SCORE.perPx;
    for (const f of fx) { f.t -= dt; if (f.vx !== undefined) { f.x += f.vx * dt; f.y += (f.vy ?? 0) * dt; f.vx *= 0.9; f.vy! *= 0.9; } else f.y -= 40 * dt; }
    fx = fx.filter(f => f.t > 0);

    // Обочина-объезд у полного перекрытия расширяет дорогу с одной стороны
    let limit = P.width.v / 2 + P.tol.v;
    for (const b of rd.blocks.bypasses) if (car.s >= b.s0 && car.s <= b.s1 && Math.sign(car.off) === b.side) limit += BLOCK.bypassW;
    if (Math.abs(car.off) > limit) {
      if (flat) return busted('ежи');
      // Дорога под колёсами есть, но это другой участок маршрута (срезал кольцо, выехал на встречный рукав)
      const onOther = roads.some(r => Math.abs(nearestGlobal(r.path, car.x, car.y).off) <= P.width.v / 2 + P.tol.v);
      return busted(onOther ? 'съехал с маршрута' : 'вылет с дороги');
    }
    if (car.road === 0 && car.s >= rd.path.L - 60) return finish();

    for (const r of roads) r.traffic = moveTraffic(r.traffic, r.path, dt, { layout: r.blocks, width: P.width.v, playerS: r === rd ? car.s : undefined, playerL: car.L });
    if (roads.length > 1) flowTraffic();
    const me = obb(car.x, car.y, car.h, car.W, car.L);
    // Паникёр, пока мечется, не убивает игрока — провокация награда, а не ловушка; вставший у края — обычное препятствие
    if (collides(rd.traffic.filter(c => !(c.panic && !c.crashed)), rd.path, P.width.v, me, car.s)) return busted('столкновение');
    for (const o of rd.solids) if (Math.abs(o.s - car.s) < 400 && hit(me, o.obb)) return busted(o.why);
    // Проезд впритирку (M2): Near Miss, один на машину; с шансом level.panic водитель ещё и пугается (M3)
    for (const c of rd.traffic) {
      if (c.buzzed || c.crashed || Math.abs(c.s - car.s) > 120) continue;
      const side = brushSide(car.off, car.W, car.s, car.L, c, P.width.v, PANIC.margin);
      if (!side) continue;
      c.buzzed = true;
      addScore(SCORE.nearMiss, 'NEAR MISS', side);
      if (!level.panic || P.speed.v - c.v < PANIC.minRel) continue;
      const coin = ((Math.sin(c.pick * 91.7 + level.seed) * 10000) % 1 + 1) % 1;
      if (coin < level.panic) { c.panic = { side }; slow = PANIC.slow; }
    }
    // Впритирку к полицейской машине поста — дороже: она стоит поперёк, её длина — вдоль ширины дороги
    rd.blocks.police.forEach((p, i) => {
      const key = `${car.road}:${i}`;
      if (buzzedPosts.has(key) || Math.abs(p.s - car.s) > (car.L + p.w) / 2) return;
      const off = laneOff(P.width.v, p.lane), gap = Math.abs(off - car.off) - (car.W + p.l) / 2;
      if (gap < 0 || gap > PANIC.margin) return;
      buzzedPosts.add(key);
      addScore(SCORE.nearPolice, 'КОП', off > car.off ? 1 : -1);
    });
    // Спровоцированный паникёр встал в отбойник — очки за тактику
    for (const c of rd.traffic) if (c.panic && c.crashed && !c.scored) { c.scored = true; addScore(SCORE.panic, 'ПРОВОКАЦИЯ', c.panic.side); }
    if (!flat) for (const sp of rd.blocks.spikes) {
      if (Math.abs(sp.s - car.s) > 120 || !hit(me, obb(sp.x, sp.y, sp.h, sp.w, sp.l))) continue;
      // Ежи: сцепления больше нет, машину сносит к ближайшему кювету
      flat = true; car.skid = true;
      const side = car.off >= 0 ? 1 : -1;
      car.vx += nr.p.nx * side * BLOCK.flatKick; car.vy += nr.p.ny * side * BLOCK.flatKick;
    }

    if (chaser) {
      const cr = roads[chaser.road];
      // В повороте коп идёт по линии шириной CHASER_LINE и теряет ход, как приличный водитель; на прямой — нет
      const line = Math.max(0.5, 1 - CHASER_LINE * curvatureAt(cr.path, Math.max(0, chaser.s)));
      chaser.s += P.speed.v * level.chaser!.speed * line * dt;
      // Коп повторяет выбор игрока на развилках и возвращается на главную в конце ветки
      if (chaser.road === 0) {
        for (let i = 1; i < roads.length; i++) {
          const b = roads[i].def!;
          if (taken.has(i) && chaser.s >= b.from && chaser.s < b.from + BRANCH.zone) { chaser.road = i; chaser.s = BRANCH.lead + (chaser.s - b.from); break; }
        }
      } else if (chaser.s >= cr.path.L - BRANCH.lead) {
        chaser.s = cr.def!.to + (chaser.s - (cr.path.L - BRANCH.lead)); chaser.road = 0;
      }
      chaser.off += (car.off - chaser.off) * Math.min(1, CHASER_FOLLOW * dt);
      const lim = P.width.v / 2 - TRAFFIC_SIZE.W / 2;
      chaser.off = Math.max(-lim, Math.min(lim, chaser.off));
      const c = chaserPose();
      const cop = obb(c.x, c.y, c.h, TRAFFIC_SIZE.W, TRAFFIC_SIZE.L);
      if (chaser.road === car.road && hit(me, cop)) return busted('догнали');
      // Паникёр снёс копа — полиция выбывает из погони
      for (const v of cr.traffic) {
        if (!v.panic || Math.abs(v.s - chaser.s) > 120) continue;
        const p = vehiclePose(cr.path, v, P.width.v);
        if (hit(cop, obb(p.x, p.y, p.h, v.W, v.L))) { chaser = null; v.crashed = true; v.v = 0; v.scored = true; flash = { text: 'коп выбыл', t: 1.5 }; addScore(SCORE.copOut, 'КОП ВЫБЫЛ', v.panic.side); break; }
      }
    }

    // Камера: точка впереди по вектору скорости (не курса), плавный догон
    const vl = Math.hypot(car.vx, car.vy) || 1;
    const tx = car.x + car.vx / vl * CAM_AHEAD, ty = car.y + car.vy / vl * CAM_AHEAD;
    const cl = Math.min(1, CAM_LERP * dt);
    cam.x += (tx - cam.x) * cl; cam.y += (ty - cam.y) * cl;
  }

  const restart = () => { if (state !== 'play') reset(); };
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
    if (!paused) update(slow > 0 ? dt * PANIC.slowScale : dt);
    // Хвост считаем по главной дороге, чтобы сравнивать положение на разных ветках
    const tail = chaser ? mainS(car.road, car.s) - mainS(chaser.road, chaser.s) : undefined;
    const scene: RoadScene[] = roads.map(r => ({ path: r.path, traffic: r.traffic, blocks: r.blocks }));
    render(ctx, view, {
      roads: scene, width: P.width.v, car, spec, marks, cam, t: timeAlive, zoom, fx,
      chaser: chaser ? { ...chaserPose(), danger: 1 - tail! / level.chaser!.gap } : undefined,
    });
    hudT += dt;
    if (hudT > 0.1) { hudT = 0; ui.hud.innerHTML = hudHtml(`${level.name} · ${spec.name}`, mainS(car.road, car.s) / roads[0].path.L, car, tail, score) + (flash ? ` <b>${flash.text}</b>` : ''); }
    raf = requestAnimationFrame(frame);
  }
  load(first);
  raf = requestAnimationFrame(frame);

  return {
    load, reset,
    pause(on) { paused = on; },
    stop() {
      cancelAnimationFrame(raf);
      disposeInput();
      ui.overlay.removeEventListener('pointerdown', onOverlay);
      removeEventListener('resize', resize);
    },
  };
}
