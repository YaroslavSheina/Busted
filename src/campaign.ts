// Кампания: порядок уровней и локальный прогресс (docs/progression.md). Меню уровней — отладочное и идёт мимо.
import { LEVEL_KEYS } from './levels';

// Порядок пока из того, что есть; по мере сборки пролога и обучения список заменяется
// Пролог → обучение → карьера (docs/career.md): Окраина (минивэн) → Центр (седан, бывший «Район 2») → Промзона (масл-кар) →
// Ночной город (спорт) → Финал (спорткар пролога)
export const CAMPAIGN: string[] = ['prologue', 'tut01', 'tut02', 'tut03', 'tut04', 'tut05', 'tut06', 'tut07', 'tut08', 'tut09', 'tut10',
  // концептуальные уровни (docs/career.md, §4) — между обычными маршрутами района
  'okr1', 'okr_works', 'okr2', 'okr_convoy', 'okr3',
  'district2', 'ctr_red', 'district2b', 'ctr_jam', 'district2c',
  'ind_serp', 'ind1', 'ind_train', 'ind2', 'ind_ramps', 'ind3',
  'night1', 'night_tunnel', 'night2', 'night_wet', 'night3', 'final'].filter(k => LEVEL_KEYS.includes(k));

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
