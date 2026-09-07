// Сужение дороги (docs/mechanics.md, M6): ширина как функция от s.
// Базовая ширина везде, кроме отрезков narrows; на NARROW.ramp px с каждой стороны — линейный переход.
import { NARROW } from './config';

export interface Narrow { from: number; to: number; width: number }

export type WidthFn = (s: number) => number;

// Ширина в точке s: число или функция — везде, где ширина нужна по месту, принимаем оба
export const widthAt = (w: number | WidthFn, s: number): number => typeof w === 'number' ? w : w(s);

export function makeWidthFn(base: () => number, narrows: Narrow[] = []): number | WidthFn {
  if (!narrows.length) return base(); // без сужений — константа, всё считается как раньше
  return (s: number) => {
    let w = base();
    for (const n of narrows) {
      const r = NARROW.ramp;
      if (s < n.from - r || s > n.to + r) continue;
      const t = s < n.from ? (s - (n.from - r)) / r : s > n.to ? ((n.to + r) - s) / r : 1;
      w = w + (n.width - w) * Math.max(0, Math.min(1, t));
    }
    return w;
  };
}
