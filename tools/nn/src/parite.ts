// Controle de parite : on rejoue, avec le code du JEU, les vecteurs que PyTorch a evalues, et on
// compare. Tant que cet ecart n'est pas minuscule, le jeu ne joue pas le reseau entraine.
//
//   node tools/nn/dist/parite.mjs --poids modele/reseau.bin --reference parite.json

import { readFileSync } from 'node:fs';
import { loadNetwork, netForward } from '@flibuste/bots';

const at = (n: string): string | undefined => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? undefined : process.argv[i + 1]; };
const poids = at('poids');
const ref = at('reference');
if (!poids || !ref) throw new Error('usage : parite.mjs --poids reseau.bin --reference parite.json');

const buf = readFileSync(poids);
const net = loadNetwork(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const attendu = JSON.parse(readFileSync(ref, 'utf8')) as { entrees: number[][]; logits: number[][]; points: number[] };

let ecartLogits = 0;
let ecartPoints = 0;
let memeChoix = 0;
for (let i = 0; i < attendu.entrees.length; i++) {
  const x = Float32Array.from(attendu.entrees[i]!);
  const { logits, points } = netForward(net, x);
  const cible = attendu.logits[i]!;
  for (let k = 0; k < cible.length; k++) ecartLogits = Math.max(ecartLogits, Math.abs(logits[k]! - cible[k]!));
  ecartPoints = Math.max(ecartPoints, Math.abs(points - attendu.points[i]!));
  let aJeu = 0; let aRef = 0;
  for (let k = 1; k < cible.length; k++) { if (logits[k]! > logits[aJeu]!) aJeu = k; if (cible[k]! > cible[aRef]!) aRef = k; }
  if (aJeu === aRef) memeChoix++;
}
const n = attendu.entrees.length;
process.stderr.write(`parite sur ${n} exemples : ecart max des scores ${ecartLogits.toFixed(4)}, ecart max des points ${ecartPoints.toFixed(4)}, meme coup choisi ${memeChoix}/${n}\n`);
if (memeChoix !== n) { process.stderr.write('ECHEC : le jeu ne choisirait pas le meme coup que PyTorch\n'); process.exit(1); }
