import { describe, expect, it } from 'vitest';
import { describeCardFr, describeRoundFr, describeTrickFr } from '../src/describe';
import { resolveTrick } from '../src/trick';
import { GHOST_ID, type Play, type RoundScore, type TrickRecord } from '../src/types';
import { davy, escape, flex14, kraken, loot, mate, mermaid, num, pirate, plank, plays, sk, stingray, storm, tigress, volley, whale, wild15, x7, x8 } from './helpers';

const NAMES = { a: 'Anne', b: 'Bob', c: 'Cléo', d: 'Dan' };

function record(ps: Play[], over: Partial<TrickRecord> = {}): TrickRecord {
  const r = resolveTrick(ps);
  const rec: TrickRecord = { leader: ps[0]!.player, plays: ps, winner: r.winner, captured: r.captured, whale: r.whale, kraken: r.kraken, stingray: r.stingray, ...over };
  if (ps.some((p) => p.card.kind === 'storm')) rec.storm = true;
  return rec;
}

describe('describeCardFr', () => {
  it('names every kind of card in French', () => {
    expect(describeCardFr(num('roger', 14))).toBe('le 14 noir');
    expect(describeCardFr(num('parrot', 3))).toBe('le 3 vert');
    expect(describeCardFr(num('map', 7))).toBe('le 7 violet');
    expect(describeCardFr(x8('chest'))).toBe('le 8 jaune additionnel');
    expect(describeCardFr(flex14('chest'), 14)).toBe('le 0/14 jaune (déclaré 14)');
    expect(describeCardFr(wild15, 'parrot')).toBe('le 15 joker (en vert)');
    expect(describeCardFr(tigress, 'pirate')).toBe('la Tigresse (en pirate)');
    expect(describeCardFr(pirate('hexer'))).toBe('Mathilde la Sorcière');
    for (const c of [sk, mermaid(), kraken, whale, loot(), mate, volley, plank, stingray, davy, storm, escape()]) expect(describeCardFr(c).length).toBeGreaterThan(3);
  });
});

