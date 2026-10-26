// Rejoue une partie enregistree SANS jamais rappeler un bot : a chaque decision on reprend le
// `m[i]`-ieme coup legal. Sert (a) de controle — les scores rejoues doivent etre les scores
// enregistres — et (b) de source des exemples d'entrainement : c'est ici qu'on voit la vue du
// joueur au moment ou il a choisi.
//
//   node tools/nn/dist/replay.mjs --in data/parties-XXX.jsonl [--limit 100]

import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import { actorsOf, apply, newGame, viewFor, type Action, type GameState, type PlayerView } from '@flibuste/engine';
import { rulesOf, type RuleSetId } from '../../bots/src/core';
import type { RecordedGame } from './shared';

/** Une decision rejouee : la vue telle qu'elle etait, le coup choisi, et le siege qui choisissait. */
export interface ReplayStep {
  view: PlayerView;
  action: Action;
  seat: number;
  round: number;
  /** L'etat COMPLET au moment de la decision — la ou sont vraiment les cartes. Ne jamais le donner
   *  a un bot : il sert uniquement a fabriquer la cible du reseau d'inference. */
  state: GameState;
}

/** Rejoue la partie et appelle `onStep` a chaque decision. Renvoie les scores finaux par siege. */
export function replayGame(g: RecordedGame, onStep?: (s: ReplayStep) => void): number[] {
  const players = Array.from({ length: g.n }, (_, i) => `p${i}`);
  let s: GameState = newGame(players, rulesOf(g.r as RuleSetId), g.s);
  let i = 0;
  while (s.phase !== 'gameOver') {
    const actor = actorsOf(s)[0];
    if (!actor) throw new Error(`aucun acteur en phase ${s.phase}`);
    const view = viewFor(s, actor);
    const pick = g.m[i++];
    if (pick === undefined) throw new Error(`partie ${g.s} : coups manquants a la decision ${i}`);
    const action = view.legal[pick];
    if (!action) throw new Error(`partie ${g.s} : rang ${pick} hors des ${view.legal.length} coups legaux`);
    onStep?.({ view, action, seat: players.indexOf(actor), round: s.round, state: s });
    s = apply(s, action);
  }
  if (i !== g.m.length) throw new Error(`partie ${g.s} : ${g.m.length - i} coups en trop`);
  return players.map((p) => s.scores[p] ?? 0);
}

// Le bloc ci-dessous est le CLI de `replay.mjs`. Il doit rester muet quand ce fichier est bundle
// DANS un autre outil (dataset.mjs), sinon il relit `--in` a sa facon : d'ou le test sur le nom.
if (process.argv[1]?.endsWith('replay.mjs')) {
  const at = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? undefined : process.argv[i + 1]; };
  const file = at('in');
  if (!file) throw new Error('usage : replay.mjs --in <fichier.jsonl> [--limit N]');
  const limit = Number(at('limit') ?? Infinity);
  let ok = 0;
  let steps = 0;
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim() || ok >= limit) continue;
    const g = JSON.parse(line) as RecordedGame;
    const scores = replayGame(g, () => { steps++; });
    if (scores.join(',') !== g.sc.join(',')) throw new Error(`partie ${g.s} : rejeu ${scores} != enregistre ${g.sc}`);
    ok++;
  }
  process.stderr.write(`${ok} parties rejouees a l'identique, ${steps} decisions revues\n`);
}
