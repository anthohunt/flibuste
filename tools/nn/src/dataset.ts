// Transforme les parties enregistrees en tableaux de nombres, prets pour l'entrainement.
// Rejoue chaque partie (aucun bot rappele), encode chaque decision apprenable, ecrit quatre
// fichiers binaires plus un `meta.json` qui dit leurs dimensions.
//
//   node tools/nn/dist/dataset.mjs --in donnees --out jeu --max-parties 20000
//
// Les entrees sont quantifiees en octets (valeur x 255, bornee a [0,1]) : quatre fois plus petit
// qu'en flottants, et la precision perdue (1/255) est sans effet sur des indicateurs qui valent
// presque tous 0 ou 1.

import { createReadStream, createWriteStream, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { N_ACTIONS, N_CARDS, N_FEATURES, N_PLACES, actionIndex, encodeLocations, encodeMask, encodeView, isLearnable, unseenCards } from '@flibuste/bots';
import { replayGame } from './replay';
import type { RecordedGame } from './shared';

const at = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const IN = at('in') ?? 'donnees';
const OUT = at('out') ?? 'jeu';
const MAX = Number(at('max-parties') ?? Infinity);

mkdirSync(OUT, { recursive: true });
const fx = createWriteStream(join(OUT, 'x.bin'));
const fm = createWriteStream(join(OUT, 'masque.bin'));
const fa = createWriteStream(join(OUT, 'coup.bin'));
const fy = createWriteStream(join(OUT, 'y.bin'));
// Ou sont vraiment les cartes que le joueur ne voit pas, et lesquelles lui sont inconnues.
const fl = createWriteStream(join(OUT, 'lieu.bin'));
const flm = createWriteStream(join(OUT, 'lieu-masque.bin'));

const x = new Float32Array(N_FEATURES);
const xq = new Uint8Array(N_FEATURES);
const mask = new Uint8Array(N_ACTIONS);
const a16 = new Uint16Array(1);
const lieux = { lieu: new Uint8Array(N_CARDS), masque: new Uint8Array(N_CARDS) };
const y = new Float32Array(2);

let parties = 0;
let exemples = 0;
let ignorees = 0;

// `write` est asynchrone : il faut lui donner une COPIE, sinon le tampon est reecrit par l'exemple
// suivant avant d'avoir ete vide sur le disque (bug vu en vrai : tous les masques finissaient a 1).
const ecrire = (s: NodeJS.WritableStream, b: Uint8Array): void => { s.write(Buffer.from(b)); };

const fichiers = readdirSync(IN).filter((f) => f.endsWith('.jsonl'));
for (const f of fichiers) {
  if (parties >= MAX) break;
  const rl = createInterface({ input: createReadStream(join(IN, f)), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim() || parties >= MAX) continue;
    let g: RecordedGame;
    try { g = JSON.parse(line) as RecordedGame; } catch { ignorees++; continue; }
    // Une partie tronquee (le producteur a ete arrete en plein vol) ne doit pas casser le lot.
    try {
      replayGame(g, ({ view, action, seat, round, state }) => {
        if (!isLearnable(action)) return;
        const idx = actionIndex(action);
        if (idx < 0) return;
        encodeView(view, x);
        for (let i = 0; i < N_FEATURES; i++) xq[i] = Math.max(0, Math.min(255, Math.round(x[i]! * 255)));
        encodeMask(view, mask);
        a16[0] = idx;
        // Ce que la decision a rapporte : le score de SA manche, et le score final de la partie.
        y[0] = (g.rs[round - 1]?.[seat] ?? 0) / 100;
        y[1] = (g.sc[seat] ?? 0) / 300;
        ecrire(fx, xq);
        ecrire(fm, mask);
        ecrire(fa, new Uint8Array(a16.buffer.slice(0)));
        encodeLocations(view, state.hands, unseenCards(view), lieux);
        ecrire(fl, lieux.lieu);
        ecrire(flm, lieux.masque);
        ecrire(fy, new Uint8Array(y.buffer.slice(0)));
        exemples++;
      });
      parties++;
    } catch { ignorees++; }
  }
}

for (const s of [fx, fm, fa, fy, fl, flm]) s.end();
writeFileSync(join(OUT, 'meta.json'), JSON.stringify({
  versionEncodage: 2,
  entrees: N_FEATURES,
  coups: N_ACTIONS,
  cartes: N_CARDS,
  emplacements: N_PLACES,
  exemples,
  parties,
  partiesIgnorees: ignorees,
  formats: { 'x.bin': 'uint8 [exemples, entrees] (valeur/255)', 'masque.bin': 'uint8 [exemples, coups]', 'coup.bin': 'uint16 [exemples]', 'y.bin': 'float32 [exemples, 2] (score de la manche/100, score final/300)', 'lieu.bin': 'uint8 [exemples, cartes] (siege relatif du porteur : 0 moi, 1..5 adversaires, 6 Vieux Loup, 7 hors jeu)', 'lieu-masque.bin': 'uint8 [exemples, cartes] (1 = carte dont j ignore l emplacement)' },
}, null, 1));
process.stderr.write(`${parties} parties -> ${exemples} exemples (${N_FEATURES} entrees, ${N_ACTIONS} coups possibles), ${ignorees} ignorees, dans ${OUT}\n`);
