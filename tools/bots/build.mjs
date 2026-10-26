// Bundle l'arène pour Node 22 : les paquets du monorepo sont du TypeScript source, esbuild les
// résout par les liens pnpm de `tools/bots/node_modules/@flibuste/*`.
//
//   node tools/bots/build.mjs
//
// esbuild n'est pas une dépendance déclarée de l'arène (il est déjà dans le magasin pnpm du dépôt) :
// on le charge d'abord normalement, puis par son chemin hoisté.

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

async function loadEsbuild() {
  try {
    return await import('esbuild');
  } catch {
    const hoisted = join(root, 'node_modules/.pnpm/node_modules/esbuild/lib/main.js');
    if (!existsSync(hoisted)) throw new Error(`esbuild introuvable (ni resolu, ni dans ${hoisted})`);
    return await import(pathToFileURL(hoisted).href);
  }
}

const esbuild = await loadEsbuild();
const build = esbuild.build ?? esbuild.default?.build;

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  logLevel: 'warning',
  metafile: true,
};

// L'arene et son worker. Deux appels separes : esbuild calcule `outbase` sur l'ancetre commun des
// entrees, et melanger `src/` avec un fichier de `packages/` recreerait toute l'arborescence.
const app = await build({
  ...common,
  entryPoints: [
    { in: join(here, 'src/arena.ts'), out: 'arena' },
    { in: join(here, 'src/worker.ts'), out: 'worker' },
    { in: join(root, 'packages/bots/src/weights.ts'), out: 'weights' },
  ],
  outdir: join(here, process.argv[2] ?? 'dist'),
  outExtension: { '.js': '.mjs' },
});

// Les poids, pour la boucle d'entrainement : DEFAULT_WEIGHTS, WEIGHT_BOUNDS, weightsOf.
const weights = await build({
  ...common,
  entryPoints: [join(root, 'packages/bots/src/weights.ts')],
  outfile: join(here, 'dist/weights.mjs'),
});

const bytes = (r) => Object.values(r.metafile.outputs).reduce((s, o) => s + o.bytes, 0);
console.error(`arene bundlee : ${((bytes(app) + bytes(weights)) / 1024).toFixed(0)} Ko dans tools/bots/dist (arena.mjs, worker.mjs, weights.mjs)`);