describe('describeTrickFr — one sentence per kind of resolution', () => {
  it('plain number, black trumps, 14 bonus; names fall back to the id', () => {
    expect(describeTrickFr(record(plays(num('parrot', 9), num('parrot', 12), num('parrot', 3))), NAMES)).toBe('Bob remporte le pli avec le 12 vert.');
    expect(describeTrickFr(record(plays(num('parrot', 9), num('roger', 2), num('parrot', 14))), NAMES)).toBe('Bob remporte le pli avec le 2 noir, qui coupe (+10).');
    expect(describeTrickFr(record(plays(num('parrot', 9), num('roger', 14), num('parrot', 3))), NAMES)).toBe('Bob remporte le pli avec le 14 noir, qui coupe (+20).');
    expect(describeTrickFr(record(plays(num('parrot', 9), num('parrot', 12))), {})).toBe('b remporte le pli avec le 12 vert.');
  });

  it('several bonuses are itemised', () => {
    const s = describeTrickFr(record(plays(num('roger', 14), num('parrot', 14), x8('parrot'))), NAMES);
    expect(s).toBe('Anne remporte le pli avec le 14 noir (le 14 noir +20, le 14 vert +10, le 8 vert additionnel +5 : +35).');
    expect(describeTrickFr(record(plays(num('roger', 10), x7('parrot'))), NAMES)).toBe('Anne remporte le pli avec le 10 noir (−5).');
  });

  it('characters: pirate captures a mermaid, Roi des Flibustiers captures pirates, mermaid captures the Roi des Flibustiers, first pirate wins', () => {
    expect(describeTrickFr(record(plays(mermaid(), pirate('helm'), num('parrot', 3))), NAMES)).toBe('Bob remporte le pli avec Maren la Timonière, qui capture la Sirène (+20).');
    expect(describeTrickFr(record(plays(mermaid(1), [tigress, 'pirate'], mermaid(2))), NAMES)).toBe('Bob remporte le pli avec la Tigresse (en pirate), qui capture les deux Sirènes (+40).');
    expect(describeTrickFr(record(plays(pirate('helm'), sk, pirate('adjuster'))), NAMES)).toBe('Bob remporte le pli avec le Roi des Flibustiers, qui capture 2 pirates (+60).');
    expect(describeTrickFr(record(plays(sk, pirate('helm'), mermaid())), NAMES)).toBe('Cléo remporte le pli avec la Sirène, qui capture le Roi des Flibustiers (+40).');
    expect(describeTrickFr(record(plays(pirate('helm'), pirate('adjuster'))), NAMES)).toBe('Anne remporte le pli avec Maren la Timonière (le premier pirate joué).');
    expect(describeTrickFr(record(plays(mermaid(1), mermaid(2))), NAMES)).toBe('Anne remporte le pli avec la Sirène (la première Sirène jouée).');
  });

  it('the Second: beats pirates and inherits their power; captured by the Roi des Flibustiers or a mermaid', () => {
    expect(describeTrickFr(record(plays(pirate('helm'), mate)), NAMES)).toBe('Bob remporte le pli avec le Second, qui hérite du pouvoir du pirate capturé.');
    expect(describeTrickFr(record(plays(mate, sk)), NAMES)).toBe('Bob remporte le pli avec le Roi des Flibustiers, qui capture le Second (+30).');
    // FONC-02 : pirate ET Second dans le même pli — chacun nommé, comme la sirène l'est déjà.
    expect(describeTrickFr(record(plays(mate, pirate('helm'), sk)), NAMES)).toBe('Cléo remporte le pli avec le Roi des Flibustiers, qui capture un pirate et le Second (le Second capturé +30, le pirate capturé +30 : +60).');
    expect(describeTrickFr(record(plays(mate, mermaid())), NAMES)).toBe('Bob remporte le pli avec la Sirène (+30).');
  });

  it('escapes: the first one wins an all-escape trick (Tigress, Butin, Tempête included)', () => {
    expect(describeTrickFr(record(plays(escape(), [tigress, 'escape'], escape(2))), NAMES)).toBe('Anne remporte le pli avec la Fuite (que des fuites : la première jouée l’emporte).');
    expect(describeTrickFr(record(plays(escape(), num('parrot', 5))), NAMES)).toBe('Bob remporte le pli avec le 5 vert.');
  });

  it('the Kraken: who would have won leads; alone with escapes, the Kraken player leads', () => {
    expect(describeTrickFr(record(plays(num('parrot', 9), sk, kraken)), NAMES)).toBe("Le Kraken détruit le pli : Bob aurait gagné avec le Roi des Flibustiers, c’est Bob qui mène.");
    expect(describeTrickFr(record(plays(kraken, escape(), escape(2))), NAMES)).toBe("Le Kraken détruit le pli : personne ne le remporte, c’est Anne qui mène.");
  });

  it('the Baleine: highest number wins, characters swept (number bonuses kept); no number → discarded', () => {
    expect(describeTrickFr(record(plays(sk, num('parrot', 14), whale, num('roger', 3))), NAMES)).toBe('La Baleine blanche balaie les cartes spéciales, le plus haut numéro l’emporte : Bob remporte le pli avec le 14 vert (+10).');
    expect(describeTrickFr(record(plays(sk, whale)), NAMES)).toBe('La Baleine blanche balaie le pli : aucun numéro, personne ne le remporte, Bob relance.');
  });

  it('the Raie: lowest number wins; the last leviathan acts, the others become escapes or nothing', () => {
    expect(describeTrickFr(record(plays(num('parrot', 9), stingray, num('roger', 2))), NAMES)).toBe('La Raie tachetée balaie les cartes spéciales, le plus petit numéro l’emporte : Cléo remporte le pli avec le 2 noir.');
    const s = describeTrickFr(record(plays(kraken, num('parrot', 9), whale)), NAMES);
    expect(s).toBe("Le Kraken d’Anne n’agit pas (un autre léviathan a suivi) : il vaut une Fuite. La Baleine blanche balaie les cartes spéciales, le plus haut numéro l’emporte : Bob remporte le pli avec le 9 vert.");
    expect(describeTrickFr(record(plays(stingray, num('parrot', 9), kraken)), NAMES)).toBe("La Raie tachetée d’Anne n’agit pas (un autre léviathan a suivi). Le Kraken détruit le pli : Bob aurait gagné avec le 9 vert, c’est Bob qui mène.");
  });

  it('the Casier de Davy Jones destroys every leviathan; the plank removes a pirate; only non-winning cards → discarded', () => {
    expect(describeTrickFr(record(plays(kraken, davy, num('parrot', 4))), NAMES)).toBe("Le Casier de Davy Jones de Bob engloutit le Kraken (+20 par léviathan pour Bob si son pari est réussi). Cléo remporte le pli avec le 4 vert.");
    expect(describeTrickFr(record(plays(davy, escape())), NAMES)).toBe("Le Casier de Davy Jones d’Anne n’a aucun léviathan à engloutir. Bob remporte le pli avec la Fuite (que des fuites : la première jouée l’emporte).");
    const removed: Play[] = [{ player: 'a', card: pirate('helm'), removed: true }, { player: 'b', card: plank }, { player: 'c', card: num('map', 6) }];
    expect(describeTrickFr(record(removed), NAMES)).toBe('Le Supplice de la planche de Bob écarte Maren la Timonière d’Anne. Cléo remporte le pli avec le 6 violet.');
    expect(describeTrickFr(record(plays(plank, davy)), NAMES)).toBe("Le Casier de Davy Jones de Bob n’a aucun léviathan à engloutir. Le Supplice de la planche d’Anne n’écarte aucun pirate. Aucune carte ne peut remporter ce pli : il est défaussé, Anne relance.");
  });

  it('the Butin seals an alliance; the Tempête announces the pass; the Dernière salve replays', () => {
    expect(describeTrickFr(record(plays(loot(), num('parrot', 8), num('parrot', 2))), NAMES)).toBe('Bob remporte le pli avec le 8 vert. Le Butin d’Anne scelle une alliance avec Bob : +20 chacun si les deux réussissent leur pari.');
    expect(describeTrickFr(record(plays(storm, num('parrot', 8))), NAMES)).toBe('Bob remporte le pli avec le 8 vert. La Tempête se lève : avant le pli suivant, chacun passe une carte de son choix à son voisin de gauche.');
    const v: Play[] = [{ player: 'a', card: volley }, { player: 'b', card: num('parrot', 8) }, { player: 'a', card: num('parrot', 11) }];
    expect(describeTrickFr(record(v), NAMES)).toBe('Dernière salve : Anne rejoue le 11 vert après tout le monde. Anne remporte le pli avec le 11 vert.');
  });

  it('Vieux Loup wins for nobody; the 0/14, the 15 joker', () => {
    const g: Play[] = [{ player: 'a', card: num('parrot', 3) }, { player: GHOST_ID, card: num('parrot', 12) }, { player: 'b', card: num('parrot', 5) }];
    expect(describeTrickFr(record(g), NAMES)).toBe('Vieux Loup remporte le pli avec le 12 vert : il ne compte pour personne.');
    expect(describeTrickFr(record(plays(num('chest', 9), [flex14('chest'), 14])), NAMES)).toBe('Bob remporte le pli avec le 0/14 jaune (déclaré 14).');
    expect(describeTrickFr(record(plays([wild15, 'map'], num('map', 14))), NAMES)).toBe('Anne remporte le pli avec le 15 joker (en violet) (+10).');
  });
});

