// Feuille modale + historique (#8) : Précédent ferme la feuille (entrée `pushState` posée à l'ouverture, `popstate`
// annule) ; fermée par un bouton, elle retire son entrée ; sans `oncancel`, Précédent est avalé.
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import QuitDialog from '../components/QuitDialog.svelte';
import { createRawSnippet, flushSync } from 'svelte';
import Sheet from '../components/Sheet.svelte';

/** Historique factice : jsdom n'émet pas `popstate` sur `history.back()`, on le pilote à la main. */
function fakeHistory() {
  const entries: unknown[] = [null];
  let i = 0;
  const pushState = vi.spyOn(history, 'pushState').mockImplementation((state) => {
    entries.splice(i + 1);
    entries.push(state);
    i = entries.length - 1;
  });
  const back = vi.spyOn(history, 'back').mockImplementation(() => {
    if (i === 0) return;
    i -= 1;
    window.dispatchEvent(new PopStateEvent('popstate', { state: entries[i] }));
  });
  const stateGetter = vi.spyOn(history, 'state', 'get').mockImplementation(() => entries[i]);
  return { pushState, back, entries, restore: () => [pushState, back, stateGetter].forEach((s) => s.mockRestore()), get index() { return i; } };
}

describe('Sheet — Précédent du navigateur (#8)', () => {
  let h: ReturnType<typeof fakeHistory>;
  afterEach(() => h?.restore());

  it('pose une entrée à l’ouverture ; Précédent la retire et annule la feuille', () => {
    h = fakeHistory();
    const onstay = vi.fn();
    render(QuitDialog, { props: { onstay, onquit: () => {} } });
    expect(h.pushState).toHaveBeenCalledTimes(1);
    expect((h.entries[1] as { sheet?: string }).sheet).toMatch(/^sheet-/);
    history.back(); // Précédent
    expect(onstay).toHaveBeenCalledTimes(1);
    expect(h.index).toBe(0);
  });

  it('fermée par un bouton, elle retire son entrée d’historique (pas de Précédent fantôme)', async () => {
    h = fakeHistory();
    const onquit = vi.fn();
    const { unmount } = render(QuitDialog, { props: { onstay: () => {}, onquit } });
    expect(h.index).toBe(1);
    await fireEvent.click(screen.getByRole('button', { name: 'Quitter' }));
    expect(onquit).toHaveBeenCalledTimes(1);
    unmount(); // l'appelant ferme la feuille
    flushSync();
    // Le retrait est différé d'un tour (une feuille peut en remplacer une autre dans le même tick).
    await new Promise((r) => setTimeout(r, 0));
    expect(h.back).toHaveBeenCalledTimes(1);
    expect(h.index).toBe(0);
  });

  it('ne touche pas à l’historique si l’écran a changé entre-temps (navigation après confirmation)', async () => {
    h = fakeHistory();
    const { unmount } = render(QuitDialog, { props: { onstay: () => {}, onquit: () => {} } });
    // L'écran navigue (nouvelle entrée, autre état) avant que la feuille ne soit démontée.
    history.pushState(null, '', '#/');
    unmount();
    flushSync();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.back).not.toHaveBeenCalled();
  });

  it('deux feuilles empilées : Précédent ne ferme que la plus récente', () => {
    h = fakeHistory();
    const first = vi.fn();
    const second = vi.fn();
    render(QuitDialog, { props: { onstay: first, onquit: () => {} } });
    render(QuitDialog, { props: { onstay: second, onquit: () => {} } });
    expect(h.index).toBe(2);
    history.back();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------------
// Ouverture (UX-13) : une feuille montre son DÉBUT. Le codex s'ouvrait défilé de 440 px sur 1 183, titre à
// −339 px, focus sur « Fermer » (le `data-autofocus` du bas), première ligne lue « Kraken ».
// ---------------------------------------------------------------------------------------------------------

/** Rectangle simulé (jsdom ne calcule aucune mise en page). */
const rect = (top: number, height: number, width = 340): DOMRect => ({ x: 0, y: top, left: 0, top, right: width, bottom: top + height, width, height, toJSON: () => ({}) }) as DOMRect;

/** Feuille longue : la cible d'autofocus est posée sous la ligne de flottaison. */
function longSheet(opts: { autofocusTop: number }) {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.hasAttribute('data-autofocus')) return rect(opts.autofocusTop, 44);
    if (this.getAttribute('role') === 'dialog') return rect(60, 700);
    if (this.tagName === 'H2') return rect(70, 30);
    return rect(200, 40);
  };
  const children = createRawSnippet(() => ({
    render: () => `<div><p>Chaque carte, expliquée et mise en situation.</p><button data-testid="premiere-carte">Roi des Flibustiers</button><button data-autofocus data-testid="fermer">Fermer</button></div>`,
  }));
  return { children, restore: () => { Element.prototype.getBoundingClientRect = original; } };
}

describe('Sheet — la feuille s’ouvre à son début (UX-13)', () => {
  it('cible d’autofocus hors écran : le focus va au titre, pas au bouton du bas', () => {
    const { children, restore } = longSheet({ autofocusTop: 1200 });
    try {
      render(Sheet, { props: { title: 'Codex des cartes', testid: 'codex', oncancel: () => {}, children } as never });
      const panel = screen.getByTestId('codex');
      const heading = screen.getByRole('heading', { name: 'Codex des cartes' });
      expect(document.activeElement).toBe(heading);
      expect(heading).toHaveAttribute('tabindex', '-1');
      expect(panel.scrollTop).toBe(0);
      // Le titre n'entre pas dans la tabulation : le premier Tab va au contenu.
      expect(panel.querySelectorAll('[tabindex]:not([tabindex="-1"])')).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it('cible d’autofocus visible : elle garde le focus (boutons de confirmation)', () => {
    const { children, restore } = longSheet({ autofocusTop: 300 });
    try {
      render(Sheet, { props: { title: 'Quitter la table ?', testid: 'court', oncancel: () => {}, children } as never });
      expect(document.activeElement).toBe(screen.getByTestId('fermer'));
    } finally {
      restore();
    }
  });

  it('sans mise en page connue, la feuille ne devine rien : la cible demandée est gardée', () => {
    const children = createRawSnippet(() => ({ render: () => `<div><button data-autofocus data-testid="ok">Compris</button></div>` }));
    render(Sheet, { props: { title: 'Comment on joue ?', testid: 'aide', oncancel: () => {}, children } as never });
    expect(document.activeElement).toBe(screen.getByTestId('ok'));
  });

  it('le focus d’ouverture ne défile jamais (`preventScroll`)', () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const children = createRawSnippet(() => ({ render: () => `<div><button data-autofocus data-testid="ok">Compris</button></div>` }));
    render(Sheet, { props: { title: 'Les manches', testid: 'manches', oncancel: () => {}, children } as never });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    focus.mockRestore();
  });
});
