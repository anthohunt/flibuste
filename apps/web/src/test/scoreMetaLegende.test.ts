// Vague 2.B (UX-07) — la valeur des sceaux, leur légende, et la décomposition du total de la manche.
import { describe, expect, it } from 'vitest';
import { bonusGlyphs, partsTextFr, partsLabelFr, ruleTextFr, scoreParts, sealLegend, SEAL, type BonusGlyph } from '../lib/scoreMeta';
import type { RoundScore, TrickRecord } from '../lib/types';

const score = (p: Partial<RoundScore>): RoundScore => ({ round: 4, player: 'p1', bid: 2, effectiveBid: 2, tricks: 2, made: true, base: 40, bonus: 0, gambler: 0, loot: 0, total: 40, ...p });

describe('sealLegend', () => {
  it('une entrée par espèce, comptée et cumulée, la plus lourde d’abord', () => {
    const glyphs: BonusGlyph[] = [
      { kind: 'colour14', points: 10, name: '14 de couleur' },
      { kind: 'colour14', points: 10, name: '14 de couleur' },
      { kind: 'pirate', points: 30, name: 'Pirate capturé' },
    ];
    expect(sealLegend(glyphs)).toEqual([
      { kind: 'pirate', name: 'Pirate capturé', count: 1, points: 30 },
      { kind: 'colour14', name: '14 de couleur', count: 2, points: 20 },
    ]);
  });

  it('rien à légender quand la manche n’a produit aucun bonus', () => {
    expect(sealLegend([])).toEqual([]);
  });

  it('le 14 noir et le 14 de couleur ne portent plus le même nom (ils portaient le même texte « 14 »)', () => {
    const l = sealLegend([
      { kind: 'black14', points: 20, name: '14 noir' },
      { kind: 'colour14', points: 10, name: '14 de couleur' },
    ]);
    expect(l.map((e) => e.name)).toEqual(['14 noir', '14 de couleur']);
    expect(SEAL.black14.bg).not.toBe(SEAL.colour14.bg);
  });
});

describe('décomposition du total de la manche', () => {
  it('le pari d’abord, puis chaque famille de bonus', () => {
    expect(scoreParts(score({ base: 20, bonus: 50, total: 70 }))).toEqual([
      { label: 'pari', points: 20 },
      { label: 'bonus', points: 50 },
    ]);
    expect(partsTextFr(score({ base: 20, bonus: 50, total: 70 }))).toBe('+20 pari · +50 bonus');
  });

  it('le Rufus et le Butin ont leur propre part', () => {
    expect(partsTextFr(score({ base: 40, bonus: 0, gambler: -10, loot: 20, total: 50 }))).toBe('+40 pari · −10 Rufus · +20 Butin');
  });

  it('sans bonus, il ne reste que le pari', () => {
    expect(partsTextFr(score({ base: -10, total: -10, made: false, tricks: 3 }))).toBe('−10 pari');
  });

  it('la même chose, dite à un lecteur d’écran', () => {
    expect(partsLabelFr(score({ base: 20, bonus: 50, total: 70 }))).toBe('Détail : +20 points de pari, +50 points de bonus — total de la manche +70');
  });
});

describe('ruleTextFr — la règle appliquée, en trois mots', () => {
  it('pari tenu : les plis × 20', () => {
    expect(ruleTextFr(score({ tricks: 2, made: true }))).toBe('2 plis × +20');
    expect(ruleTextFr(score({ bid: 1, effectiveBid: 1, tricks: 1, made: true, base: 20 }))).toBe('1 pli × +20');
  });

  it('pari raté : l’écart × −10', () => {
    expect(ruleTextFr(score({ tricks: 4, made: false, base: -20 }))).toBe('2 plis d’écart × −10');
  });

  it('pari 0 : par carte distribuée, jamais par pli', () => {
    expect(ruleTextFr(score({ bid: 0, effectiveBid: 0, tricks: 0, made: true, base: 50 }))).toBe('+10 × 5 cartes');
    expect(ruleTextFr(score({ bid: 0, effectiveBid: 0, tricks: 2, made: false, base: -50 }))).toBe('−10 × 5 cartes');
  });
});

