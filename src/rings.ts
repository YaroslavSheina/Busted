// Кольцо (docs/mechanics.md, M11): круговая развязка на узле сетки. Маршрут проходит его частью — въезд S-образный,
// по кругу против часовой (правостороннее движение), съезд S-образный; это обычные точки сплайна, их строит генератор.
// Здесь — остальное кольцо: полный круг асфальта, остров и «чужие» рукава со знаком «кирпич» (рисует render.ts).
// Игра знает о них только для причины BUSTED: выехал с маршрута на круг — «проехал съезд», в чужой рукав — «съехал с маршрута»
export interface Ring {
  x: number; y: number;      // центр — узел сетки
  r: number;                 // радиус оси кольца
  s0: number; s1: number;    // участок маршрута по кругу (от касания въезда до касания съезда): разметку там рисует кольцо
  arms: [number, number][];  // направления рукавов, по которым маршрут не идёт (окружение)
}
export const RING = { arm: 420 }; // длина нарисованного чужого рукава от внешнего края кольца, px

// Где машина, съехавшая с маршрута: на круге кольца, в чужом рукаве или нигде
export function ringZone(rings: Ring[] | undefined, width: number, x: number, y: number): 'ring' | 'arm' | null {
  for (const g of rings ?? []) {
    const dx = x - g.x, dy = y - g.y;
    if (Math.abs(Math.hypot(dx, dy) - g.r) <= width / 2 + 20) return 'ring';
    for (const [ax, ay] of g.arms) {
      const along = dx * ax + dy * ay, across = Math.abs(dy * ax - dx * ay);
      if (along > g.r && along < g.r + width / 2 + RING.arm && across <= width / 2 + 20) return 'arm';
    }
  }
  return null;
}
