// Заграждения (docs/mechanics.md, M1): данные уровня → геометрия на дороге. Общее для игры и редактора.
import { BLOCK, TRAFFIC_SIZE } from './config';
import { heading, laneOff, pathAt, type Path } from './road';

export interface Block {
  s: number;
  police?: number[];  // полосы, занятые полицейскими машинами поперёк дороги
  spikes?: number[];  // полосы с ежами
  works?: number[];   // полосы, закрытые ремонтом на отрезке len
  len?: number;
  bypass?: 'left' | 'right'; // обочина-объезд вокруг поста
}

export interface Placed { x: number; y: number; h: number; w: number; l: number; s: number }
export interface Bypass { s0: number; s1: number; side: 1 | -1 }

export interface Layout {
  police: Placed[];   // машины поперёк: h — курс машины (вдоль нормали дороги)
  spikes: Placed[];   // полоса ежей: h — курс дороги, w — ширина полосы, l — толщина ленты
  works: Placed[];    // закрытый отрезок полосы: h — курс дороги, w — ширина полосы, l — длина отрезка
  bypasses: Bypass[];
}

export function layoutBlocks(path: Path, width: number, blocks: Block[] = []): Layout {
  const out: Layout = { police: [], spikes: [], works: [], bypasses: [] };
  const laneW = width / 3;
  for (const b of blocks) {
    const p = pathAt(path, b.s), hRoad = heading(p.tx, p.ty);
    const at = (lane: number, ds = 0) => {
      const q = ds ? pathAt(path, b.s + ds) : p;
      const o = laneOff(width, lane);
      return { x: q.x + q.nx * o, y: q.y + q.ny * o };
    };
    for (const lane of b.police ?? []) out.police.push({ ...at(lane), h: hRoad + Math.PI / 2, w: TRAFFIC_SIZE.W, l: TRAFFIC_SIZE.L, s: b.s });
    for (const lane of b.spikes ?? []) out.spikes.push({ ...at(lane), h: hRoad, w: laneW, l: BLOCK.spikeLen, s: b.s });
    const len = b.len ?? BLOCK.worksLen;
    for (const lane of b.works ?? []) {
      const q = pathAt(path, b.s + len / 2);
      const o = laneOff(width, lane);
      out.works.push({ x: q.x + q.nx * o, y: q.y + q.ny * o, h: heading(q.tx, q.ty), w: laneW, l: len, s: b.s + len / 2 });
    }
    if (b.bypass) out.bypasses.push({ s0: b.s - BLOCK.bypassLen / 2, s1: b.s + BLOCK.bypassLen / 2, side: b.bypass === 'right' ? 1 : -1 });
  }
  return out;
}
