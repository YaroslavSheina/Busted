// Все тюнинг-параметры в одном месте. Значения проверены в прототипе на 300 px/с.
// v — текущее значение, остальное — диапазон слайдера в панели тюнинга.

export interface Param { v: number; min: number; max: number; step: number; l: string }

export const P = {
  speed:    { v: 300, min: 120, max: 700, step: 10,   l: 'Скорость, px/с' },
  steer:    { v: 5,   min: 1,   max: 14,  step: 0.5,  l: 'Отклик руля' },
  damp:     { v: 3,   min: 0,   max: 8,   step: 0.25, l: 'Гашение вращения' },
  grip:     { v: 7,   min: 1,   max: 16,  step: 0.5,  l: 'Сцепление' },
  spin:     { v: 2.4, min: 0.8, max: 5,   step: 0.1,  l: 'Порог заноса' },
  skidGrip: { v: 1.2, min: 0.2, max: 5,   step: 0.1,  l: 'Сцепление в заносе' },
  sens:     { v: 1,   min: 0,   max: 2,   step: 0.1,  l: 'Чувств. от скорости' },
  width:    { v: 150, min: 80,  max: 260, step: 10,   l: 'Ширина дороги' },
  traffic:  { v: 0.5, min: 0,   max: 1.5, step: 0.05, l: 'Плотность трафика' },
  tol:      { v: 8,   min: 0,   max: 30,  step: 1,    l: 'Прощение края' },
} satisfies Record<string, Param>;

export type ParamKey = keyof typeof P;

export const LANES = 3;

// Габариты машин трафика, px (игрок — см. cars.ts)
export const TRAFFIC_SIZE = { W: 26, L: 48 };

// Камера: точка впереди по вектору скорости и скорость догона
export const CAM_AHEAD = 150;
export const CAM_LERP = 6;

// Преследователь: как быстро он повторяет боковое смещение игрока, 1/с
export const CHASER_FOLLOW = 4;
// Линия преследователя в поворотах: на сколько px снаружи осевой он «едет».
// Скорость по дороге в повороте радиуса R падает в (1 − CHASER_LINE / R) раз; на прямой не падает —
// на прямой догнать нельзя, в поворотах догоняет того, кто едет шире этой линии
export const CHASER_LINE = 25;

// Заграждения (docs/mechanics.md, M1)
export const BLOCK = {
  bypassLen: 500,  // длина обочины-объезда вокруг полного перекрытия, px
  bypassW: 70,     // ширина обочины, px
  worksLen: 500,   // длина закрытого ремонтом отрезка по умолчанию, px
  spikeLen: 10,    // толщина ленты ежей, px
  flatGrip: 0.3,   // сцепление после ежей (вместо grip и skidGrip), 1/с
  flatKick: 140,   // боковой снос после ежей, px/с
};

// Предел dt на кадр — защита от рывка после паузы вкладки
export const MAX_DT = 1 / 30;
