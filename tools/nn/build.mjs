// Bundle le producteur de parties pour Node 22 (meme principe que l'arene : esbuild resout les
// paquets du monorepo par les liens pnpm).
//
//   node tools/nn/build.mjs
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

const out = await build({
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  logLevel: 'warning',
  metafile: true,
  entryPoints: [
    { in: join(here, 'src/record.ts'), out: 'record' },
    { in: join(here, 'src/worker-record.ts'), out: 'worker-record' },
    { in: join(here, 'src/replay.ts'), out: 'replay' },
    { in: join(here, 'src/dataset.ts'), out: 'dataset' },
    { in: join(here, 'src/parite.ts'), out: 'parite' },
    // Outil de l'autre chaine, conserve : il construit son propre generateur de parties.
    ...(existsSync(join(here, 'src/generer.ts')) ? [{ in: join(here, 'src/generer.ts'), out: 'generer' }] : []),
  ],
  outdir: join(here, 'dist'),
  outExtension: { '.js': '.mjs' },
});
const bytes = Object.values(out.metafile.outputs).reduce((s, o) => s + o.bytes, 0);
console.error(`producteur bundle : ${(bytes / 1024).toFixed(0)} Ko dans tools/nn/dist (record, worker-record, replay, dataset, parite, et generer s'il est la)`);
