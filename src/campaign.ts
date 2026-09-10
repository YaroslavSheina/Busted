// Кампания: порядок уровней и локальный прогресс (docs/progression.md). Меню уровней — отладочное и идёт мимо.
import { LEVEL_KEYS } from './levels';

// Порядок пока из того, что есть; по мере сборки пролога и обучения список заменяется
export const CAMPAIGN: string[] = ['prologue', 'tut01', 'tut02', 'tut03', 'tut04', 'tut05', 'tut06', 'tut07', 'tut08', 'tut09', 'tut10', 'district2', 'district2b', 'district2c'].filter(k => LEVEL_KEYS.includes(k));

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

export const campaign = {
  current(): string { return CAMPAIGN[index()]; },
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