// CT-09 — « Le Kraken de Anne » : le patron `de ${nom}` n'élidait pas. Le verrou porte sur TOUTES les phrases
// du moteur, pour qu'une nouvelle formulation ne réintroduise pas la faute.
describe('élision — jamais « de » devant une voyelle', () => {
  const VOYELLE = { a: 'Anne', b: 'Alix', c: 'Ines' };
  const phrases = (): string[] => [
    describeTrickFr(record(plays(kraken, num('parrot', 9), whale)), VOYELLE),
    describeTrickFr(record(plays(stingray, num('parrot', 9), kraken)), VOYELLE),
    describeTrickFr(record(plays(davy, escape())), VOYELLE),
    describeTrickFr(record(plays(kraken, davy, num('parrot', 4))), VOYELLE),
    describeTrickFr(record(plays(plank, davy)), VOYELLE),
    describeTrickFr(record(plays(loot(), num('parrot', 8), num('parrot', 2))), VOYELLE),
    describeTrickFr(record([{ player: 'a', card: pirate('helm'), removed: true }, { player: 'b', card: plank }, { player: 'c', card: num('map', 6) }]), VOYELLE),
    describeTrickFr(record([{ player: 'a', card: volley }, { player: 'b', card: num('parrot', 8) }]), VOYELLE),
  ];
  it('aucune phrase ne contient « de Anne / de Alix / de Ines »', () => {
    for (const s of phrases()) for (const n of Object.values(VOYELLE)) expect(s, s).not.toContain(`de ${n}`);
  });
  it('les élisions sont bien écrites, avec l’apostrophe typographique', () => {
    const all = phrases().join(' ');
    expect(all).toContain('d’Anne');
    expect(all).not.toContain("d'Anne");
  });
  it('« de » reste devant une consonne', () => {
    expect(describeTrickFr(record(plays(loot(), num('parrot', 8), num('parrot', 2))), NAMES)).toContain('Le Butin d’Anne');
    expect(describeTrickFr(record(plays(loot(), num('parrot', 8), num('parrot', 2))), { a: 'Bob', b: 'Cléo', c: 'Zoé' })).toContain('Le Butin de Bob');
  });
});

