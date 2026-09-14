// Кампания: порядок уровней и локальный прогресс (docs/progression.md). Меню уровней — отладочное и идёт мимо.
import { LEVEL_KEYS } from './levels';

// Порядок пока из того, что есть; по мере сборки пролога и обучения список заменяется
// Пролог → обучение → карьера (docs/career.md): Окраина (минивэн) → Центр (седан, бывший «Район 2») → Промзона (масл-кар) →
// Ночной город (спорт) → Финал (спорткар пролога)
// Районы для карты карьеры (map.ts): имя, машина, уровни по порядку; концептуальные уровни (docs/career.md, §4) — между обычными
export interface District { name: string; car: string; levels: string[] }
export const DISTRICTS: District[] = [
  { name: 'Пролог', car: 'prologue', levels: ['prologue'] },
  { name: 'Обучение', car: 'minivan', levels: ['tut01', 'tut02', 'tut03', 'tut04', 'tut05', 'tut06', 'tut07', 'tut08', 'tut09', 'tut10'] },
  { name: 'Окраина', car: 'minivan', levels: ['okr1', 'okr_works', 'okr2', 'okr_convoy', 'okr3'] },
  { name: 'Центр', car: 'sedan', levels: ['district2', 'ctr_red', 'district2b', 'ctr_jam', 'district2c'] },
  { name: 'Промзона', car: 'muscle', levels: ['ind_serp', 'ind1', 'ind_train', 'ind2', 'ind_ramps', 'ind3'] },
  { name: 'Ночной город', car: 'sport', levels: ['night1', 'night_tunnel', 'night2', 'night_wet', 'night3'] },
  { name: 'Финал', car: 'finale', levels: ['final'] },
].map(d => ({ ...d, levels: d.levels.filter(k => LEVEL_KEYS.includes(k)) }));
export const CAMPAIGN: string[] = DISTRICTS.flatMap(d => d.levels);

// Меню «уровень» показывает кампанию по порядку и полигон для тестов; остальные файлы levels/ (старые полигоны механик,
// «Район 1», «Графика») скрыты, но открываются по ?level= и в редакторе (решение 2026-09-10). В харнессе меню — все уровни (bundle.py)
export const MENU: string[] = [...CAMPAIGN, 'polygon'].filter(k => LEVEL_KEYS.includes(k));

// Прогресс — ключ уровня, а не номер: список кампании менялся, и сохранённый номер указывал не на пролог (2026-09-10).
// Старое сохранение с номером не читается — начинаем с пролога
const KEY = 'lr.campaign';
interface Progress { key: string }

function index(): number {
  try { const p = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Progress> | null; const i = CAMPAIGN.indexOf(p?.key ?? ''); if (i >= 0) return i; } catch { /* нет сохранения */ }
  return 0;
}
function save(i: number): void { try { localStorage.setItem(KEY, JSON.stringify({ key: CAMPAIGN[i] } satisfies Progress)); } catch { /* приватный режим */ } }

// Слава — сумма очков за доставки и ловушки по сценарию (docs/career.md); ничего не запирает, показывается на DELIVERED
const FAME = 'lr.fame';
export function fame(): number { try { const n = Number(localStorage.getItem(FAME)); return Number.isFinite(n) ? n : 0; } catch { return 0; } }
export function addFame(points: number): number { const n = fame() + Math.round(points); try { localStorage.setItem(FAME, String(n)); } catch { /* приватный режим */ } return n; }

// Прогресс по уровням для карты: пройден и лучший результат (очки с множителем)
const PROG = 'lr.progress';
export interface LevelProgress { done: boolean; best: number }
function readProg(): Record<string, LevelProgress> { try { const p = JSON.parse(localStorage.getItem(PROG) ?? '{}'); return p && typeof p === 'object' ? p : {}; } catch { return {}; } }
export function progressOf(key: string): LevelProgress { return readProg()[key] ?? { done: false, best: 0 }; }
export function recordLevel(key: string, points: number): void {
  const all = readProg(); const p = all[key] ?? { done: false, best: 0 };
  all[key] = { done: true, best: Math.max(p.best, Math.round(points)) };
  try { localStorage.setItem(PROG, JSON.stringify(all)); } catch { /* приватный режим */ }
}

export const campaign = {
  current(): string { return CAMPAIGN[index()]; },
  has(key: string): boolean { return CAMPAIGN.includes(key); },
  index,
  // Уровень from пройден (доставка или ловушка по сценарию) — следующий по списку, прогресс не откатывается назад;
  // null — уровень не из кампании или последний. Уровень из меню тоже ведёт дальше по списку: так и ждёт игрок
  advance(from: string): string | null {
    const i = CAMPAIGN.indexOf(from);
    if (i < 0 || i >= CAMPAIGN.length - 1) return null;
    save(Math.max(index(), i + 1));
    return CAMPAIGN[i + 1];
  },
  reset(): void { save(0); },
};
