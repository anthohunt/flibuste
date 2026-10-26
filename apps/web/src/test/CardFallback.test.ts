import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import Card from '../components/Card.svelte';

// Manifeste sans illustration retenue : la carte doit retomber sur le dessin SVG.
vi.mock('../../art/manifest.json', () => ({
  default: { pirateking: { chosen: null, variants: ['v1', 'v2', 'v3'] }, parrot: { chosen: null, variants: [] } },
}));

describe('Card sans illustration (chosen: null)', () => {
  it('rend le repli SVG, sans <image>', () => {
    const { container } = render(Card, { props: { card: { id: 'pirateking', kind: 'pirateking' } } });
    expect(container.querySelector('image')).toBeNull();
    expect(container.querySelector('[data-art]')).toBeNull();
    expect(container.querySelector('svg rect')).not.toBeNull();
    expect(container.textContent).toContain('Roi des Flibustiers');
  });

  it('rend le rang (deux fois) et le glyphe SVG pour une carte numérotée', () => {
    const { container } = render(Card, { props: { card: { id: 'parrot-7', kind: 'number', suit: 'parrot', rank: 7 } } });
    expect(container.querySelector('image')).toBeNull();
    expect(container.querySelectorAll('text[data-rank]')).toHaveLength(2);
    expect(container.querySelector('[data-glyph="parrot"]')).not.toBeNull();
  });
});
