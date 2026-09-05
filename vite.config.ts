import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const page = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  server: { host: true },
  build: {
    rollupOptions: {
      input: { main: page('index.html'), editor: page('editor/index.html') },
    },
  },
});
