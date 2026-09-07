// Холст редактора: панорама, зум (колесо/пинч), точки сплайна и явные машины трафика.
// Дорога и машины рисуются теми же drawRoad/drawCar, что и в игре.
import { lanesFor } from '../road';
import { buildPath, nearestGlobal, pathAtExt, type Path, type Pt } from '../road';
import { drawBlocks, drawCar, drawCrossingRoad, drawCrossingTop, drawGrid, drawPolice, drawProps, drawRails, drawRamp, drawRoad } from '../render';
import { layoutRails } from '../rails';
import { layoutCrossings } from '../crossings';
import { layoutBlocks } from '../blocks';
import { buildBranchPath } from '../roads';
import { makeWidthFn, widthAt } from '../narrow';
import { spawnTraffic, vehiclePose, type TrafficCar, type Vehicle } from '../traffic';
import type { LevelData } from '../levels';
import { carByKey } from '../cars';
import { drawPlayer } from '../render';

// b — индекс ветки для точки ветки (−1 — главная дорога)
export type Sel = { kind: 'point'; i: number; b: number } | { kind: 'car'; i: number } | null;

export interface CanvasHooks {
  level(): LevelData;
  selected(): Sel;
  select(s: Sel): void;
  carMode(): boolean; // липкий Shift для тач-экранов
  addPoint(p: Pt): void;
  movePoint(b: number, i: number, p: Pt): void;   // b = −1 — главная, иначе ветка
  removePoint(b: number, i: number): void;
  addCar(c: TrafficCar): void;
  moveCar(i: number, c: TrafficCar): void;
  removeCar(i: number): void;
}

export interface EditorCanvas {
  draw(): void;
  fit(): void; // показать все точки целиком
}

const HANDLE = 8;        // радиус точки на экране, px
const LONG_PRESS = 600;  // мс до удаления
const ZOOM_MIN = 0.05, ZOOM_MAX = 4;

