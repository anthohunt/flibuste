import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import TrickArea from '../components/TrickArea.svelte';
import { SAMPLE_NAMES } from '../lib/samples';
import type { TrickPlay } from '../lib/types';

const plays: TrickPlay[] = [
  { player: 'p2', card: { id: 'plank', kind: 'plank' } },
  { player: 'p3', card: { id: 'pirate-helm', kind: 'pirate', pirate: 'helm' }, removed: true },
  { player: 'p4', card: { id: 'parrot-014', kind: 'flex14', suit: 'parrot' }, as: 14 },
  { player: 'p1', card: { id: 'wild15', kind: 'wild15' }, as: 'parrot' },
];

describe('TrickArea', () => {
  it('garde une carte retirée dans son emplacement portrait avec sa marque de retrait', () => {
    const { container } = render(TrickArea, { props: { plays, names: SAMPLE_NAMES, positionOf: () => ({ x: 94, y: 50 }), offsetRemoved: false } });
    const removed = container.querySelector('[data-removed]') as HTMLElement;
    expect(removed.style.left).toBe('94%');
    expect(removed.querySelector('[data-removal="plank"]')).not.toBeNull();
  });
  it('barre et repousse un pirate retiré par la Planche, et affiche les déclarations 0/14 et 15 joker', () => {
    const { container } = render(TrickArea, { props: { plays, names: SAMPLE_NAMES, winnerId: 'p4', leaderId: 'p2' } });
    const removed = container.querySelector('[data-removed]') as HTMLElement;
    expect(removed).not.toBeNull();
    expect(removed.dataset.player).toBe('p3');
    expect(removed.querySelector('.saturate-50')).not.toBeNull();
    expect(removed.querySelector('path[d^="M4 4 L56 80"]')).not.toBeNull();
    // Poussé vers l'extérieur : plus loin du centre que les autres.
    const dist = (el: HTMLElement) => Math.hypot(parseFloat(el.style.left) - 50, parseFloat(el.style.top) - 50);
    const normal = container.querySelector('[data-player="p2"]') as HTMLElement;
    expect(dist(removed)).toBeGreaterThan(dist(normal) + 5);
    // Le pli reste à 4 cartes ; les déclarations sont sur les faces.
    expect(container.querySelectorAll('.play')).toHaveLength(4);
    expect(screen.getByRole('img', { name: 'Albatros 14' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Albatros 15' })).toBeInTheDocument();
    expect(container.querySelector('[data-winner]')?.getAttribute('data-player')).toBe('p4');
  });

  it('accepte N+1 cartes (Dernière salve) et les glyphes Raie / Casier', () => {
    const five: TrickPlay[] = [...plays, { player: 'p2', card: { id: 'stingray', kind: 'stingray' } }];
    const { container } = render(TrickArea, { props: { plays: five, names: SAMPLE_NAMES, marks: ['stingray', 'davy'] } });
    expect(container.querySelectorAll('.play')).toHaveLength(5);
    expect(container.querySelector('[data-mark="stingray"]')).not.toBeNull();
    expect(screen.getByRole('img', { name: 'Casier de Davy Jones' })).toBeInTheDocument();
  });

  it('pli défaussé par la Raie : icône au centre', () => {
    render(TrickArea, { props: { plays: [], names: SAMPLE_NAMES, discard: 'stingray' } });
    expect(screen.getByTestId('discard').querySelector('[data-icon="stingray"]')).not.toBeNull();
  });

  // UX-17 — l'instantané ARIA ne disait que « img "Compas 2" » : impossible de relire un pli au clavier.
  it('nomme le joueur de chaque carte, le meneur et le gagnant dans l’arbre ARIA', () => {
    const { container } = render(TrickArea, { props: { plays, names: SAMPLE_NAMES, winnerId: 'p4', leaderId: 'p2' } });
    const labels = [...container.querySelectorAll('.play')].map((el) => el.getAttribute('aria-label') ?? '');
    expect(labels).toHaveLength(4);
    for (const l of labels) expect(l).toMatch(/^[^:]+ : .+/);
    expect(labels.find((l) => l.includes('remporte le pli'))).toMatch(new RegExp(`^${SAMPLE_NAMES.p4}`));
    expect(labels.filter((l) => l.includes('remporte le pli'))).toHaveLength(1);
    expect(labels.find((l) => l.includes('meneur du pli'))).toMatch(new RegExp(`^${SAMPLE_NAMES.p2}`));
    expect(labels.find((l) => l.includes('écartée'))).toMatch(new RegExp(`^${SAMPLE_NAMES.p3}`));
  });
});
