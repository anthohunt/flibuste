import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import QuitDialog from '../components/QuitDialog.svelte';

describe('QuitDialog — feuille « Quitter la table ? » (C8)', () => {
  it('rôle dialog, « Rester » a le focus par défaut, « Quitter » confirme', async () => {
    const onstay = vi.fn();
    const onquit = vi.fn();
    render(QuitDialog, { props: { onstay, onquit } });
    const dialog = screen.getByRole('dialog', { name: 'Quitter la table ?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('data-testid', 'quit-dialog');
    expect(document.activeElement).toBe(screen.getByTestId('quit-stay'));
    await fireEvent.click(screen.getByRole('button', { name: 'Quitter' }));
    expect(onquit).toHaveBeenCalledTimes(1);
    expect(onstay).not.toHaveBeenCalled();
  });

  it('Échap et un tap hors de la feuille = Rester', async () => {
    const onstay = vi.fn();
    const onquit = vi.fn();
    render(QuitDialog, { props: { onstay, onquit } });
    await fireEvent.keyDown(document, { key: 'Escape' });
    expect(onstay).toHaveBeenCalledTimes(1);
    await fireEvent.click(screen.getByTestId('quit-dialog-veil'));
    expect(onstay).toHaveBeenCalledTimes(2);
    // Un tap DANS la feuille ne ferme rien.
    await fireEvent.click(screen.getByRole('dialog'));
    expect(onstay).toHaveBeenCalledTimes(2);
    expect(onquit).not.toHaveBeenCalled();
  });

  it('le focus reste piégé dans la feuille (Tab en boucle)', async () => {
    render(QuitDialog, { props: { onstay: () => {}, onquit: () => {} } });
    const close = screen.getByRole('button', { name: 'Fermer la fenêtre' });
    const quit = screen.getByTestId('quit-confirm');
    const dialog = screen.getByRole('dialog');
    quit.focus();
    await fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    await fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(quit);
  });

  it('adapte le texte : solo (partie perdue), en ligne (le serveur joue), salon', () => {
    const { unmount } = render(QuitDialog, { props: { onstay: () => {}, onquit: () => {} } });
    expect(screen.getByRole('dialog')).toHaveTextContent('Ta partie sera perdue');
    unmount();
    const r2 = render(QuitDialog, { props: { onstay: () => {}, onquit: () => {}, online: true, code: 'ABCD' } });
    expect(screen.getByRole('dialog')).toHaveTextContent('ABCD');
    r2.unmount();
    render(QuitDialog, { props: { onstay: () => {}, onquit: () => {}, lobby: true, code: 'WXYZ' } });
    expect(screen.getByRole('dialog')).toHaveTextContent('Tu quittes la table WXYZ');
  });
});
