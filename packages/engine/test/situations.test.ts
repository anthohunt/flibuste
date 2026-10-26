import { describe, expect, it } from 'vitest';
import { runSituation } from '../situations/run';
import type { Situation } from '../situations/types';

// Chaque situation du catalogue est une mini-partie jouée dans le moteur ; l'attendu vient des règles
// officielles. Un échec liste les écarts, un par ligne. Tout fichier `situations/<carte>.ts` qui exporte
// un tableau de situations est pris en compte automatiquement.
const modules = (import.meta as unknown as { glob: (pattern: string, opts: { eager: true }) => Record<string, Record<string, unknown>> }).glob('../situations/*.ts', { eager: true });
const isSituation = (x: unknown): x is Situation => typeof x === 'object' && x !== null && 'id' in x && 'spec' in x && 'expect' in x;
const CATALOGUE: Situation[] = [];
for (const [path, mod] of Object.entries(modules)) {
  if (/\/(types|run|index)\.ts$/.test(path)) continue;
  for (const value of Object.values(mod)) if (Array.isArray(value) && value.length > 0 && value.every(isSituation)) CATALOGUE.push(...(value as Situation[]));
}

const byCard = new Map<string, Situation[]>();
for (const s of CATALOGUE) byCard.set(s.card, [...(byCard.get(s.card) ?? []), s]);

describe('catalogue', () => {
  it('contient des situations', () => expect(CATALOGUE.length).toBeGreaterThan(0));
  it('identifiants uniques', () => {
    const ids = CATALOGUE.map((s) => s.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });
  it('chaque identifiant commence par le nom de sa fiche', () => {
    expect(CATALOGUE.filter((s) => !s.id.startsWith(`${s.card}-`)).map((s) => s.id)).toEqual([]);
  });
});

for (const [card, situations] of byCard) {
  describe(`situations : ${card}`, () => {
    for (const s of situations) {
      it(`${s.id} — ${s.title}`, () => {
        const { failures } = runSituation(s);
        expect(failures, `${s.rule}\n${failures.join('\n')}`).toEqual([]);
      });
    }
  });
}
