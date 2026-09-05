// Холст редактора: панорама, зум (колесо/пинч), точки сплайна. Дорога рисуется тем же drawRoad, что и в игре.
import { buildPath, type Pt } from '../road';
import { drawGrid, drawRoad } from '../render';

export interface CanvasHooks {
  points(): Pt[];
  width(): number;
  selected(): number;
  add(p: Pt): void;
  move(i: number, p: Pt): void;
  remove(i: number): void;
  select(i: number): void;
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
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#15171c'; ctx.fillRect(0, 0, W, H);
    ctx.setTransform(DPR * zoom, 0, 0, DPR * zoom, DPR * (W / 2 - cam.x * zoom), DPR * (H / 2 - cam.y * zoom));
    const [x0, y0] = toWorld(0, 0), [x1, y1] = toWorld(W, H);
    let g = 120; while (g * zoom < 40) g *= 2; // при отдалении сетка укрупняется, а не сливается
    drawGrid(ctx, x0, y0, x1, y1, g, 1 / zoom);

    const pts = h.points();
    if (pts.length >= 2) drawRoad(ctx, buildPath(pts), h.width());

    // контрольный полигон и точки — поверх дороги, размер не зависит от зума
    ctx.lineWidth = 1 / zoom; ctx.strokeStyle = 'rgba(244,185,66,.35)'; ctx.setLineDash([6 / zoom, 6 / zoom]);
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); ctx.setLineDash([]);
    const sel = h.selected();
    ctx.font = `${12 / zoom}px sans-serif`;
    pts.forEach((p, i) => {
      ctx.beginPath(); ctx.arc(p[0], p[1], (i === sel ? HANDLE + 3 : HANDLE) / zoom, 0, 7);
      ctx.fillStyle = i === 0 ? '#6fcf7a' : i === pts.length - 1 ? '#ece9e0' : '#f4b942'; ctx.fill();
      if (i === sel) { ctx.lineWidth = 2 / zoom; ctx.strokeStyle = '#fff'; ctx.stroke(); }
      ctx.fillStyle = 'rgba(236,233,224,.7)'; ctx.fillText(String(i), p[0] + 12 / zoom, p[1] - 10 / zoom);
    });
  }

  function fit(): void {
    const pts = h.points();
    if (pts.length === 0) { cam.x = 0; cam.y = -400; zoom = 0.5; draw(); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const pad = h.width() + 80;
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

  // ---------- указатели ----------
  const ptrs = new Map<number, Pt>();
  let mode: 'none' | 'pan' | 'drag' | 'pinch' = 'none';
  let dragIdx = -1, moved = false, down: Pt = [0, 0], longTimer = 0;
  let pinch = { d: 1, zoom: 1, mid: [0, 0] as Pt, cam: { x: 0, y: 0 } };

  const pos = (e: PointerEvent): Pt => [e.clientX, e.clientY];
  const round = (p: Pt): Pt => [Math.round(p[0]), Math.round(p[1])];
  function hit(sx: number, sy: number): number {
    const pts = h.points();
    let best = -1, bd = (HANDLE + 6) ** 2;
    for (let i = pts.length - 1; i >= 0; i--) { const [x, y] = toScreen(pts[i]); const d = (x - sx) ** 2 + (y - sy) ** 2; if (d < bd) { bd = d; best = i; } }
    return best;
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
    down = pos(e); moved = false;
    const i = hit(down[0], down[1]);
    if (i >= 0) {
      mode = 'drag'; dragIdx = i; h.select(i); draw();
      longTimer = window.setTimeout(() => { if (mode === 'drag' && !moved) { h.remove(dragIdx); mode = 'none'; dragIdx = -1; draw(); } }, LONG_PRESS);
    } else mode = 'pan';
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
    else if (mode === 'drag' && moved) { h.move(dragIdx, round(toWorld(p[0], p[1]))); draw(); }
  });

  const up = (e: PointerEvent) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId); clearTimeout(longTimer);
    if (mode === 'pinch') { if (ptrs.size === 0) mode = 'none'; return; } // оставшийся после пинча палец ничего не делает
    if (mode === 'pan' && !moved && e.type === 'pointerup') h.add(round(toWorld(e.clientX, e.clientY)));
    mode = 'none'; dragIdx = -1; draw();
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });

  addEventListener('resize', resize); resize();
  return { draw, fit };
}
