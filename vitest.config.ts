import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // `server/` a son propre runner (`node:test`) : `npm run test:crop` / `test:fonts` côté serveur.
    exclude: ['**/node_modules/**', '**/dist/**', 'server/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
