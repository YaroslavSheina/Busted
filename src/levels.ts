// Уровни — данные: levels/*.json, ключ уровня = имя файла без расширения.
import type { Pt } from './road';
import type { TrafficCar } from './traffic';
import type { Block } from './blocks';
import type { BranchDef } from './roads';

// Преследователь: стартует на gap px позади, speed — доля скорости игрока (1 = та же)
export interface Chaser { gap: number; speed: number }

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
