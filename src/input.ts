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

export function initInput(zones: { left: HTMLElement; right: HTMLElement }, onRestart: () => void): void {
  for (const k of ['left', 'right'] as const) {
    const z = zones[k];
    z.addEventListener('pointerdown', e => { e.preventDefault(); z.setPointerCapture(e.pointerId); held[k] = true; z.classList.add('on'); });
    const off = () => { held[k] = false; z.classList.remove('on'); };
    z.addEventListener('pointerup', off);
    z.addEventListener('pointercancel', off);
    z.addEventListener('lostpointercapture', off);
  }
  addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'a') { held.left = true; zones.left.classList.add('on'); }
    if (e.key === 'ArrowRight' || e.key === 'd') { held.right = true; zones.right.classList.add('on'); }
    if (e.key === ' ') onRestart();
  });
  addEventListener('keyup', e => {
    if (e.key === 'ArrowLeft' || e.key === 'a') { held.left = false; zones.left.classList.remove('on'); }
    if (e.key === 'ArrowRight' || e.key === 'd') { held.right = false; zones.right.classList.remove('on'); }
  });
}
