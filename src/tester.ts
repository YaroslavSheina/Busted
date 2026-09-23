// Режим тестера (подготовка к MVP-тесту): все уровни на карте открыты — проверить любой, не проходя кампанию по порядку.
// Включается ссылкой ?tester=1 (?tester=0 — выключить) или пятью тапами по номеру сборки в настройках; хранится в lr.tester,
// поэтому переживает запуск с экрана «Домой», где параметров в адресе нет. Прогресс кампании от забегов вперёд не сдвигается
const KEY = 'lr.tester';
let on = false;
try { on = localStorage.getItem(KEY) === '1'; } catch { /* нет хранилища */ }
export function tester(): boolean { return on; }
export function setTester(v: boolean): void {
  on = v;
  try { if (v) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* приватный режим */ }
}
