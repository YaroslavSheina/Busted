// Формат файла уровня: { name, points, width, traffic, speed, seed, cars? }
import type { LevelData } from '../levels';
import type { Pt } from '../road';
import type { TrafficCar } from '../traffic';
import type { Block } from '../blocks';
import type { BranchDef } from '../roads';
import type { Narrow } from '../narrow';
import type { RailDef } from '../rails';

// Точки и машины по одной в строке — так JSON читается и правится руками
export function formatLevel(l: LevelData): string {
  const pts = l.points.map(p => `    [${p[0]}, ${p[1]}]`).join(',\n');
  const cars = l.cars?.length
    ? `,\n  "cars": [\n${l.cars.map(c => `    { "s": ${c.s}, "lane": ${c.lane}, "speed": ${c.speed}${c.type ? `, "type": "${c.type}"` : ''} }`).join(',\n')}\n  ]`
    : '';
  const chaser = l.chaser ? `,\n  "chaser": { "gap": ${l.chaser.gap}, "speed": ${l.chaser.speed} }` : '';
  const panic = l.panic ? `,\n  "panic": ${l.panic}` : '';
  const rails = l.rails?.length ? `,\n  "rails": [\n${l.rails.map(r => '    ' + JSON.stringify(r)).join(',\n')}\n  ]` : '';
  const narrows = l.narrows?.length ? `,\n  "narrows": [\n${l.narrows.map(n => '    ' + JSON.stringify(n)).join(',\n')}\n  ]` : '';
  const blocks = l.blocks?.length ? `,\n  "blocks": [\n${l.blocks.map(b => '    ' + JSON.stringify(b)).join(',\n')}\n  ]` : '';
  const branches = l.branches?.length
    ? `,\n  "branches": [\n${l.branches.map(b => `    { "from": ${b.from}, "to": ${b.to}, "points": [${b.points.map(p => `[${p[0]}, ${p[1]}]`).join(', ')}]${b.blocks?.length ? `, "blocks": ${JSON.stringify(b.blocks)}` : ''}${b.cars?.length ? `, "cars": ${JSON.stringify(b.cars)}` : ''} }`).join(',\n')}\n  ]`
    : '';
  const car = l.car ? `,\n  "car": ${JSON.stringify(l.car)}` : '';
  return `{\n  "name": ${JSON.stringify(l.name)},\n  "points": [\n${pts}\n  ],\n  "width": ${l.width},\n  "traffic": ${l.traffic},\n  "seed": ${l.seed}${car}${cars}${chaser}${panic}${narrows}${rails}${blocks}${branches}\n}\n`;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parsePoints(v: unknown, what: string): Pt[] {
  if (!Array.isArray(v)) throw new Error(`«${what}» должно быть массивом`);
  return v.map((p, i) => {
    if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0]) || !isNum(p[1])) throw new Error(`${what}: точка ${i} не [x, y]`);
    return [p[0], p[1]];
  });
}

function parseCars(v: unknown, what: string): TrafficCar[] {
  if (!Array.isArray(v)) throw new Error(`«${what}» должно быть массивом`);
  return v.map((c, i): TrafficCar => {
    if (typeof c !== 'object' || c === null || !isNum(c.s) || !isNum(c.lane) || !isNum(c.speed)) throw new Error(`${what}: машина ${i} не { s, lane, speed }`);
    const out: TrafficCar = { s: c.s, lane: c.lane, speed: c.speed };
    if (c.type !== undefined) { if (c.type !== 'ramp') throw new Error(`${what}: машина ${i}: type только ramp`); out.type = 'ramp'; }
    return out;
  });
}

function parseNarrows(v: unknown, what: string): Narrow[] {
  if (!Array.isArray(v)) throw new Error(`«${what}» должно быть массивом`);
  return v.map((n, i): Narrow => {
    if (typeof n !== 'object' || n === null || !isNum(n.from) || !isNum(n.to) || !isNum(n.width) || n.to <= n.from) throw new Error(`${what} ${i}: нужны from < to и width`);
    return { from: n.from, to: n.to, width: n.width };
  });
}

