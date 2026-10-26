// Build de production : le serveur et le worker des bots Difficile sont empaquetés en JS (ESM) dans
// dist/, moteur et bots inclus (ce sont des sources TypeScript du monorepo, sans build propre) ; les
// dépendances natives ou volumineuses restent externes et viennent de node_modules (deps prod).
import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external: ['better-sqlite3', 'ws', 'web-push'],
  logLevel: 'info',
};

await build({ ...shared, entryPoints: ['src/index.ts'], outfile: 'dist/index.js' });
await build({ ...shared, entryPoints: ['src/bot-worker.ts'], outfile: 'dist/bot-worker.js' });
