// Склейка чанков `vite build --minify false` в один port.mjs с хуком __lr внутри createGame — для харнесса
// (compare.mjs, routebot.mjs) в Node без DOM. Бандлер переименовывает переменные замыкания (car2, traffic2, chaser2),
// поэтому имена ищем регулярками. Запуск: `npm run harness:build` (сборка + склейка) или `node tools/harness/bundle.mjs [CHASER_LINE]`.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '..', '..');
const chunk = prefix => {
  const dir = join(root, 'dist', 'assets'), f = readdirSync(dir).find(n => n.startsWith(prefix) && n.endsWith('.js'));
  if (!f) throw new Error(`нет чанка ${prefix}*.js в dist/assets — сначала vite build --minify false`);
  return readFileSync(join(dir, f), 'utf8');
};
// замена ровно одного вхождения: если игра изменилась и якорь пропал — харнесс должен упасть, а не молча разойтись
const once = (s, a, b, what) => { const n = s.split(a).length - 1; if (n !== 1) throw new Error(`${what}: ${n} вхождений «${a.slice(0, 60)}»`); return s.replace(a, b); };

let g = chunk('game-'), m = chunk('main-');
if (g.includes('(function polyfill()')) { const i = g.indexOf('(function polyfill()'), j = g.indexOf('})();', i) + 5; g = g.slice(0, i) + g.slice(j); }
g = g.replace(/\nexport \{[^}]*\};?\s*$/, '\n');
m = m.replace(/^import [^\n]*\n/, '');

const carv = /let (roads\d*);\n\s*let (car\d*);\n\s*let marks;/.exec(g);
if (!carv) throw new Error('не нашёл объявления roads/car');
const [, roads, car] = carv, chaser = /let (chaser\d*) = null;/.exec(g)[1], anchor = `let ${chaser} = null;`;
const hook = ` globalThis.__lr = { get car(){return ${car}}, get traffic(){return ${roads}[${car}.road].traffic}, get cam(){return cam}, get state(){return state},`
  + ` get chaser(){return ${chaser}}, get level(){return level}, reset: () => reset(), load: l => load(l), get roads(){return ${roads}}, get path(){return ${roads}[${car}.road].path}, get fx(){return fx}, get P(){return P}, get air(){return jump ? jump.t / 1.4 : undefined} };`;
g = once(g, anchor, anchor + hook, 'хук');
if (process.argv[2]) g = once(g, 'const CHASER_LINE = 25;', `const CHASER_LINE = ${process.argv[2]};`, 'CHASER_LINE');
// в харнессе отсчёта 3-2-1 нет: в load() firstStart = false (объявление let не трогаем)
g = once(g, '\n    firstStart = true;', '\n    firstStart = false;', 'firstStart');
// в Node нет location — тема и уровень по умолчанию
m = m.replace('new URLSearchParams(location.search)', 'new URLSearchParams("")');
// у фальшивых элементов нет style — фон загрузочного экрана и титров не ставим
m = m.replace('splash.style.backgroundImage = ', 'void ');
m = m.replace('ending.style.backgroundImage = ', 'void ');
// загрузочный экран, карта, титры и экраны оболочки считаются закрытыми (иначе игра стоит на паузе)
m = once(m, '!splash.classList.contains("hide") || ', '', 'splash');
m = once(m, '!mapEl.classList.contains("hide") || ', '', 'map');
m = m.replace('!ending.classList.contains("hide") || ', '');
m = once(m, 'shellEls().some((e) => !e.classList.contains("hide")) || ', '', 'shell');
// в харнессе меню — все уровни: боты выбирают уровень кнопкой меню, включая скрытые полигоны механик
m = once(m, 'const MENU = [...CAMPAIGN, "polygon"].filter((k) => LEVEL_KEYS.includes(k));', 'const MENU = LEVEL_KEYS;', 'MENU');

writeFileSync(join(here, 'port.mjs'), g + '\n' + m);
console.log('bundle ok:', roads, car, chaser);