describe('après une Dernière salve, le sceau nomme la vraie capture', () => {
  // Le gagnant a DEUX cartes dans le pli : la Salve, qui ne peut rien gagner, et celle jouée après. L'écran
  // prenait la première — donc la Salve — et n'appliquait plus aucune règle de capture : les points restaient
  // justes (le moteur prend la bonne carte) mais le sceau devenait anonyme. Ce test tient les deux ensemble.
  it('la Sirène posée après la Salve capture bien le Roi des Flibustiers, et le sceau le dit', () => {
    const trick = {
      winner: 'a',
      plays: [
        { player: 'b', card: { id: 'pirateking', kind: 'pirateking' } },
        { player: 'a', card: { id: 'volley', kind: 'volley' } },
        { player: 'a', card: { id: 'mermaid-1', kind: 'mermaid' } },
      ],
    } as unknown as TrickRecord;
    const score = { round: 1, player: 'a', bid: 1, effectiveBid: 1, tricks: 1, made: true, base: 20, bonus: 40, gambler: 0, loot: 0, total: 60 } as RoundScore;
    const glyphs = bonusGlyphs(score, [trick]);
    expect(glyphs.map((g) => g.kind)).toContain('pirateking');
    expect(glyphs.find((g) => g.kind === 'pirateking')?.points).toBe(40);
    // Et le compte des sceaux colle au bonus que le moteur a réellement accordé : c'est ce qui prouve que
    // l'écran et le barème ne se sont pas remis à diverger.
    expect(glyphs.reduce((n, g) => n + g.points, 0)).toBe(score.bonus);
  });
});

describe('un bonus NET nul montre quand même ce qui s’est annulé', () => {
  // Le défaut rapporté par Alix sous « les points bonus ne sont pas comptés ». Les 7 de l'extension coûtent
  // 5 points chacun : un 14 de couleur (+10) et deux 7 additionnels (−10) donnent un bonus net de ZÉRO, et
  // l'écran n'affichait alors aucun sceau. Le 14 avait bien compté — rien ne le disait.
  const pli = (cartes: { id: string; kind: string; rank?: number; suit?: string; expansion?: boolean }[]) =>
    ({ winner: 'p1', plays: cartes.map((card) => ({ player: 'p1', card })) }) as unknown as TrickRecord;

  it('le 14 et les deux 7 additionnels sont tous les trois montrés', () => {
    const trick = pli([
      { id: 'map-14', kind: 'number', rank: 14, suit: 'map' },
      { id: 'parrot-7x', kind: 'number', rank: 7, suit: 'parrot', expansion: true },
      { id: 'roger-7x', kind: 'number', rank: 7, suit: 'roger', expansion: true },
    ]);
    const s = score({ bonus: 0, made: true, tricks: 2, bid: 2, effectiveBid: 2 });
    const glyphs = bonusGlyphs(s, [trick]);
    expect(glyphs.map((g) => g.kind).sort()).toEqual(['colour14', 'x7', 'x7']);
    expect(glyphs.reduce((n, g) => n + g.points, 0)).toBe(0);
  });

  it('mais un pari tenu sans le moindre bonus n’affiche RIEN — pas un sceau « +0 »', () => {
    const trick = pli([{ id: 'map-3', kind: 'number', rank: 3, suit: 'map' }]);
    expect(bonusGlyphs(score({ bonus: 0, made: true }), [trick])).toEqual([]);
  });

  it('un pari RATÉ reste muet ici : ses bonus perdus se disent ailleurs, en gris', () => {
    const trick = pli([{ id: 'map-14', kind: 'number', rank: 14, suit: 'map' }]);
    expect(bonusGlyphs(score({ bonus: 0, made: false, tricks: 3, bid: 1, effectiveBid: 1 }), [trick])).toEqual([]);
  });
});
