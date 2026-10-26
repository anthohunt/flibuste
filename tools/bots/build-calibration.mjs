import { build } from '../../node_modules/.pnpm/node_modules/esbuild/lib/main.js';
import { fileURLToPath } from 'node:url';

await build({
  entryPoints: [fileURLToPath(new URL('./src/calibrate.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('./dist/calibrate.mjs', import.meta.url)),
  bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'warning',
});
