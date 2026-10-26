import { SITUATIONS_BY_ID, type Situation } from './situations';
import type { ScenarioDone } from './scenario';

export interface TutorialLesson { situation: Situation; goal: string; retry: string; }
const base = { kraken: false, whale: false, loot: false, pirateAbilities: false, rounds: 1 };
const players = ['me', 'anne', 'bob'];
function from(id: string, goal: string, retry: string): TutorialLesson {
  const source = SITUATIONS_BY_ID[id]!;
  return { goal, retry, situation: { ...source, id: `tutorial-${id}`, spec: { ...source.spec, rules: { ...source.spec.rules, ...base } } } };
}
export const TUTORIAL: readonly TutorialLesson[] = [
  { goal: 'Annonce 1 pli, puis joue ton atout noir.', retry: 'Ton atout gagne cet unique pli : il fallait annoncer 1 pour obtenir 20 points.', situation: {
    id: 'tutorial-bid', card: 'roger', title: 'Annoncer son pari', format: 'round',
    prompt: 'Un pli réunit une carte de chaque joueur. Tu as un seul atout noir : annonce 1 pli, puis joue-le. Le but est de gagner exactement ton pari.',
    lesson: 'Un pari de 1 tenu rapporte 20 points. Un pari positif raté coûte 10 points par pli d’écart ; les bonus ne sont acquis que si le pari est tenu.',
    spec: { rules: base, players, me: 'me', dealer: 'bob', phase: 'bidding', hands: { me: ['roger-13'], anne: ['parrot-2'], bob: ['chest-3'] } },
    script: { bids: { anne: 0, bob: 0 }, plays: { anne: ['parrot-2'], bob: ['chest-3'] } },
    mine: [{ bid: 1 }, { card: 'roger-13' }], expected: { score: { me: 20, anne: 10, bob: 10 } },
  } },
  from('parrot-follow-suit', 'Joue le 13 Albatros pour suivre la couleur.', 'Il faut suivre le Albatros demandé lorsque tu en as. Les cartes spéciales feront exception, dans les prochaines étapes.'),
  from('chest-other-colour-never-wins', 'Suis le Doublon et gagne avec le 10.', 'Le 14 Albatros est plus grand, mais il n’appartient pas à la couleur demandée.'),
  from('roger-trumps', 'Coupe avec le 2 Pavillon.', 'Tu n’as pas de Albatros : tu peux jouer le noir, qui bat tous les numéros des trois autres couleurs.'),
  from('escape-dodge', 'Joue la Fuite pour éviter ce pli.', 'Le 13 Doublon te ferait gagner ce pli. La Fuite peut se jouer même si tu as la couleur demandée.'),
  { goal: 'Joue le pirate pour battre l’atout.', retry: 'Un pirate bat tous les numéros, y compris les atouts noirs.', situation: {
    id: 'tutorial-pirate', card: 'helm', title: 'Le pirate bat les numéros', format: 'trick',
    prompt: 'Anne a posé un 13 noir. Ton pirate peut le battre : sélectionne-le puis confirme sa pose.',
    lesson: 'Les pirates battent tous les numéros. Les cartes spéciales peuvent se jouer même quand tu as la couleur demandée.',
    spec: { rules: base, players, me: 'me', hands: { me: ['pirate-helm', 'roger-2'], anne: ['chest-2'], bob: ['chest-5'] }, bids: { me: 1, anne: 0, bob: 0 }, trick: { leader: 'anne', plays: [{ player: 'anne', card: 'roger-13' }, { player: 'bob', card: 'roger-9' }] } },
    mine: [{ card: 'pirate-helm' }], expected: { winner: 'me', nextLeader: 'me' },
  } },
  from('flibuste-beats-pirate', 'Joue le Roi des Flibustiers pour capturer le pirate.', 'Le Roi des Flibustiers bat les pirates et les numéros. Essaie de le poser.'),
  from('mermaid-catches-king', 'Joue la Sirène pour capturer le Roi des Flibustiers.', 'La Sirène bat le Roi des Flibustiers. Elle rapporte alors un bonus si ton pari est tenu.'),
  from('mermaid-loses-to-pirate', 'Capture la Sirène avec ton pirate.', 'La Sirène bat le roi, mais un pirate bat la Sirène lorsqu’il n’y a pas de Roi des Flibustiers dans ce pli.'),
  from('tigress-as-pirate', 'Choisis la Tigresse en pirate.', 'La Tigresse se déclare au moment de la jouer : choisis Pirate pour battre la Sirène.'),
  from('tigress-as-escape', 'Choisis la Tigresse en fuite.', 'Pour éviter ce pli, choisis Fuite lors de la déclaration de la Tigresse.'),
  { goal: 'Annonce 0 pli, puis joue ta Fuite.', retry: 'La Fuite laisse le pli à Bob. Annoncer 0 était le pari à tenir ici.', situation: {
    id: 'tutorial-zero-score', card: 'escape', title: 'Le pari à zéro et les points', format: 'round',
    prompt: 'Tu n’as qu’une Fuite : annonce 0, puis joue-la. Tu vas comparer ton pari au résultat réel.',
    lesson: 'Un pari à 0 tenu rapporte 10 points par carte distribuée : ici +10. Raté, il coûte autant. En partie classique, on distribue de 1 à 10 cartes au fil des manches.',
    spec: { rules: base, players, me: 'me', dealer: 'bob', phase: 'bidding', hands: { me: ['escape-1'], anne: ['parrot-2'], bob: ['parrot-3'] } },
    script: { bids: { anne: 0, bob: 1 }, plays: { anne: ['parrot-2'], bob: ['parrot-3'] } },
    mine: [{ bid: 0 }, { card: 'escape-1' }], expected: { score: { me: 10, anne: 10, bob: 20 } },
  } },
  from('map-14-bonus', 'Suis le Compas avec le 2.', 'Tu as la couleur demandée : tu dois la suivre, même avec un atout en main. Le 14 capturé porte un bonus.'),
];

/** Réussite issue du vrai moteur, jamais du simple clic sur Suivante. */
export function tutorialSucceeded(lesson: TutorialLesson, done: ScenarioDone): boolean {
  const sit = lesson.situation;
  const played = done.state.history.flatMap(trick => trick.plays).filter(play => play.player === sit.spec.me);
  const required = sit.mine.filter(move => 'card' in move);
  if (required.length !== played.length || required.some((move, index) => {
    if (!('card' in move)) return false;
    const actual = played[index];
    return actual?.card.id !== move.card || actual?.as !== move.as;
  })) return false;
  if (sit.mine.some(move => 'bid' in move && done.state.bids[sit.spec.me] !== move.bid)) return false;
  const expected = lesson.situation.expected;
  if (expected.score) return Object.entries(expected.score).every(([id, total]) => done.scores.find(s => s.player === id)?.total === total);
  return !!done.trick && done.trick.winner === expected.winner;
}
