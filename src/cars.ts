// Машины — данные. Новая машина = новая строка, никаких новых классов.
// Кузов body выбирает только рисунок в render.ts. Все числа — в единицах physics.ts.
export type Body = 'minivan' | 'sedan' | 'supercar' | 'bus' | 'muscle' | 'sport';

export interface CarSpec {
  name: string;
  body: Body;
  W: number; L: number;  // габариты, px
  speed: number;         // px/с
  steer: number;         // рад/с² от кнопки
  damp: number;          // гашение вращения, 1/с
  grip: number;          // сцепление, 1/с
  spin: number;          // порог заноса, рад/с
  skidGrip: number;      // сцепление в заносе
  hidden?: boolean;      // не показывать в меню «авто» (машина только для своего уровня)
  tint?: string | null;  // подкраска спрайта игрока (темы pixel): по умолчанию жёлтая, null — родной цвет спрайта
}

export const CARS = {
  // Пролог (docs/progression.md): суперкар, но 360 вместо 420 — ощущение скорости есть, радиус поворота остаётся городским
  prologue: { name: 'Спорткар', body: 'supercar', W: 30, L: 50, speed: 360, steer: 7, damp: 3.5, grip: 9, spin: 2.2, skidGrip: 0.9, hidden: true, tint: null }, // красный, как в референсе
  // Тяжёлый и не резкий: медленно набирает вращение и медленно его гасит — несёт долго, но занос недостижим
  minivan:  { name: 'Минивэн',  body: 'minivan',  W: 32, L: 60, speed: 240, steer: 3.5, damp: 2.2, grip: 6, spin: 2.6, skidGrip: 1.4 },
  // Золотая середина — числа прототипа
  sedan:    { name: 'Седан',    body: 'sedan',    W: 28, L: 52, speed: 300, steer: 6.5, damp: 3,   grip: 8.5, spin: 2.4, skidGrip: 1.2 }, // 2026-09-08: было steer 5, grip 7 (радиус 193) — не вписывался в городские углы в крайних полосах; теперь радиус 151
  // Карьера (docs/career.md). Радиус у быстрых машин задаёт порог заноса: R ≈ скорость/spin (седан 125, масл-кар 137, спорт 152,
  // суперкар 191), комфортный — при 0.8 порога. Масл-кар: быстрый на прямой, низкий порог и тяжёлый занос — «широкий» в углах Промзоны (R 260)
  muscle:   { name: 'Масл-кар', body: 'muscle',   W: 30, L: 54, speed: 330, steer: 6.5, damp: 2.8, grip: 7.5, spin: 2.4, skidGrip: 0.8 }, // 2026-09-13: было damp 2.6, spin 2.1 — бот раскачивался на ±50 px при перестроении
  // Спорт: острый руль, быстро гасит вращение, порог выше — юркий в тесных углах Ночного города (R 200)
  sport:    { name: 'Спорт',    body: 'sport',    W: 28, L: 50, speed: 350, steer: 7.5, damp: 3.4, grip: 9.5, spin: 2.3, skidGrip: 1.0 },
  // Быстрый и юркий; удержание дольше ~0.45 с срывает в занос, в заносе почти не держит
  supercar: { name: 'Суперкар', body: 'supercar', W: 30, L: 50, speed: 420, steer: 7,   damp: 3.5, grip: 9, spin: 2.2, skidGrip: 0.9 },
  // Финал: тот же красный спорткар из пролога, но на полной скорости
  finale:   { name: 'Спорткар', body: 'supercar', W: 30, L: 50, speed: 420, steer: 7,   damp: 3.5, grip: 9, spin: 2.2, skidGrip: 0.9, hidden: true, tint: null },
  // Длинный и вялый: занос недостижим, но габарит цепляет всё в поворотах
  bus:      { name: 'Автобус',  body: 'bus',      W: 34, L: 96, speed: 260, steer: 3,   damp: 2.5, grip: 5, spin: 2,   skidGrip: 1 },
} satisfies Record<string, CarSpec>;

export type CarKey = keyof typeof CARS;
export const DEFAULT_CAR: CarKey = 'sedan';

export function carByKey(key?: string): CarSpec {
  return (key && key in CARS) ? CARS[key as CarKey] : CARS[DEFAULT_CAR];
}
