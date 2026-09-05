// Формат файла уровня: { name, points, width, traffic, speed, seed }
import type { LevelData } from '../levels';
import type { Pt } from '../road';

// Точки по одной в строке — так JSON читается и правится руками
export function formatLevel(l: LevelData): string {
  const pts = l.points.map(p => `    [${p[0]}, ${p[1]}]`).join(',\n');
  return `{\n  "name": ${JSON.stringify(l.name)},\n  "points": [\n${pts}\n  ],\n  "width": ${l.width},\n  "traffic": ${l.traffic},\n  "speed": ${l.speed},\n  "seed": ${l.seed}\n}\n`;
}

export function parseLevel(raw: unknown): LevelData {
  if (typeof raw !== 'object' || raw === null) throw new Error('не объект');
  const o = raw as Record<string, unknown>;
  const num = (k: string) => { const v = o[k]; if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`«${k}» должно быть числом`); return v; };
  if (typeof o.name !== 'string') throw new Error('«name» должно быть строкой');
  if (!Array.isArray(o.points)) throw new Error('«points» должно быть массивом');
  const points: Pt[] = o.points.map((p, i) => {
    if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== 'number' || typeof p[1] !== 'number') throw new Error(`точка ${i} не [x, y]`);
    return [p[0], p[1]];
  });
  return { name: o.name, points, width: num('width'), traffic: num('traffic'), speed: num('speed'), seed: num('seed') };
}

export function fileName(name: string): string {
  return (name.trim().replace(/[\\/:*?"<>|]/g, '') || 'level') + '.json';
}
