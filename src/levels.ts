// Уровни — данные: levels/*.json, ключ уровня = имя файла без расширения.
import type { Pt } from './road';
import type { TrafficCar } from './traffic';

export interface LevelData {
  name: string;
  points: Pt[];
  width: number;
  traffic: number;
  speed: number;
  seed: number;
  cars?: TrafficCar[]; // необязательно: явно расставленные машины
}

const files = import.meta.glob<LevelData>('../levels/*.json', { eager: true, import: 'default' });

export const LEVELS: Record<string, LevelData> = Object.fromEntries(
  Object.entries(files).map(([file, level]) => [file.replace(/^.*\/(.+)\.json$/, '$1'), level]),
);

export function levelByName(key: string): LevelData {
  const l = LEVELS[key];
  if (!l) throw new Error(`Нет уровня levels/${key}.json`);
  return l;
}
