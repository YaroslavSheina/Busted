// Тестовые дороги прототипа: контрольные точки сплайна.
import type { Pt } from './road';

export interface Level { name: string; pts: Pt[] }

function ring(cx: number, cy: number, r: number, from: number, to: number, n: number): Pt[] {
  const a: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = from + (to - from) * i / n;
    a.push([cx + r * Math.sin(t), cy + r * Math.cos(t)]);
  }
  return a;
}

export const LEVELS = {
  straight: { name: 'Прямая',      pts: [[0, 0], [0, -800], [0, -1600], [0, -2400], [0, -3200], [0, -4000]] },
  bend:     { name: 'Изгиб 45°',   pts: [[0, 0], [0, -700], [-60, -1100], [-350, -1600], [-750, -2100], [-1000, -2600], [-1000, -3200], [-1000, -3900]] },
  turn:     { name: 'Поворот 90°', pts: [[0, 0], [0, -700], [0, -1100], [120, -1400], [400, -1560], [800, -1600], [1400, -1600], [2000, -1600], [2600, -1600]] },
  uturn:    { name: 'Разворот',    pts: [[0, 0], [0, -700], [0, -1100], [90, -1380], [300, -1520], [520, -1400], [600, -1100], [600, -700], [600, 0], [600, 800], [600, 1500]] },
  ring:     { name: 'Кольцо',      pts: [[0, 600], [0, 0], [0, -500], ...ring(0, -1000, 280, 0, Math.PI * 2.5, 10), [280, -1500], [280, -2200], [280, -2900]] },
} satisfies Record<string, Level>;

export type LevelKey = keyof typeof LEVELS;