function parseBlocks(v: unknown, what: string): Block[] {
  if (!Array.isArray(v)) throw new Error(`«${what}» должно быть массивом`);
  const lanes = (x: unknown, k: string, i: number): number[] | undefined => {
    if (x === undefined) return undefined;
    if (!Array.isArray(x) || !x.every(n => n === 0 || n === 1 || n === 2)) throw new Error(`${what} ${i}: «${k}» — полосы 0..2`);
    return x as number[];
  };
  return v.map((b, i): Block => {
    if (typeof b !== 'object' || b === null || !isNum(b.s)) throw new Error(`${what} ${i} без s`);
    const out: Block = { s: b.s };
    const pol = lanes(b.police, 'police', i), spk = lanes(b.spikes, 'spikes', i), wrk = lanes(b.works, 'works', i);
    if (pol) out.police = pol; if (spk) out.spikes = spk; if (wrk) out.works = wrk;
    if (b.len !== undefined) { if (!isNum(b.len)) throw new Error(`${what} ${i}: «len» число`); out.len = b.len; }
    if (b.bypass !== undefined) { if (b.bypass !== 'left' && b.bypass !== 'right') throw new Error(`${what} ${i}: «bypass» left|right`); out.bypass = b.bypass; }
    return out;
  });
}

export function parseLevel(raw: unknown): LevelData {
  if (typeof raw !== 'object' || raw === null) throw new Error('не объект');
  const o = raw as Record<string, unknown>;
  const num = (k: string) => { const v = o[k]; if (!isNum(v)) throw new Error(`«${k}» должно быть числом`); return v; };
  if (typeof o.name !== 'string') throw new Error('«name» должно быть строкой');
  const points = parsePoints(o.points, 'points');
  const level: LevelData = { name: o.name, points, width: num('width'), traffic: num('traffic'), seed: num('seed') };
  if (o.car !== undefined) { if (typeof o.car !== 'string') throw new Error('«car» должно быть строкой'); level.car = o.car; }
  if (o.cars !== undefined) level.cars = parseCars(o.cars, 'cars');
  if (o.chaser !== undefined) {
    const c = o.chaser as Record<string, unknown>;
    if (typeof c !== 'object' || c === null || !isNum(c.gap) || !isNum(c.speed)) throw new Error('«chaser» не { gap, speed }');
    level.chaser = { gap: c.gap, speed: c.speed };
  }
  if (o.panic !== undefined) { if (!isNum(o.panic) || o.panic < 0 || o.panic > 1) throw new Error('«panic» — число 0..1'); level.panic = o.panic; }
  if (o.narrows !== undefined) level.narrows = parseNarrows(o.narrows, 'сужение');
  if (o.rails !== undefined) {
    if (!Array.isArray(o.rails)) throw new Error('«rails» должно быть массивом');
    level.rails = o.rails.map((r, i): RailDef => {
      if (typeof r !== 'object' || r === null || !isNum(r.s) || !isNum(r.period) || !isNum(r.speed) || !isNum(r.length)) throw new Error(`переезд ${i}: нужны s, period, speed, length`);
      const out: RailDef = { s: r.s, period: r.period, speed: r.speed, length: r.length };
      if (r.offset !== undefined) { if (!isNum(r.offset)) throw new Error(`переезд ${i}: offset число`); out.offset = r.offset; }
      return out;
    });
  }
  if (o.blocks !== undefined) level.blocks = parseBlocks(o.blocks, 'заграждение');
  if (o.branches !== undefined) {
    if (!Array.isArray(o.branches)) throw new Error('«branches» должно быть массивом');
    level.branches = o.branches.map((b, i): BranchDef => {
      if (typeof b !== 'object' || b === null || !isNum(b.from) || !isNum(b.to) || b.to <= b.from) throw new Error(`ветка ${i}: нужны from < to`);
      const out: BranchDef = { from: b.from, to: b.to, points: parsePoints(b.points, `ветка ${i}`) };
      if (b.blocks !== undefined) out.blocks = parseBlocks(b.blocks, `ветка ${i}, заграждение`);
      if (b.cars !== undefined) out.cars = parseCars(b.cars, `ветка ${i}, cars`);
      if (b.narrows !== undefined) out.narrows = parseNarrows(b.narrows, `ветка ${i}, сужение`);
      return out;
    });
  }
  return level;
}

export function fileName(name: string): string {
  return (name.trim().replace(/[\\/:*?"<>|]/g, '') || 'level') + '.json';
}
