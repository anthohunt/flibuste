// Chantier 1.D — « le texte qui ment ». Ces tests verrouillent les écarts CT-01, CT-04, CT-05, CT-10 et CT-11 :
// une fiche du codex ne doit jamais enseigner l'inverse de ce que le moteur applique, et l'indication affichée
// au moment de poser une carte ne doit jamais perdre la limite de cette carte.
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import Hand from '../components/Hand.svelte';
import { CODEX, CODEX_BY_ID } from '../lib/codex';
import { SUIT_COLOUR_WORD } from '../lib/cardMeta';
import type { Card } from '../lib/types';

/**
 * Ce que `Hand.svelte` affiche vraiment sous une carte levée : la première phrase de la fiche, tronquée à
 * 120 caractères (`Hand.svelte`, `rule()`). Le test refait le calcul pour couvrir les 25 fiches d'un coup ;
 * le comportement réel du composant est vérifié juste après, sur les cartes qui avaient perdu leur limite.
 */
function indicationDeLevee(short: string): string {
  const cut = short.indexOf('. ');
  const first = cut > 30 ? short.slice(0, cut + 1) : short;
  return first.length > 120 ? `${first.slice(0, 117)}…` : first;
}

describe('CT-01 — l’indication affichée à la levée garde la limite de la carte', () => {
  it('aucune fiche n’est coupée en plein mot', () => {
    const coupees = CODEX.filter((e) => indicationDeLevee(e.short).endsWith('…')).map((e) => e.id);
    expect(coupees).toEqual([]);
  });

  it('les 7 cartes du constat gardent gagne ET perd dans la phrase affichée', () => {
    // Avant : « Bat tous les numéros et capture le Roi des Flibustiers (+40). » — « Perd contre n’importe quel pirate » sautait.
    const attendu: Record<string, RegExp> = {
      mermaid: /perd contre/i,
      pirateking: /seule une sirène/i,
      whale: /ne valent plus rien/i,
      kraken: /mène le suivant/i,
      volley: /dernier pli/i,
      mate: /sirènes/i,
      wild15: /il perd/i,
    };
    for (const [id, re] of Object.entries(attendu)) {
      const texte = indicationDeLevee(CODEX_BY_ID[id]!.short);
      expect(texte, `fiche ${id}`).toMatch(re);
      expect(texte.length, `fiche ${id}`).toBeLessThanOrEqual(120);
    }
  });

  it('dans le composant : la Sirène levée affiche bien « perd contre n’importe quel pirate »', async () => {
    const card: Card = { id: 'mermaid-1', kind: 'mermaid' };
    const { container } = render(Hand, { props: { cards: [card], legalIds: new Set(['mermaid-1']) } });
    const btn = container.querySelector('button[data-card-id="mermaid-1"]') as HTMLElement;
    await fireEvent.pointerDown(btn, { pointerType: 'touch', button: 0 });
    const hint = container.querySelector('[data-testid="card-hint"]');
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toMatch(/Sirène/);
    expect(hint!.textContent).toMatch(/perd contre n’importe quel pirate/i);
  });
});

describe('CT-04 — mener avec une carte qui ne fixe pas la couleur', () => {
  it('la Fuite, le Butin et la Tigresse reportent la couleur après les fuites', () => {
    for (const id of ['escape', 'loot', 'tigress']) {
      expect(CODEX_BY_ID[id]!.cases.join(' '), `fiche ${id}`).toMatch(/première carte qui n’est pas une fuite/);
    }
  });
  it('plus aucune fiche ne dit « ne demande aucune couleur » pour une fuite', () => {
    // Le Roi des Flibustiers, lui, a le droit : mené, un personnage ne demande vraiment aucune couleur.
    const fuites = CODEX.filter((e) => e.tier === 'escape' || e.altTier === 'escape');
    expect(fuites.map((e) => e.cases.join(' ')).join(' ')).not.toMatch(/ne demande aucune couleur/);
  });
});

describe('CT-05 — la Dernière salve n’est pas une fuite', () => {
  it('la fiche le dit, comme le moteur (`effectiveKind` → `none`) et l’', () => {
    const cases = CODEX_BY_ID.volley!.cases.join(' ');
    expect(cases).not.toMatch(/reste une fuite/);
    expect(cases).toMatch(/ne compte pas comme une fuite/);
  });
});

describe('CT-10 / CT-11 — les fiches de couleur', () => {
  it('chaque fiche nomme la teinte qu’on voit sur la carte', () => {
    for (const [suit, mot] of Object.entries(SUIT_COLOUR_WORD)) {
      expect(CODEX_BY_ID[suit]!.short, `fiche ${suit}`).toContain(mot);
    }
  });
  it('le nom n’est ni décapitalisé ni accordé au masculin', () => {
    for (const suit of ['parrot', 'chest', 'map', 'roger']) {
      const short = CODEX_BY_ID[suit]!.short;
      expect(short, `fiche ${suit}`).not.toMatch(/si (albatros|doublon|compas|pavillon) est demandé/);
      expect(short, `fiche ${suit}`).not.toMatch(/\bcompas\b/);
    }
  });
});