describe('describeRoundFr', () => {
  const score = (over: Partial<RoundScore>): RoundScore => ({ round: 3, player: 'a', bid: 1, effectiveBid: 1, tricks: 1, made: true, base: 20, bonus: 0, gambler: 0, loot: 0, total: 20, ...over });

  it('made bid, itemised bonus from the tricks won', () => {
    const won = [record(plays(mermaid(), pirate('helm')), { winner: 'a' })];
    won[0]!.plays = [{ player: 'b', card: mermaid() }, { player: 'a', card: pirate('helm') }];
    expect(describeRoundFr(score({ bonus: 20, total: 40 }), NAMES, won)).toBe('Anne — pari 1, 1 pli : +20, la Sirène capturée +20 = +40.');
    expect(describeRoundFr(score({ bonus: 20, total: 40 }), NAMES)).toBe('Anne — pari 1, 1 pli : +20, bonus +20 = +40.');
    expect(describeRoundFr(score({ bonus: 20, total: 40 }), {})).toBe('a — pari 1, 1 pli : +20, bonus +20 = +40.');
  });

  it('zero bids, failed bids, Gaspard, Rufus, Butin', () => {
    expect(describeRoundFr(score({ bid: 0, effectiveBid: 0, tricks: 0, base: 30, total: 30 }), NAMES)).toBe('Anne — pari 0, 0 pli : +30 = +30.');
    expect(describeRoundFr(score({ bid: 0, effectiveBid: 0, tricks: 2, made: false, base: -30, total: -30 }), NAMES)).toBe('Anne — pari 0, 2 plis (raté) : −30 = −30.');
    expect(describeRoundFr(score({ bid: 2, effectiveBid: 2, tricks: 3, made: false, base: -10, total: -10 }), NAMES)).toBe('Anne — pari 2, 3 plis (raté) : −10 = −10.');
    expect(describeRoundFr(score({ bid: 1, effectiveBid: 2, tricks: 2, base: 40, total: 40 }), NAMES)).toBe('Anne — pari 1 (2 après Gaspard l’Ajusteur), 2 plis : +40 = +40.');
    expect(describeRoundFr(score({ gambler: 10, loot: 20, total: 50 }), NAMES)).toBe('Anne — pari 1, 1 pli : +20, pari annexe de Rufus +10, alliance du Butin +20 = +50.');
    expect(describeRoundFr(score({ made: false, tricks: 0, base: -10, gambler: -20, total: -30 }), NAMES)).toBe('Anne — pari 1, 0 pli (raté) : −10, pari annexe de Rufus −20 = −30.');
  });

  it('the Casier bonus (not carried by a won trick) is shown apart', () => {
    const won = [record(plays(num('roger', 14), num('parrot', 2)), { winner: 'a' })];
    expect(describeRoundFr(score({ bonus: 40, total: 60 }), NAMES, won)).toBe('Anne — pari 1, 1 pli : +20, le 14 noir +20, Casier de Davy Jones +20 = +60.');
  });
});
