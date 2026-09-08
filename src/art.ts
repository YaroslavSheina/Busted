// Растровый арт для тем со спрайтами: картинки из public/art. Грузится в фоне; пока картинки нет,
// рендер рисует векторную заглушку той же геометрии.
//   корень public/art — эксперимент 2026-09-08: спрайты и тайлы, сгенерированные в Higgsfield (тема sprites)
//   public/art/pixel  — референсы пользователя (docs/refs): 25 машин сверху в пиксельном стиле (тема pixel)
const FILES: Record<string, string> = {
  sedan: 'sedan.png', car: 'car.png', police: 'police.png',
  asphalt: 'asphalt.jpg', roof: 'roof.jpg', pavement: 'pavement.jpg', grass: 'grass.jpg',
};
export const PIXEL_KEYS = ['armored_vehicle', 'bat', 'bus', 'fire_truck', 'gasoline', 'gray_sedan', 'happy_bus', 'jeep', 'limousine', 'muscle_car',
  'pick_up', 'police_regular', 'police_sport', 'retro_1', 'retro_2', 'retro_3', 'roadster', 'schoolbus', 'sport_car', 'super_car',
  'tank', 'truck_1', 'truck_2', 'truck_3', 'white_sedan'] as const;
for (const k of PIXEL_KEYS) FILES['px_' + k] = 'pixel/' + k + '.png';
export type ArtKey = string;

const images = new Map<ArtKey, HTMLImageElement>();
let started = false;

export function loadArt(): void {
  if (started || typeof Image === 'undefined') return;
  started = true;
  for (const [key, file] of Object.entries(FILES)) {
    const img = new Image();
    img.onload = () => images.set(key, img);
    img.src = `${import.meta.env.BASE_URL}art/${file}`;
  }
}

export function art(key: ArtKey): HTMLImageElement | null { return images.get(key) ?? null; }

// Паттерн из тайла в мировом масштабе: тайл один раз пережимается в офскрин ровно size×size px и повторяется
// без матрицы паттерна — уменьшение на лету каждый кадр (без мипмапов) на телефоне слишком дорого. Кэш по контексту и ключу
const patterns = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>();
const scaled = new Map<string, HTMLCanvasElement>();
function scaledTile(img: HTMLImageElement, key: ArtKey, size: number): HTMLCanvasElement {
  const id = `${key}:${size}`;
  let c = scaled.get(id);
  if (!c) { c = document.createElement('canvas'); c.width = c.height = size; c.getContext('2d')!.drawImage(img, 0, 0, size, size); scaled.set(id, c); }
  return c;
}
export function tile(ctx: CanvasRenderingContext2D, key: ArtKey, size: number): CanvasPattern | null {
  const img = images.get(key); if (!img) return null;
  let m = patterns.get(ctx); if (!m) { m = new Map(); patterns.set(ctx, m); }
  const id = `${key}:${size}`;
  let p = m.get(id);
  if (!p) {
    const made = ctx.createPattern(scaledTile(img, key, size), 'repeat'); if (!made) return null;
    m.set(id, made); p = made;
  }
  return p;
}

// Спрайт машины: пережат в офскрин высотой SPRITE_H (в игре машина ~58 px, рисуется с двукратным запасом, а не из 256),
// при цвете подкрашен source-atop; кэш по ключу и цвету
const SPRITE_H = 128;
const sprites = new Map<string, HTMLCanvasElement>();
export function sprite(key: ArtKey, col?: string, alpha = 0.55): HTMLCanvasElement | null {
  const img = images.get(key); if (!img) return null;
  const id = `${key}:${col ?? ''}:${alpha}`;
  let c = sprites.get(id);
  if (!c) {
    c = document.createElement('canvas'); c.height = SPRITE_H; c.width = Math.round(img.width * SPRITE_H / img.height);
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0, c.width, c.height);
    if (col) { g.globalCompositeOperation = 'source-atop'; g.fillStyle = col; g.globalAlpha = alpha; g.fillRect(0, 0, c.width, c.height); }
    sprites.set(id, c);
  }
  return c;
}

// Процедурный тайл (плитка тротуара и т.п.), нарисованный функцией, — паттерн без картинок. Кэш по контексту и имени
export function procTile(ctx: CanvasRenderingContext2D, name: string, size: number, draw: (g: CanvasRenderingContext2D, size: number) => void): CanvasPattern | null {
  let m = patterns.get(ctx); if (!m) { m = new Map(); patterns.set(ctx, m); }
  const id = `proc:${name}:${size}`;
  let p = m.get(id);
  if (!p) {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); if (!g) return null;
    draw(g, size);
    const made = ctx.createPattern(c, 'repeat'); if (!made) return null;
    m.set(id, made); p = made;
  }
  return p;
}
