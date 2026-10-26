/** Identité commune à l’application et au lecteur multimédia du système. */
export const APP_NAME = 'Flibuste Online';
export const EMBLEM = '/brand/emblem-v1-512.png';

export function setMediaIdentity(place: 'menus' | 'table'): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: APP_NAME,
      artist: place === 'menus' ? 'Ambiance de la taverne' : 'Ambiance de la partie',
      artwork: [
        { src: '/brand/emblem-v1-192.png', sizes: '192x192', type: 'image/png' },
        { src: EMBLEM, sizes: '512x512', type: 'image/png' },
      ],
    });
  } catch { /* Les métadonnées facultatives ne doivent jamais empêcher la lecture. */ }
}
