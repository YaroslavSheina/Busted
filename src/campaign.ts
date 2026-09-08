// Кампания: порядок уровней и локальный прогресс (docs/progression.md). Меню уровней — отладочное и идёт мимо.
import { LEVEL_KEYS } from './levels';

// Порядок пока из того, что есть; по мере сборки пролога и обучения список заменяется
export const CAMPAIGN: string[] = ['prologue', 'tut01', 'tut02', 'tut03', 'tut04', 'tut05', 'tut06', 'tut07', 'tut08', 'tut09', 'tut10', 'district2', 'district2b', 'district2c'].filter(k => LEVEL_KEYS.includes(k));

const KEY = 'lr.campaign';
interface Progress { at: number }

function read(): Progress {
  try { const p = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (p && Number.isInteger(p.at)) return { at: Math.max(0, Math.min(CAMPAIGN.length - 1, p.at)) }; } catch { /* нет сохранения */ }
  return { at: 0 };
}
function save(p: Progress): void { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* приватный режим */ } }

export const campaign = {
  current(): string { return CAMPAIGN[read().at]; },
  index(): number { return read().at; },
  // уровень пройден (доставка или ловушка по сценарию) — следующий; null, если кампания кончилась
  advance(): string | null {
    const p = read();
    if (p.at >= CAMPAIGN.length - 1) return null;
    p.at += 1; save(p);
    return CAMPAIGN[p.at];
  },
  reset(): void { save({ at: 0 }); },
};
