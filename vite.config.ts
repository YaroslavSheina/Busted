import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const page = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Номер сборки — в настройках, на загрузочном экране и в журнале попыток: заметка тестера относится к конкретной версии.
// Короткий хэш коммита и его дата; «+» — в рабочей копии есть незакоммиченные правки (так выглядит dev-сервер во время работы)
function buildId(): string {
  try {
    const git = (cmd: string) => execSync(`git ${cmd}`, { cwd: page('.') }).toString().trim();
    return `${git('rev-parse --short HEAD')}${git('status --porcelain') ? '+' : ''} · ${git('log -1 --format=%cd --date=format:%d.%m')}`;
  } catch { return 'dev'; }
}

export default defineConfig({
  define: { __BUILD__: JSON.stringify(buildId()) },
  // allowedHosts — чтобы dev-сервер отвечал через туннель cloudflared (Vite 6 иначе режет чужой Host)
  server: { host: true, allowedHosts: ['.trycloudflare.com'] },
  build: {
    rollupOptions: {
      input: { main: page('index.html'), editor: page('editor/index.html') },
    },
  },
});