export function initCanvas(cv: HTMLCanvasElement, h: CanvasHooks): EditorCanvas {
  const ctx = cv.getContext('2d')!;
  let W = 0, H = 0, DPR = 1;
  const cam = { x: 0, y: -400 };
  let zoom = 0.5;

  // Кэш последней отрисовки — им же пользуется хит-тест
  let path: Path | null = null;
  let explicit: Vehicle[] = [];

  const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  const toWorld = (sx: number, sy: number): Pt => [(sx - W / 2) / zoom + cam.x, (sy - H / 2) / zoom + cam.y];
  const toScreen = (p: Pt): Pt => [(p[0] - cam.x) * zoom + W / 2, (p[1] - cam.y) * zoom + H / 2];

  function resize(): void {
    DPR = Math.min(2, devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    cv.width = W * DPR; cv.height = H * DPR;
    draw();
  }

  function draw(): void {
    const l = h.level();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#15171c'; ctx.fillRect(0, 0, W, H);
    ctx.setTransform(DPR * zoom, 0, 0, DPR * zoom, DPR * (W / 2 - cam.x * zoom), DPR * (H / 2 - cam.y * zoom));
    const [x0, y0] = toWorld(0, 0), [x1, y1] = toWorld(W, H);
    let g = 120; while (g * zoom < 40) g *= 2; // при отдалении сетка укрупняется, а не сливается
    drawGrid(ctx, x0, y0, x1, y1, g, 1 / zoom);

    const pts = l.points;
    const sel = h.selected();
    path = pts.length >= 2 ? buildPath(pts) : null;
    explicit = [];
    if (path) {
      // ветки: под главной, без финиша; их промежуточные точки — синие
      const wMain = makeWidthFn(() => l.width, l.narrows);
      if (l.props?.length) drawProps(ctx, l.props);
      const crossings = layoutCrossings(path, l.crossings, l.width);
      for (const c of crossings) drawCrossingRoad(ctx, c);
      (l.branches ?? []).forEach((b, bi) => {
        try {
          const bp = buildBranchPath(path!, b), wb = makeWidthFn(() => l.width, b.narrows);
          drawRoad(ctx, bp, wb, false, b.oncoming ?? 0);
          if (b.blocks?.length) drawBlocks(ctx, bp, wb, layoutBlocks(bp, wb, b.blocks), 0);
        } catch { /* ветка с from/to вне дороги — не рисуем */ }
        b.points.forEach((p, i) => {
          const on = sel?.kind === 'point' && sel.b === bi && sel.i === i;
          ctx.beginPath(); ctx.arc(p[0], p[1], (on ? HANDLE + 3 : HANDLE) / zoom, 0, 7);
          ctx.fillStyle = '#6fa8ff'; ctx.fill();
          if (on) { ctx.lineWidth = 2 / zoom; ctx.strokeStyle = '#fff'; ctx.stroke(); }
        });
      });
      drawRoad(ctx, path, wMain, true, l.oncoming ?? 0);
      const mainLayout = layoutBlocks(path, wMain, l.blocks);
      if (l.blocks?.length) drawBlocks(ctx, path, wMain, mainLayout, 0);
      if (l.rails?.length) drawRails(ctx, layoutRails(path, l.rails), wMain, 0);
      for (const c of crossings) drawCrossingTop(ctx, c, widthAt(wMain, c.s), 0);
      if (l.chaser) { const p = pathAtExt(path, -l.chaser.gap); ctx.globalAlpha = 0.6; drawPolice(ctx, p.x, p.y, Math.atan2(p.tx, -p.ty), 0); ctx.globalAlpha = 1; }
      // seeded-трафик — полупрозрачно, как ориентир для расстановки явных машин
      ctx.globalAlpha = 0.3;
      const spec = carByKey(l.car);
      for (const c of spawnTraffic(path, l.traffic, spec.speed, l.seed, [], mainLayout, wMain, l.oncoming ?? 0)) { const v = vehiclePose(path, c, wMain); drawCar(ctx, v.x, v.y, v.h, c.W, c.L, c.col, false); }
      ctx.globalAlpha = 1;
      explicit = spawnTraffic(path, 0, spec.speed, l.seed, l.cars ?? []);
      explicit.forEach((c, i) => {
        const v = vehiclePose(path!, c, wMain);
        if (c.kind === 'ramp') drawRamp(ctx, v.x, v.y, v.h, c.W, c.L); else drawCar(ctx, v.x, v.y, v.h, c.W, c.L, c.col, false);
        if (sel?.kind === 'car' && sel.i === i) {
          ctx.save(); ctx.translate(v.x, v.y); ctx.rotate(v.h);
          ctx.lineWidth = 2 / zoom; ctx.strokeStyle = '#fff'; ctx.strokeRect(-c.W / 2 - 4, -c.L / 2 - 4, c.W + 8, c.L + 8);
          ctx.restore();
        }
        if (c.spd === 0) { ctx.fillStyle = '#e04a3a'; ctx.beginPath(); ctx.arc(v.x, v.y, 3 / zoom, 0, 7); ctx.fill(); } // стоящая
      });
      // машина игрока на старте — видно кузов и габарит
      const p0 = path.pt[0]; drawPlayer(ctx, p0.x, p0.y, Math.atan2(p0.tx, -p0.ty), spec);
    }

    // контрольный полигон и точки — поверх дороги, размер не зависит от зума
    ctx.lineWidth = 1 / zoom; ctx.strokeStyle = 'rgba(244,185,66,.35)'; ctx.setLineDash([6 / zoom, 6 / zoom]);
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = `${12 / zoom}px sans-serif`;
    pts.forEach((p, i) => {
      const on = sel?.kind === 'point' && sel.b === -1 && sel.i === i;
      ctx.beginPath(); ctx.arc(p[0], p[1], (on ? HANDLE + 3 : HANDLE) / zoom, 0, 7);
      ctx.fillStyle = i === 0 ? '#6fcf7a' : i === pts.length - 1 ? '#ece9e0' : '#f4b942'; ctx.fill();
      if (on) { ctx.lineWidth = 2 / zoom; ctx.strokeStyle = '#fff'; ctx.stroke(); }
      ctx.fillStyle = 'rgba(236,233,224,.7)'; ctx.fillText(String(i), p[0] + 12 / zoom, p[1] - 10 / zoom);
    });
  }

  function fit(): void {
    const pts = h.level().points;
    if (pts.length === 0) { cam.x = 0; cam.y = -400; zoom = 0.5; draw(); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const pad = h.level().width + 80;
    zoom = clampZoom(Math.min(W / (x1 - x0 + pad * 2), H / (y1 - y0 + pad * 2)));
    cam.x = (x0 + x1) / 2; cam.y = (y0 + y1) / 2;
    draw();
  }

  function zoomAt(sx: number, sy: number, f: number): void {
    const [wx, wy] = toWorld(sx, sy);
    zoom = clampZoom(zoom * f);
    cam.x = wx - (sx - W / 2) / zoom; cam.y = wy - (sy - H / 2) / zoom; // точка под курсором остаётся на месте
    draw();
  }

  // Ближайшая полоса под курсором
  function onRoad(wx: number, wy: number): { s: number; lane: number } | null {
    if (!path) return null;
    const { s, off } = nearestGlobal(path, wx, wy), l = h.level(), w = widthAt(makeWidthFn(() => l.width, l.narrows), s);
    if (Math.abs(off) > w / 2 + 40) return null;
    const n = lanesFor(w);
    const lane = Math.max(0, Math.min(n - 1, Math.round(off / (w / n) + (n - 1) / 2)));
    return { s: Math.round(s), lane };
  }

  // ---------- указатели ----------
  const ptrs = new Map<number, Pt>();
  let mode: 'none' | 'pan' | 'drag' | 'dragCar' | 'pinch' = 'none';
  let dragIdx = -1, dragBranch = -1, moved = false, down: Pt = [0, 0], longTimer = 0, shift = false;
  let pinch = { d: 1, zoom: 1, mid: [0, 0] as Pt, cam: { x: 0, y: 0 } };

  const pos = (e: PointerEvent): Pt => [e.clientX, e.clientY];
  const round = (p: Pt): Pt => [Math.round(p[0]), Math.round(p[1])];
  // Точка под курсором: [ветка (−1 — главная), индекс] или null
  function hitPoint(sx: number, sy: number): [number, number] | null {
    let best: [number, number] | null = null, bd = (HANDLE + 6) ** 2;
    const test = (pts: Pt[], b: number) => {
      for (let i = pts.length - 1; i >= 0; i--) { const [x, y] = toScreen(pts[i]); const d = (x - sx) ** 2 + (y - sy) ** 2; if (d < bd) { bd = d; best = [b, i]; } }
    };
    test(h.level().points, -1);
    (h.level().branches ?? []).forEach((br, bi) => test(br.points, bi));
    return best;
  }
  function hitCar(sx: number, sy: number): number {
    if (!path) return -1;
    let best = -1, bd = Math.max(14, 26 * zoom) ** 2;
    explicit.forEach((c, i) => { const l = h.level(); const v = vehiclePose(path!, c, makeWidthFn(() => l.width, l.narrows)); const [x, y] = toScreen([v.x, v.y]); const d = (x - sx) ** 2 + (y - sy) ** 2; if (d < bd) { bd = d; best = i; } });
    return best;
  }
  function armLongPress(remove: () => void): void {
    longTimer = window.setTimeout(() => { if ((mode === 'drag' || mode === 'dragCar') && !moved) { remove(); mode = 'none'; dragIdx = -1; draw(); } }, LONG_PRESS);
  }

  cv.addEventListener('pointerdown', e => {
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, pos(e)); clearTimeout(longTimer);
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      mode = 'pinch'; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, zoom, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], cam: { ...cam } };
      return;
    }
    if (ptrs.size > 2) return;
    down = pos(e); moved = false; shift = e.shiftKey;
    const pt = hitPoint(down[0], down[1]);
    if (pt) {
      mode = 'drag'; dragBranch = pt[0]; dragIdx = pt[1]; h.select({ kind: 'point', i: pt[1], b: pt[0] }); draw();
      armLongPress(() => h.removePoint(dragBranch, dragIdx));
      return;
    }
    const ci = hitCar(down[0], down[1]);
    if (ci >= 0) {
      mode = 'dragCar'; dragIdx = ci; h.select({ kind: 'car', i: ci }); draw();
      armLongPress(() => h.removeCar(dragIdx));
      return;
    }
    mode = 'pan';
  });

  cv.addEventListener('pointermove', e => {
    const prev = ptrs.get(e.pointerId); if (!prev) return;
    const p = pos(e); ptrs.set(e.pointerId, p);
    if (mode === 'pinch') {
      if (ptrs.size < 2) return;
      const [a, b] = [...ptrs.values()];
      const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      zoom = clampZoom(pinch.zoom * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d);
      // мир, бывший под серединой пальцев в начале пинча, остаётся под ней
      const wx = (pinch.mid[0] - W / 2) / pinch.zoom + pinch.cam.x, wy = (pinch.mid[1] - H / 2) / pinch.zoom + pinch.cam.y;
      cam.x = wx - (mid[0] - W / 2) / zoom; cam.y = wy - (mid[1] - H / 2) / zoom;
      draw(); return;
    }
    if (!moved && Math.hypot(p[0] - down[0], p[1] - down[1]) > 6) { moved = true; clearTimeout(longTimer); }
    if (mode === 'pan') { cam.x -= (p[0] - prev[0]) / zoom; cam.y -= (p[1] - prev[1]) / zoom; draw(); }
    else if (mode === 'drag' && moved) { h.movePoint(dragBranch, dragIdx, round(toWorld(p[0], p[1]))); draw(); }
    else if (mode === 'dragCar' && moved) {
      const at = onRoad(...toWorld(p[0], p[1]));
      if (at) { h.moveCar(dragIdx, { ...at, speed: h.level().cars![dragIdx].speed }); draw(); }
    }
  });

  const up = (e: PointerEvent) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId); clearTimeout(longTimer);
    if (mode === 'pinch') { if (ptrs.size === 0) mode = 'none'; return; } // оставшийся после пинча палец ничего не делает
    if (mode === 'pan' && !moved && e.type === 'pointerup') {
      const w = toWorld(e.clientX, e.clientY);
      if (shift || h.carMode()) { const at = onRoad(w[0], w[1]); if (at) h.addCar({ ...at, speed: 0 }); }
      else h.addPoint(round(w));
    }
    mode = 'none'; dragIdx = -1; draw();
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });

  addEventListener('resize', resize); resize();
  return { draw, fit };
}
