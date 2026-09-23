// Журнал теста (подготовка к MVP): попытки, запуски игры и заметки тестера. Хранится локально в lr.log (последние 3000 записей).
// Тестер отправляет его из настроек файлом («журнал теста» → поделиться в мессенджер); редактор рисует по нему смерти на уровне.
// Файл — .txt с JSON внутри: Chrome на Android делится только текстом, картинками, видео и pdf
import type { Attempt, GameInfo } from './game';

export interface Device { ua: string; w: number; h: number; vw: number; vh: number; dpr: number; app: boolean }
export type LogEntry =
  | ({ ev: 'open'; ts: number; b: string } & Device)
  | ({ ev: 'try'; ts: number; b: string; lvl: string; n: number } & Attempt)
  | ({ ev: 'note'; ts: number; b: string; lvl: string; n: number; text: string } & GameInfo);

// имена уникальны на весь бандл: харнесс склеивает чанки сборки в один файл (tools/harness/bundle.mjs)
const LOG_KEY = 'lr.log', LOG_MAX = 3000;
let logCache: LogEntry[] | null = null;
function all(): LogEntry[] {
  if (!logCache) { try { const a = JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]'); logCache = Array.isArray(a) ? a : []; } catch { logCache = []; } }
  return logCache;
}
function push(e: LogEntry): void {
  const a = all(); a.push(e); if (a.length > LOG_MAX) a.splice(0, a.length - LOG_MAX);
  try { localStorage.setItem(LOG_KEY, JSON.stringify(a)); } catch { /* переполнено или приватный режим — журнал живёт до перезапуска */ }
}

// Телефон: экран и видимая область в точках (от неё зависит, сколько дороги видно впереди), плотность, запуск с экрана «Домой»
export function device(): Device {
  const g = globalThis as { screen?: { width: number; height: number }; innerWidth?: number; innerHeight?: number; devicePixelRatio?: number;
    matchMedia?: (q: string) => { matches: boolean }; navigator?: { userAgent?: string; standalone?: boolean } };
  return { ua: g.navigator?.userAgent ?? '', w: g.screen?.width ?? 0, h: g.screen?.height ?? 0, vw: g.innerWidth ?? 0, vh: g.innerHeight ?? 0,
    dpr: g.devicePixelRatio ?? 1, app: !!(g.matchMedia?.('(display-mode: fullscreen), (display-mode: standalone)').matches || g.navigator?.standalone) };
}

export function logOpen(): void { push({ ev: 'open', ts: Date.now(), b: __BUILD__, ...device() }); }
// номер попытки уровня с учётом прошлых запусков: «разбился на 7-й попытке»
export function tries(lvl: string): number { return all().reduce((n, e) => n + (e.ev === 'try' && e.lvl === lvl ? 1 : 0), 0); }
export function logAttempt(lvl: string, a: Attempt): void { push({ ev: 'try', ts: Date.now(), b: __BUILD__, lvl, n: tries(lvl) + 1, ...a }); }
// заметка посреди заезда относится к идущей попытке, на экране BUSTED — к только что закончившейся
export function attemptNo(lvl: string, state: string): number { return tries(lvl) + (state === 'play' || state === 'intro' ? 1 : 0); }
export function logNote(lvl: string, info: GameInfo, text: string): void { push({ ev: 'note', ts: Date.now(), b: __BUILD__, lvl, n: attemptNo(lvl, info.state), text, ...info }); }
export function logCount(): number { return all().reduce((n, e) => n + (e.ev === 'try' ? 1 : 0), 0); }
export function clearLog(): void { logCache = []; try { localStorage.removeItem(LOG_KEY); } catch { /* приватный режим */ } }

function stamp(): string { const d = new Date(), p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getDate())}${p(d.getMonth() + 1)}-${p(d.getHours())}${p(d.getMinutes())}`; }

// Поделиться журналом: файлом через системное меню (телефон), иначе скачать (компьютер), иначе в буфер обмена.
// navigator.share вызывается синхронно в обработчике тапа — до первого await, иначе браузер откажет без жеста
export async function shareLog(): Promise<string> {
  const text = JSON.stringify({ game: 'BUSTED', build: __BUILD__, exported: new Date().toISOString(), device: device(), entries: all() });
  const name = `busted-log-${stamp()}.txt`;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  try {
    const file = new File([text], name, { type: 'text/plain' });
    if (nav.canShare?.({ files: [file] })) { await nav.share({ files: [file], title: 'BUSTED — журнал теста' }); return 'отправлено'; }
  } catch (e) { if ((e as Error).name === 'AbortError') return 'отменено'; }
  if (!/Android|iPhone|iPad/.test(nav.userAgent)) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000); return 'сохранён файлом';
  }
  return await copyText(text) ? 'скопирован' : 'не вышло';
}

// Отправить текст заметки сразу: системное меню на телефоне, иначе в буфер обмена — вставить в чат
export async function shareText(text: string): Promise<string> {
  try {
    if (typeof navigator.share === 'function' && /Android|iPhone|iPad/.test(navigator.userAgent)) { await navigator.share({ text }); return 'отправлено'; }
  } catch (e) { if ((e as Error).name === 'AbortError') return 'сохранено, не отправлено'; }
  return await copyText(text) ? 'скопировано — вставь в чат' : 'сохранено в журнал';
}

// Копирование в буфер: Clipboard API есть только по https — на локальном сервере по сети выручает скрытое поле
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* нет доступа */ }
  try {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;-webkit-user-select:text;user-select:text';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
}
