import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const page = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // allowedHosts — чтобы dev-сервер отвечал через туннель cloudflared (Vite 6 иначе режет чужой Host)
  server: { host: true, allowedHosts: ['.trycloudflare.com'] },
  build: {
    rollupOptions: {
      input: { main: page('index.html'), editor: page('editor/index.html') },
    },
  },
});
