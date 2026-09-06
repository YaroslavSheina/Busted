// Формат файла уровня: { name, points, width, traffic, speed, seed, cars? }
import type { LevelData } from '../levels';
import type { Pt } from '../road';
import type { TrafficCar } from '../traffic';
import type { Block } from '../blocks';

// Точки и машины по одной в строке — так JSON читается и правится руками
export function formatLevel(l: LevelData): string {
  const pts = l.points.map(p => `    [${p[0]}, ${p[1]}]`).join(',\n');
  const cars = l.cars?.length
    ? `,\n  "cars": [\n${l.cars.map(c => `    { "s": ${c.s}, "lane": ${c.lane}, "speed": ${c.speed} }`).join(',\n')}\n  ]`
    : '';
  const chaser = l.chaser ? `,\n  "chaser": { "gap": ${l.chaser.gap}, "speed": ${l.chaser.speed} }` : '';
  const blocks = l.blocks?.length ? `,\n  "blocks": [\n${l.blocks.map(b => '    ' + JSON.stringify(b)).join(',\n')}\n  ]` : '';
  const car = l.car ? `,\n  "car": ${JSON.stringify(l.car)}` : '';
  return `{\n  "name": ${JSON.stringify(l.name)},\n  "points": [\n${pts}\n  ],\n  "width": ${l.width},\n  "traffic": ${l.traffic},\n  "seed": ${l.seed}${car}${cars}${chaser}${blocks}\n}\n`;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseLevel(raw: unknown): LevelData {
  if (typeof raw !== 'object' || raw === null) throw new Error('не объект');
  const o = raw as Record<string, unknown>;
  const num = (k: string) => { const v = o[k]; if (!isNum(v)) throw new Error(`«${k}» должно быть числом`); return v; };
  if (typeof o.name !== 'string') throw new Error('«name» должно быть строкой');
  if (!Array.isArray(o.points)) throw new Error('«points» должно быть массивом');
  const points: Pt[] = o.points.map((p, i) => {
    if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0]) || !isNum(p[1])) throw new Error(`точка ${i} не [x, y]`);
    return [p[0], p[1]];
  });
  const level: LevelData = { name: o.name, points, width: num('width'), traffic: num('traffic'), seed: num('seed') };
  if (o.car !== undefined) { if (typeof o.car !== 'string') throw new Error('«car» должно быть строкой'); level.car = o.car; }
  if (o.cars !== undefined) {
    if (!Array.isArray(o.cars)) throw new Error('«cars» должно быть массивом');
    level.cars = o.cars.map((c, i): TrafficCar => {
      if (typeof c !== 'object' || c === null || !isNum(c.s) || !isNum(c.lane) || !isNum(c.speed)) throw new Error(`машина ${i} не { s, lane, speed }`);
      return { s: c.s, lane: c.lane, speed: c.speed };
    });
  }
  if (o.chaser !== undefined) {
    const c = o.chaser as Record<string, unknown>;
    if (typeof c !== 'object' || c === null || !isNum(c.gap) || !isNum(c.speed)) throw new Error('«chaser» не { gap, speed }');
    level.chaser = { gap: c.gap, speed: c.speed };
  }
  if (o.blocks !== undefined) {
    if (!Array.isArray(o.blocks)) throw new Error('«blocks» должно быть массивом');
    const lanes = (v: unknown, k: string, i: number): number[] | undefined => {
      if (v === undefined) return undefined;
      if (!Array.isArray(v) || !v.every(n => n === 0 || n === 1 || n === 2)) throw new Error(`заграждение ${i}: «${k}» — полосы 0..2`);
      return v as number[];
    };
    level.blocks = o.blocks.map((b, i): Block => {
      if (typeof b !== 'object' || b === null || !isNum(b.s)) throw new Error(`заграждение ${i} без s`);
      const out: Block = { s: b.s };
      const pol = lanes(b.police, 'police', i), spk = lanes(b.spikes, 'spikes', i), wrk = lanes(b.works, 'works', i);
      if (pol) out.police = pol; if (spk) out.spikes = spk; if (wrk) out.works = wrk;
      if (b.len !== undefined) { if (!isNum(b.len)) throw new Error(`заграждение ${i}: «len» число`); out.len = b.len; }
      if (b.bypass !== undefined) { if (b.bypass !== 'left' && b.bypass !== 'right') throw new Error(`заграждение ${i}: «bypass» left|right`); out.bypass = b.bypass; }
      return out;
    });
  }
  return level;
}

export function fileName(name: string): string {
  return (name.trim().replace(/[\\/:*?"<>|]/g, '') || 'level') + '.json';
}
