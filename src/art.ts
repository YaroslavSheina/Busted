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

// Паттерн из тайла в мировом масштабе: тайл размером size px мира, повторяется; кэш по контексту и ключу
const patterns = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>();
export function tile(ctx: CanvasRenderingContext2D, key: ArtKey, size: number): CanvasPattern | null {
  const img = images.get(key); if (!img) return null;
  let m = patterns.get(ctx); if (!m) { m = new Map(); patterns.set(ctx, m); }
  const id = `${key}:${size}`;
  let p = m.get(id);
  if (!p) {
    const made = ctx.createPattern(img, 'repeat'); if (!made) return null;
    made.setTransform(new DOMMatrix().scale(size / img.width));
    m.set(id, made); p = made;
  }
  return p;
}

// Спрайт машины, подкрашенный цветом (source-atop поверх спрайта в офскрине), кэш по ключу и цвету
const tinted = new Map<string, HTMLCanvasElement>();
export function sprite(key: ArtKey, col?: string): HTMLCanvasElement | HTMLImageElement | null {
  const img = images.get(key); if (!img) return null;
  if (!col) return img;
  const id = `${key}:${col}`;
  let c = tinted.get(id);
  if (!c) {
    c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-atop'; g.fillStyle = col; g.globalAlpha = 0.55; g.fillRect(0, 0, c.width, c.height);
    tinted.set(id, c);
  }
  return c;
}
