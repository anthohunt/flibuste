// Vague 2.B (UX-05, A11Y-15) — la plaque d'un joueur : « 0/? 0 » se lisait sans légende, la coche verte
// s'affichait avant le premier pli, le score était un nœud texte nu, et ma propre plaque inversait l'ordre de
// lecture par rapport aux autres sièges.
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import PlayerBadge from '../components/PlayerBadge.svelte';

const order = (el: HTMLElement) => [...el.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid')).filter((t) => t === 'badge-bid' || t === 'badge-score');

describe('PlayerBadge — les chiffres portent leur unité (UX-05)', () => {
  it('« 0/1 » devient « 0/1 plis » et le score « 20 pts »', () => {
    render(PlayerBadge, { props: { name: 'Anne Bonny', bid: 1, tricks: 0, score: 20 } });
    expect(screen.getByTestId('badge-bid')).toHaveTextContent('plis');
    expect(screen.getByTestId('badge-score')).toHaveTextContent('20');
    expect(screen.getByTestId('badge-score')).toHaveTextContent('pts');
  });

  it('le score n’est plus un nœud texte nu : il se nomme', () => {
    render(PlayerBadge, { props: { name: 'Anne', bid: 1, tricks: 0, score: 20 } });
    expect(screen.getByTestId('badge-score')).toHaveAttribute('aria-label', 'Score : 20 points');
    expect(screen.getByLabelText('Score : 20 points')).toBeInTheDocument();
  });

  it('le siège est un groupe nommé (A11Y-15)', () => {
    const { container } = render(PlayerBadge, { props: { name: 'Anne Bonny', bid: 2, tricks: 1, score: 10, dealer: true } });
    const badge = container.querySelector('.plaque')!;
    expect(badge).toHaveAttribute('role', 'group');
    expect(badge).toHaveAttribute('aria-label', 'Anne Bonny, 1 pli sur 2 pariés, 10 points, donneur');
  });
});

describe('PlayerBadge — la coche ne se pose qu’une fois la manche jouée (UX-05)', () => {
  it('« 0/0 » avant le premier pli : aucune coche', () => {
    render(PlayerBadge, { props: { name: 'Barbe-Noire', bid: 0, tricks: 0, score: 0 } });
    const chip = screen.getByTestId('badge-bid');
    expect(chip.textContent).not.toMatch(/[✓✗]/);
    expect(chip).toHaveAttribute('aria-label', '0 plis sur 0 pariés — pari tenu');
  });

  it('la manche jouée : la coche apparaît', () => {
    render(PlayerBadge, { props: { name: 'Barbe-Noire', bid: 0, tricks: 0, score: 0, settled: true } });
    expect(screen.getByTestId('badge-bid').textContent).toContain('✓');
  });

  it('le pari dépassé est un échec irréversible : la croix, elle, se pose tout de suite', () => {
    render(PlayerBadge, { props: { name: 'Calico', bid: 1, tricks: 2, score: 0 } });
    const chip = screen.getByTestId('badge-bid');
    expect(chip.textContent).toContain('✗');
    expect(chip).toHaveAttribute('data-bid-state', 'dépassé');
  });
});

describe('PlayerBadge — un seul ordre de lecture (UX-05)', () => {
  it('ma plaque et celle d’un siège énoncent « plis/pari » puis les points', () => {
    const { container: mine } = render(PlayerBadge, { props: { name: 'Moi', bid: 1, tricks: 0, score: -10, isMe: true } });
    const { container: seat } = render(PlayerBadge, { props: { name: 'Autre', bid: 1, tricks: 0, score: -10, layout: 'stack' } });
    expect(order(mine as unknown as HTMLElement)).toEqual(['badge-bid', 'badge-score']);
    expect(order(seat as unknown as HTMLElement)).toEqual(['badge-bid', 'badge-score']);
  });
});

it('identifie le premier joueur indépendamment de son pari', () => {
 const { container }=render(PlayerBadge,{props:{id:'anne',name:'Anne',bid:null,first:true,active:true}});
 expect(container.querySelector('[data-first]')).toHaveAttribute('aria-label',expect.stringContaining('joue la première carte'));
 expect(container.querySelector('.first-player')).toHaveTextContent('1');
});

it('le gagnant du pli est nommé et distingué de son tour de jeu', () => {
 const {container}=render(PlayerBadge,{props:{id:'anne',name:'Anne',winner:true,active:false}});
 const badge=container.querySelector('[data-trick-winner]');
 expect(badge).toHaveAttribute('aria-label',expect.stringContaining('remporte le pli'));
 expect(badge).not.toHaveAttribute('data-active');
 expect(badge).toHaveClass('is-winner');
});
