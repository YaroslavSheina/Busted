// Растровый арт для темы sprites (эксперимент): спрайты машин и тайлы текстур из public/art.
// Грузится в фоне; пока картинки нет, рендер рисует векторную заглушку той же геометрии.
export type ArtKey = 'sedan' | 'car' | 'police' | 'asphalt' | 'roof' | 'pavement' | 'grass';

const FILES: Record<ArtKey, string> = {
  sedan: 'sedan.png', car: 'car.png', police: 'police.png',
  asphalt: 'asphalt.jpg', roof: 'roof.jpg', pavement: 'pavement.jpg', grass: 'grass.jpg',
};

const images = new Map<ArtKey, HTMLImageElement>();
let started = false;

export function loadArt(): void {
  if (started || typeof Image === 'undefined') return;
  started = true;
  for (const [key, file] of Object.entries(FILES) as [ArtKey, string][]) {
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
export function sprite(key: ArtKey, col?: string): HTMLCanvasElement | null {
  const img = images.get(key); if (!img) return null;
  const id = `${key}:${col ?? ''}`;
  let c = sprites.get(id);
  if (!c) {
    c = document.createElement('canvas'); c.height = SPRITE_H; c.width = Math.round(img.width * SPRITE_H / img.height);
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0, c.width, c.height);
    if (col) { g.globalCompositeOperation = 'source-atop'; g.fillStyle = col; g.globalAlpha = 0.55; g.fillRect(0, 0, c.width, c.height); }
    sprites.set(id, c);
  }
  return c;
}
