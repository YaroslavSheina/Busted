// Граф дорог (docs/mechanics.md, M5): главный сплайн + ветки. Ветка отходит от родительской дороги в from и
// возвращается на неё в to; родитель — главная или другая ветка (parent), так что граф может быть любой глубины.
// Концы ветки лежат на родителе с заходом BRANCH.lead в обе стороны, поэтому переключение бесшовное.
import { BRANCH } from './config';
import { buildPath, pathAt, type Path, type Pt } from './road';
import type { Block } from './blocks';
import type { TrafficCar } from './traffic';
import type { Narrow } from './narrow';
import type { RailDef } from './rails';
import type { CrossingDef } from './crossings';

export interface BranchDef {
  from: number;    // s на родительской дороге, где ветка отходит
  to: number;      // s на родительской, куда возвращается
  parent?: number; // индекс ветки-родителя в branches (она должна идти раньше); нет — главная дорога
  points: Pt[];    // промежуточные точки ветки (без концов — они на родителе)
  blocks?: Block[];
  cars?: TrafficCar[];
  narrows?: Narrow[]; // сужения по s ветки
  oncoming?: number;  // встречных полос на ветке
  rails?: RailDef[];         // переезды по s ветки (M7)
  crossings?: CrossingDef[]; // перекрёстки по s ветки (M9)
}

// Индекс родителя в списке дорог уровня (0 — главная, ветка i — i + 1)
export const parentRoad = (b: BranchDef): number => (b.parent === undefined ? 0 : b.parent + 1);

export function buildBranchPath(parent: Path, b: BranchDef): Path {
  const at = (s: number): Pt => { const p = pathAt(parent, s); return [p.x, p.y]; };
  // По точке на родителе с каждой стороны стыка: тангенс в стыке идёт вдоль родителя, ветка не выгибается наружу
  return buildPath([at(b.from - BRANCH.lead), at(b.from), at(b.from + BRANCH.lead), ...b.points, at(b.to - BRANCH.lead), at(b.to), at(b.to + BRANCH.lead)]);
}

// Пути всех дорог уровня: главная, затем ветки по порядку. Ветка, чей родитель ещё не построен, — null
export function buildRoadPaths(main: Path, branches: BranchDef[] = []): (Path | null)[] {
  const paths: (Path | null)[] = [main];
  branches.forEach((b, i) => {
    const p = parentRoad(b) <= i ? paths[parentRoad(b)] : null;
    paths.push(p ? buildBranchPath(p, b) : null);
  });
  return paths;
}

// s на ветке → s родительской дороги (для прогресса и HUD)
export function parentEquivalent(b: BranchDef, branch: Path, s: number): number {
  const inner = branch.L - 2 * BRANCH.lead;
  return b.from + Math.max(0, Math.min(1, (s - BRANCH.lead) / (inner || 1))) * (b.to - b.from);
}
