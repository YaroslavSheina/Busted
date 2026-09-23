// Формат файла уровня: { name, points, width, traffic, speed, seed, cars? }
import type { LevelData } from '../levels';
import type { Pt } from '../road';
import type { TrafficCar } from '../traffic';
import type { Block } from '../blocks';
import type { BranchDef } from '../roads';
import type { Narrow } from '../narrow';
import type { RailDef } from '../rails';
import type { CrossingDef } from '../crossings';
import type { Card, Prop } from '../levels';

// Точки и машины по одной в строке — так JSON читается и правится руками
export function formatLevel(l: LevelData): string {
  const pts = l.points.map(p => `    [${p[0]}, ${p[1]}]`).join(',\n');
  const cars = l.cars?.length
    ? `,\n  "cars": [\n${l.cars.map(c => `    { "s": ${c.s}, "lane": ${c.lane}, "speed": ${c.speed}${c.type ? `, "type": "${c.type}"` : ''}${c.oncoming ? ', "oncoming": true' : ''}${c.model ? `, "model": "${c.model}"` : ''} }`).join(',\n')}\n  ]`
    : '';
  const chaser = l.chaser ? `,\n  "chaser": { "gap": ${l.chaser.gap}, "speed": ${l.chaser.speed}${l.chaser.at !== undefined ? `, "at": ${JSON.stringify(l.chaser.at)}` : ''} }` : '';
  const panic = l.panic ? `,\n  "panic": ${l.panic}` : '';
  const mix = l.mix ? `,\n  "mix": ${l.mix}` : '';
  const pace = l.pace ? `,\n  "pace": ${JSON.stringify(l.pace)}` : '';
  const grip = l.grip !== undefined ? `,\n  "grip": ${l.grip}` : '';
  const theme = l.theme ? `,\n  "theme": ${JSON.stringify(l.theme)}` : '';
  const intro = l.intro ? `,\n  "intro": ${JSON.stringify(l.intro)}` : '';
  const cards = l.cards?.length ? `,\n  "cards": [\n${l.cards.map(c => '    ' + JSON.stringify(c)).join(',\n')}\n  ]` : '';
  const trap = l.trap ? `,\n  "trap": ${JSON.stringify(l.trap)}` : '';
  const checkpoints = l.checkpoints?.length ? `,\n  "checkpoints": ${JSON.stringify(l.checkpoints)}` : '';
  const oncoming = l.oncoming ? `,\n  "oncoming": ${l.oncoming}` : '';
  const rails = l.rails?.length ? `,\n  "rails": [\n${l.rails.map(r => '    ' + JSON.stringify(r)).join(',\n')}\n  ]` : '';
  const crossings = l.crossings?.length ? `,\n  "crossings": [\n${l.crossings.map(c => '    ' + JSON.stringify(c)).join(',\n')}\n  ]` : '';
  const props = l.props?.length ? `,\n  "props": [\n${l.props.map(p => '    ' + JSON.stringify(p)).join(',\n')}\n  ]` : '';
  const narrows = l.narrows?.length ? `,\n  "narrows": [\n${l.narrows.map(n => '    ' + JSON.stringify(n)).join(',\n')}\n  ]` : '';
  const blocks = l.blocks?.length ? `,\n  "blocks": [\n${l.blocks.map(b => '    ' + JSON.stringify(b)).join(',\n')}\n  ]` : '';
  const branches = l.branches?.length
    ? `,\n  "branches": [\n${l.branches.map(b => `    { "from": ${b.from}, "to": ${b.to}${b.parent !== undefined ? `, "parent": ${b.parent}` : ''}, "points": [${b.points.map(p => `[${p[0]}, ${p[1]}]`).join(', ')}]${b.oncoming ? `, "oncoming": ${b.oncoming}` : ''}${b.blocks?.length ? `, "blocks": ${JSON.stringify(b.blocks)}` : ''}${b.cars?.length ? `, "cars": ${JSON.stringify(b.cars)}` : ''}${b.narrows?.length ? `, "narrows": ${JSON.stringify(b.narrows)}` : ''}${b.rails?.length ? `, "rails": ${JSON.stringify(b.rails)}` : ''}${b.crossings?.length ? `, "crossings": ${JSON.stringify(b.crossings)}` : ''} }`).join(',\n')}\n  ]`
    : '';
  const car = l.car ? `,\n  "car": ${JSON.stringify(l.car)}` : '';
  return `{\n  "name": ${JSON.stringify(l.name)},\n  "points": [\n${pts}\n  ],\n  "width": ${l.width},\n  "traffic": ${l.traffic},\n  "seed": ${l.seed}${car}${cars}${chaser}${panic}${mix}${pace}${grip}${theme}${intro}${cards}${trap}${checkpoints}${oncoming}${narrows}${rails}${crossings}${blocks}${branches}${props}\n}\n`;
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
    if (c.oncoming === true) out.oncoming = true;
    if (c.model !== undefined) { if (!['car', 'van', 'bus', 'truck', 'tanker', 'limo'].includes(c.model)) throw new Error(`${what}: машина ${i}: model — car|van|bus|truck|tanker|limo`); out.model = c.model; }
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

function parseCrossings(v: unknown, what: string): CrossingDef[] {
  if (!Array.isArray(v)) throw new Error(`«${what}» должно быть массивом`);
  return v.map((c, i): CrossingDef => {
    if (typeof c !== 'object' || c === null || !isNum(c.s) || !isNum(c.period)) throw new Error(`${what} ${i}: нужны s и period`);
    const out: CrossingDef = { s: c.s, period: c.period };
    for (const k of ['offset', 'cars', 'speed', 'width', 'before'] as const) if (c[k] !== undefined) { if (!isNum(c[k])) throw new Error(`${what} ${i}: «${k}» число`); out[k] = c[k]; }
    return out;
  });
}

function parseRails(v: unknown, what: string): RailDef[] {
  if (!Array.isArray(v)) throw new Error(`«${what}» должно быть массивом`);
  return v.map((r, i): RailDef => {
    if (typeof r !== 'object' || r === null || !isNum(r.s) || !isNum(r.period) || !isNum(r.speed) || !isNum(r.length)) throw new Error(`${what} ${i}: нужны s, period, speed, length`);
    const out: RailDef = { s: r.s, period: r.period, speed: r.speed, length: r.length };
    if (r.offset !== undefined) { if (!isNum(r.offset)) throw new Error(`${what} ${i}: offset число`); out.offset = r.offset; }
    if (r.after !== undefined) { if (!isNum(r.after)) throw new Error(`${what} ${i}: after число`); out.after = r.after; }
    if (r.before !== undefined) { if (!isNum(r.before) || !isNum(r.clear)) throw new Error(`${what} ${i}: before и clear — числа`); out.before = r.before; out.clear = r.clear; }
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
    if (c.at !== undefined) {
      if (!(isNum(c.at) || (Array.isArray(c.at) && c.at.every(isNum)))) throw new Error('«chaser.at» — число или массив чисел');
      level.chaser.at = c.at as number | number[];
    }
  }
  if (o.panic !== undefined) { if (!isNum(o.panic) || o.panic < 0 || o.panic > 1) throw new Error('«panic» — число 0..1'); level.panic = o.panic; }
  if (o.mix !== undefined) { if (!isNum(o.mix) || o.mix < 0 || o.mix > 0.5) throw new Error('«mix» — число 0..0.5'); if (o.mix > 0) level.mix = o.mix; }
  if (o.pace !== undefined) { const p = o.pace as unknown[]; if (!Array.isArray(p) || p.length !== 2 || !p.every(isNum) || (p[0] as number) > (p[1] as number)) throw new Error('«pace» — [min, max] доли скорости'); level.pace = [p[0] as number, p[1] as number]; }
  if (o.grip !== undefined) { if (!isNum(o.grip) || o.grip <= 0 || o.grip > 1) throw new Error('«grip» — число 0..1'); level.grip = o.grip; }
  if (o.theme !== undefined) { if (typeof o.theme !== 'string') throw new Error('«theme» — строка'); level.theme = o.theme; }
  const card = (v: unknown, what: string): Card => { if (typeof v !== 'object' || v === null || !isNum((v as Card).s) || typeof (v as Card).text !== 'string') throw new Error(`${what}: нужны s и text`); return { s: (v as Card).s, text: (v as Card).text }; };
  if (o.intro !== undefined) { if (typeof o.intro !== 'string') throw new Error('«intro» — строка'); level.intro = o.intro; }
  if (o.cards !== undefined) { if (!Array.isArray(o.cards)) throw new Error('«cards» должно быть массивом'); level.cards = o.cards.map((c, i) => card(c, `карточка ${i}`)); }
  if (o.trap !== undefined) level.trap = card(o.trap, 'ловушка');
  if (o.checkpoints !== undefined) { if (!Array.isArray(o.checkpoints) || !o.checkpoints.every(isNum)) throw new Error('«checkpoints» — массив чисел'); level.checkpoints = o.checkpoints as number[]; }
  if (o.oncoming !== undefined) { if (!isNum(o.oncoming) || o.oncoming < 0 || o.oncoming > 2) throw new Error('«oncoming» — 0..2'); level.oncoming = o.oncoming; }
  if (o.narrows !== undefined) level.narrows = parseNarrows(o.narrows, 'сужение');
  if (o.props !== undefined) {
    if (!Array.isArray(o.props)) throw new Error('«props» должно быть массивом');
    level.props = o.props.map((p, i): Prop => {
      if (typeof p !== 'object' || p === null || p.type !== 'building' || !isNum(p.x) || !isNum(p.y) || !isNum(p.w) || !isNum(p.h)) throw new Error(`prop ${i}: building с x, y, w, h`);
      const out: Prop = { type: 'building', x: p.x, y: p.y, w: p.w, h: p.h };
      if (p.tone !== undefined) { if (!isNum(p.tone)) throw new Error(`prop ${i}: tone число`); out.tone = p.tone; }
      return out;
    });
  }
  if (o.crossings !== undefined) level.crossings = parseCrossings(o.crossings, 'перекрёсток');
  if (o.rails !== undefined) level.rails = parseRails(o.rails, 'переезд');
  if (o.blocks !== undefined) level.blocks = parseBlocks(o.blocks, 'заграждение');
  if (o.branches !== undefined) {
    if (!Array.isArray(o.branches)) throw new Error('«branches» должно быть массивом');
    level.branches = o.branches.map((b, i): BranchDef => {
      if (typeof b !== 'object' || b === null || !isNum(b.from) || !isNum(b.to) || b.to <= b.from) throw new Error(`ветка ${i}: нужны from < to`);
      const out: BranchDef = { from: b.from, to: b.to, points: parsePoints(b.points, `ветка ${i}`) };
      if (b.parent !== undefined) { if (!Number.isInteger(b.parent) || b.parent < 0 || b.parent >= i) throw new Error(`ветка ${i}: «parent» — индекс ветки, идущей раньше`); out.parent = b.parent; }
      if (b.blocks !== undefined) out.blocks = parseBlocks(b.blocks, `ветка ${i}, заграждение`);
      if (b.cars !== undefined) out.cars = parseCars(b.cars, `ветка ${i}, cars`);
      if (b.narrows !== undefined) out.narrows = parseNarrows(b.narrows, `ветка ${i}, сужение`);
      if (b.oncoming !== undefined) { if (!isNum(b.oncoming)) throw new Error(`ветка ${i}: oncoming число`); out.oncoming = b.oncoming; }
      if (b.rails !== undefined) out.rails = parseRails(b.rails, `ветка ${i}, переезд`);
      if (b.crossings !== undefined) out.crossings = parseCrossings(b.crossings, `ветка ${i}, перекрёсток`);
      return out;
    });
  }
  return level;
}

export function fileName(name: string): string {
  return (name.trim().replace(/[\\/:*?"<>|]/g, '') || 'level') + '.json';
}
