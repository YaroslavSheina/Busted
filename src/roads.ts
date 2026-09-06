// Граф дорог (docs/mechanics.md, M5): главный сплайн + ветки, которые отходят от него в from и возвращаются в to.
// Концы ветки лежат на главной дороге с заходом BRANCH.lead в обе стороны, поэтому переключение бесшовное.
import { BRANCH } from './config';
import { buildPath, pathAt, type Path, type Pt } from './road';
import type { Block } from './blocks';
import type { TrafficCar } from './traffic';

export interface BranchDef {
  from: number;    // s на главной, где ветка отходит
  to: number;      // s на главной, куда возвращается
  points: Pt[];    // промежуточные точки ветки (без концов — они на главной)
  blocks?: Block[];
  cars?: TrafficCar[];
}

export function buildBranchPath(main: Path, b: BranchDef): Path {
  const at = (s: number): Pt => { const p = pathAt(main, s); return [p.x, p.y]; };
  return buildPath([at(b.from - BRANCH.lead), at(b.from), ...b.points, at(b.to), at(b.to + BRANCH.lead)]);
}

// s на ветке → эквивалентный s главной дороги (для прогресса и HUD)
export function mainEquivalent(b: BranchDef, branch: Path, s: number): number {
  const inner = branch.L - 2 * BRANCH.lead;
  return b.from + Math.max(0, Math.min(1, (s - BRANCH.lead) / (inner || 1))) * (b.to - b.from);
}
