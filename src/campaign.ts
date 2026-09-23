// Кампания: порядок уровней и локальный прогресс (docs/progression.md). Меню уровней — отладочное и идёт мимо.
import { LEVEL_KEYS, LEVELS } from './levels';
import { tester } from './tester';

// Порядок пока из того, что есть; по мере сборки пролога и обучения список заменяется
// Пролог → обучение → карьера (docs/career.md): Окраина (минивэн) → Центр (седан, бывший «Район 2») → Промзона (масл-кар) →
// Ночной город (спорт) → Финал (спорткар пролога)
// Районы для карты карьеры (map.ts): имя, машина, уровни по порядку; концептуальные уровни (docs/career.md, §4) — между обычными
export interface District { name: string; car: string; levels: string[]; story?: string }
export const DISTRICTS: District[] = [
  { name: 'Пролог', car: 'prologue', levels: ['prologue'] },
  { name: 'Обучение', car: 'minivan', levels: ['tut01', 'tut02', 'tut03', 'tut04', 'tut05', 'tut06', 'tut07', 'tut08', 'tut09', 'tut10'],
    story: 'Спорткара больше нет. Есть чужой минивэн и десять коротких заказов, чтобы вспомнить, как ездить.' },
  { name: 'Окраина', car: 'minivan', levels: ['okr1', 'okr_works', 'okr2', 'okr_convoy', 'okr3'],
    story: 'Слава на нуле. Заказы только на окраине: посты, ремонт и медленный минивэн.' },
  { name: 'Центр', car: 'sedan', levels: ['district2', 'ctr_red', 'district2b', 'ctr_jam', 'district2c'],
    story: 'Окраина тебя заметила — дали седан и заказы в центре. Перекрёстки, встречка, пробки.' },
  { name: 'Промзона', car: 'muscle', levels: ['ind_serp', 'ind1', 'ind_train', 'ind2', 'ind_ramps', 'ind3'],
    story: 'Масл-кар из порта — плата за центр. Быстрый на прямой, широкий в заносе. Рельсы и автовозы.' },
  { name: 'Ночной город', car: 'sport', levels: ['night1', 'night_tunnel', 'night2', 'night_wet', 'night3'],
    story: 'О тебе говорят. Спорт, тесные улицы, и полиция уже знает номер.' },
  { name: 'Финал', car: 'finale', levels: ['final'], story: 'Тот самый спорткар — теперь твой. Тот самый гараж.' },
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
// done — пройден; best — лучшие очки; clean — хоть раз без аварий; target — цель по очкам (задаёт игра при первом прохождении);
// goal — хоть раз выполнена цель урока (у уровней с goal она заменяет цель по очкам)
export interface LevelProgress { done: boolean; best: number; clean: boolean; target: number; goal: boolean }
const EMPTY: LevelProgress = { done: false, best: 0, clean: false, target: 0, goal: false };
function readProg(): Record<string, LevelProgress> { try { const p = JSON.parse(localStorage.getItem(PROG) ?? '{}'); return p && typeof p === 'object' ? p : {}; } catch { return {}; } }
export function progressOf(key: string): LevelProgress { return { ...EMPTY, ...(readProg()[key] ?? {}) }; }
export function recordLevel(key: string, points: number, clean: boolean, target: number, goal = false): void {
  const all = readProg(); const p = { ...EMPTY, ...(all[key] ?? {}) };
  all[key] = { done: true, best: Math.max(p.best, Math.round(points)), clean: p.clean || clean, target: target || p.target, goal: p.goal || goal };
  try { localStorage.setItem(PROG, JSON.stringify(all)); } catch { /* приватный режим */ }
}
// Звёзды уровня: доставил, без аварий, третья — цель урока или очки не ниже цели
export function starsOf(key: string): number {
  const p = progressOf(key), third = LEVELS[key]?.goal ? p.goal : p.target > 0 && p.best >= p.target;
  return (p.done ? 1 : 0) + (p.clean ? 1 : 0) + (third ? 1 : 0);
}
// Гараж: машины по ярусам; открыта, когда открыт район, где она выдаётся
export const GARAGE: { car: string; district: string }[] = [
  { car: 'minivan', district: 'Обучение' }, { car: 'sedan', district: 'Центр' }, { car: 'muscle', district: 'Промзона' },
  { car: 'sport', district: 'Ночной город' }, { car: 'finale', district: 'Финал' },
];

// Сброс прогресса (настройки): кампания, уровни, слава, машина
export function resetAll(): void { try { for (const k of ['lr.campaign', 'lr.progress', 'lr.fame', 'lr.car']) localStorage.removeItem(k); } catch { /* приватный режим */ } }

export const campaign = {
  current(): string { return CAMPAIGN[index()]; },
  has(key: string): boolean { return CAMPAIGN.includes(key); },
  index,
  // Уровень from пройден (доставка или ловушка по сценарию) — следующий по списку, прогресс не откатывается назад;
  // null — уровень не из кампании или последний. Уровень из меню тоже ведёт дальше по списку: так и ждёт игрок.
  // Тестер, забежавший вперёд по открытой карте, прогресс кампании не двигает
  advance(from: string): string | null {
    const i = CAMPAIGN.indexOf(from);
    if (i < 0 || i >= CAMPAIGN.length - 1) return null;
    if (!tester() || i <= index()) save(Math.max(index(), i + 1));
    return CAMPAIGN[i + 1];
  },
  reset(): void { save(0); },
};
