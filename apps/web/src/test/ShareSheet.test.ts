// Feuille d'invitation (vague 5) : le lien, un QR code généré sans CDN, le code en lettres espacées, « Copier le lien ».
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import ShareSheet from '../components/ShareSheet.svelte';

const url = 'https://skull.example/#/join/ABCDEF?de=Alice';

describe('ShareSheet', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lien, QR (SVG), code espacé, boutons', async () => {
    render(ShareSheet, { props: { url, code: 'ABCDEF', oncancel: () => {} } });
    expect(screen.getByTestId('share-link')).toHaveValue(url);
    expect(screen.getByTestId('share-code')).toHaveTextContent('A B C D E F');
    expect(screen.getByRole('dialog')).toHaveTextContent('Code : 6 lettres');
    await waitFor(() => expect(screen.getByTestId('share-qr')).toHaveAttribute('data-ready', 'true'));
    expect(screen.getByTestId('share-qr').querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Copier le lien' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fermer' })).toBeInTheDocument();
  });

  it('« Copier le lien » passe par le presse-papiers et remonte le résultat', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const oncopied = vi.fn();
    render(ShareSheet, { props: { url, code: 'ABCDEF', oncancel: () => {}, oncopied } });
    await fireEvent.click(screen.getByTestId('share-copy'));
    await waitFor(() => expect(oncopied).toHaveBeenCalledWith(true));
    expect(writeText).toHaveBeenCalledWith(url);
  });

  it('« Partager » n’apparaît que si l’appareil sait partager', async () => {
    Object.defineProperty(navigator, 'share', { value: vi.fn().mockResolvedValue(undefined), configurable: true });
    render(ShareSheet, { props: { url, code: 'ABCD', oncancel: () => {} } });
    expect(screen.getByTestId('share-native')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent('Code : 4 lettres');
    await fireEvent.click(screen.getByTestId('share-native'));
    expect(navigator.share).toHaveBeenCalledWith(expect.objectContaining({ url }));
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  });
});
