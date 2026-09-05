// Зоны LEFT/RIGHT (pointer capture, обе могут быть зажаты), клавиатура, трекинг удержания.
import type { Dir } from './physics';

export const held = { left: false, right: false };

// Длительность удержания — для экрана поражения: «держал LEFT 0.8 с»
export interface Hold { dir: Dir; t: number; last: { dir: Dir; t: number } | null }
export const hold: Hold = { dir: 0, t: 0, last: null };

export function resetHold(): void { hold.dir = 0; hold.t = 0; hold.last = null; }

export function currentDir(): Dir { return ((held.right ? 1 : 0) - (held.left ? 1 : 0)) as Dir; }

export function trackHold(dir: Dir, dt: number): void {
  if (dir !== hold.dir) {
    if (hold.dir !== 0) hold.last = { dir: hold.dir, t: hold.t };
    hold.dir = dir; hold.t = 0;
  }
  if (dir !== 0) hold.t += dt;
}

export function holdText(): string {
  const name = (d: number) => d < 0 ? 'LEFT' : 'RIGHT';
  if (hold.dir !== 0) return `Держал ${name(hold.dir)} ${hold.t.toFixed(1)} с — и не отпустил`;
  if (hold.last) return `Последнее нажатие: ${name(hold.last.dir)}, ${hold.last.t.toFixed(1)} с`;
  return 'Ни одного нажатия';
}

// Возвращает функцию отключения: редактор запускает и останавливает игру без перезагрузки страницы
export function initInput(zones: { left: HTMLElement; right: HTMLElement }, onRestart: () => void): () => void {
  const disposers: (() => void)[] = [];
  for (const k of ['left', 'right'] as const) {
    const z = zones[k];
    const down = (e: PointerEvent) => { e.preventDefault(); z.setPointerCapture(e.pointerId); held[k] = true; z.classList.add('on'); };
    const off = () => { held[k] = false; z.classList.remove('on'); };
    z.addEventListener('pointerdown', down);
    z.addEventListener('pointerup', off);
    z.addEventListener('pointercancel', off);
    z.addEventListener('lostpointercapture', off);
    disposers.push(() => {
      z.removeEventListener('pointerdown', down);
      z.removeEventListener('pointerup', off);
      z.removeEventListener('pointercancel', off);
      z.removeEventListener('lostpointercapture', off);
      off();
    });
  }
  const keydown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'a') { held.left = true; zones.left.classList.add('on'); }
    if (e.key === 'ArrowRight' || e.key === 'd') { held.right = true; zones.right.classList.add('on'); }
    if (e.key === ' ') onRestart();
  };
  const keyup = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'a') { held.left = false; zones.left.classList.remove('on'); }
    if (e.key === 'ArrowRight' || e.key === 'd') { held.right = false; zones.right.classList.remove('on'); }
  };
  addEventListener('keydown', keydown);
  addEventListener('keyup', keyup);
  disposers.push(() => { removeEventListener('keydown', keydown); removeEventListener('keyup', keyup); });
  return () => { for (const d of disposers) d(); };
}
