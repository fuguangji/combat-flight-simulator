import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// VITE_BASE is set by CI to "/<repository-name>/" so assets resolve on GitHub Pages
// project sites. Locally it defaults to "/".
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), 'index.html'),
        editor: resolve(process.cwd(), 'editor/index.html'),
      },
    },
  },
  worker: { format: 'es' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
