// Уровни — данные: levels/*.json, ключ уровня = имя файла без расширения.
import type { Pt } from './road';
import type { TrafficCar } from './traffic';
import type { Block } from './blocks';
import type { BranchDef } from './roads';
import type { Narrow } from './narrow';
import type { RailDef } from './rails';
import type { CrossingDef } from './crossings';
import type { Ring } from './rings';

// Окружение — только для отрисовки, физика его не знает (docs/mechanics.md, «город»)
export interface Prop { type: 'building'; x: number; y: number; w: number; h: number; tone?: number }

// Знак перед препятствием (docs/teaching.md): щит у правого края тротуара на s главной; генератор ставит их сам по событиям
export interface Sign { s: number; kind: 'works' | 'police' | 'narrow' | 'rails' | 'ring' }

// Преследователь: стартует на gap px позади, speed — доля скорости игрока (1 = та же); at — s, с которого он появляется
export interface Chaser { gap: number; speed: number; at?: number | number[] } // at — s главной, с которого появляется коп; массив — повторные погони: новый коп в каждой точке, если прежний выбыл

// Сценарные карточки (docs/progression.md): стоп-кадр мира и полоса с текстом, когда игрок доехал до s
export interface Card { s: number; text: string }

export interface LevelData {
  name: string;
  points: Pt[];
  width: number;
  traffic: number;
  seed: number;
  car?: string;        // ключ из cars.ts; по умолчанию sedan. Скорость и физику задаёт машина
  cars?: TrafficCar[]; // необязательно: явно расставленные машины
  chaser?: Chaser;     // необязательно: полиция на хвосте
  blocks?: Block[];    // необязательно: заграждения (docs/mechanics.md, M1)
  branches?: BranchDef[]; // необязательно: ветки дороги (docs/mechanics.md, M5)
  panic?: number;      // необязательно: шанс паники трафика при проезде впритирку, 0..1 (docs/mechanics.md, M3)
  narrows?: Narrow[];  // необязательно: сужения дороги (docs/mechanics.md, M6)
  rails?: RailDef[];   // необязательно: переезды на главной дороге (docs/mechanics.md, M7)
  crossings?: CrossingDef[]; // необязательно: перекрёстки со светофором (docs/mechanics.md, M9)
  signs?: Sign[];      // необязательно: знаки перед препятствиями (docs/teaching.md) — читаются на бегу вместо стоп-кадров
  rings?: Ring[];      // необязательно: кольца на главной дороге (docs/mechanics.md, M11) — маршрут в points, здесь остальной круг
  props?: Prop[];      // необязательно: здания и прочее окружение
  oncoming?: number;   // необязательно: сколько левых полос едут навстречу (docs/mechanics.md, M10)
  mix?: number;        // необязательно: доля длинных машин в трафике (автобусы, грузовики), 0..0.5; фургонов — ещё столько же
  pace?: [number, number]; // необязательно: скорость трафика в долях скорости игрока (по умолчанию 0.4..0.7) — «Пробка» (docs/career.md)
  grip?: number;       // необязательно: множитель сцепления машины на уровне (0..1) — «Мокрая дорога»; формула физики та же
  theme?: string;      // необязательно: тема рисования (render.ts THEMES) — палитра района; ?theme= в адресе сильнее
  intro?: string;      // необязательно: карточка перед стартом (показывается с отсчётом 3-2-1 при первом старте уровня)
  cards?: Card[];      // необязательно: карточки по ходу — стоп-кадр на секунду
  trap?: Card;         // необязательно: ловушка — на s BUSTED по сценарию с этим текстом, уровень считается пройденным
  checkpoints?: number[]; // необязательно: контрольные точки (s): после BUSTED попытка продолжается с последней пройденной
}

const files = import.meta.glob<LevelData>('../levels/*.json', { eager: true, import: 'default' });

const keyOf = (file: string) => file.replace(/^.*\/(.+)\.json$/, '$1');

export const LEVELS: Record<string, LevelData> = Object.fromEntries(
  Object.entries(files).map(([file, level]) => [keyOf(file), level]),
);

// Порядок по имени файла. Отдельный список, потому что объект ставит ключи вроде «10» впереди «01»
export const LEVEL_KEYS: string[] = Object.keys(files).map(keyOf).sort();

export function levelByName(key: string): LevelData {
  const l = LEVELS[key];
  if (!l) throw new Error(`Нет уровня levels/${key}.json`);
  return l;
}
