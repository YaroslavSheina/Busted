// Вибрация на событиях (docs/ui.md): navigator.vibrate там, где есть; настройка lr.haptics. В обёртке для сторов заменится на Haptics
let enabled = true;
try { if (localStorage.getItem('lr.haptics') === '0') enabled = false; } catch { /* нет хранилища */ }
export function hapticsEnabled(): boolean { return enabled; }
export function setHapticsEnabled(on: boolean): void { enabled = on; try { localStorage.setItem('lr.haptics', on ? '1' : '0'); } catch { /* приватный режим */ } }
export function buzz(ms: number): void {
  if (!enabled || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try { navigator.vibrate(ms); } catch { /* запрещено политикой */ }
}
