// Прогон ботов по всей кампании: каждый уровень должен доезжать до гаража (или до ловушки пролога) по своему плану полос.
// Трафик выключен (CLEAN): бот проверяет геометрию, заграждения, рампы, поезда, светофоры и копов. Окна в трафике у постов
// ловит только человек — это проверка телефоном. Планы — plans.json: полоса старта, PLAN «s:полоса,…», прицел LOOK, ветка TAKE.
// Уровни кампании берутся из src/campaign.ts: новый уровень без записи в plans.json едет по умолчанию (средняя полоса) — и
// если не доедет, прогон упадёт, пока план не добавлен.
// Запуск: npm run harness:sweep (сборка и склейка — npm run harness:build). LEVEL=ключ — один уровень.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '..', '..');
const plans = JSON.parse(readFileSync(join(here, 'plans.json'), 'utf8'));
const campaignSrc = readFileSync(join(root, 'src', 'campaign.ts'), 'utf8');
const keys = [...campaignSrc.matchAll(/levels: \[([^\]]*)\]/g)].flatMap(m => [...m[1].matchAll(/'([^']+)'/g)].map(k => k[1]));
if (!keys.length) throw new Error('не нашёл уровни кампании в src/campaign.ts');
const only = process.env.LEVEL;

let failed = 0;
for (const key of keys) {
  if (only && key !== only) continue;
  const level = JSON.parse(readFileSync(join(root, 'levels', `${key}.json`), 'utf8'));
  const p = plans[key] ?? {};
  const lane = String(p.lane ?? 1);
  const env = { ...process.env, LEVEL: level.name, LANE: lane, PLAN: p.plan ?? '', LOOK: String(p.look ?? 220), FRAMES: String(p.frames ?? 4000),
    TAKE: p.take ?? '', CLEAN: '1', KEEPRAMP: '1', KEEPCOP: '1' };
  const r = spawnSync(process.execPath, [join(here, 'routebot.mjs')], { env, encoding: 'utf8' });
  const line = (r.stdout ?? '').split('\n').find(s => s.startsWith(`полоса ${lane}:`)) ?? `ошибка: ${(r.stderr ?? '').split('\n').find(Boolean) ?? 'нет вывода'}`;
  const ok = /^полоса \d: (done|trap) /.test(line);
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${key.padEnd(13)} ${level.name.padEnd(24)} ${line.replace(/^полоса \d: /, '').replace(' | без переходов', '')}${p.plan ? `  [${p.plan}]` : ''}`);
}
console.log(failed ? `\nНЕ ДОЕХАЛ: ${failed}` : '\nВСЕ УРОВНИ КАМПАНИИ ПРОХОДИМЫ');
process.exit(failed ? 1 : 0);
