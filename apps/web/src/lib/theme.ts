// Thème « taverne » : les mêmes valeurs que `app.css`, pour ce qui se dessine en JS/SVG (anneaux, avatars,
// jauges). Une seule source pour les couleurs : ce fichier suit les variables CSS, jamais l'inverse.
export const THEME = {
  wood: { 950: '#120903', 900: '#1d1108', 800: '#2c1a0c', 700: '#3f2612', 600: '#5a3619', 500: '#7a4c22' },
  brass: { 600: '#8f6a22', 500: '#b5852f', 400: '#d0a24a', 300: '#e6c36a' },
  gold: { 500: '#d9a83a', 400: '#ecc558', 300: '#f4d67a', 100: '#fbeec2' },
  parchment: { 100: '#f3e6c8', 300: '#e5d2a6', 500: '#c9ad7a' },
  ink: { 900: '#2a1a0d', 700: '#4a3220', 500: '#6b4d33' },
  ember: { 500: '#e0662a', 300: '#ffa04a' },
  rum: { 600: '#8b1e2b', 500: '#b3283a' },
  felt: { 800: '#0e2f1f', 700: '#14402a' },
} as const;

/** Textures d'interface (public/ui, précachées par le service worker). */
export const TEXTURES = {
  tavern: '/ui/tavern-bg.webp',
  wood: '/ui/wood-plank.webp',
  parchment: '/ui/parchment.webp',
  felt: '/ui/felt-table.webp',
  sign: '/ui/sign-board.webp',
} as const;

/** Décor de fond par écran : la taverne en pleine lumière, en retrait, ou la table de jeu. */
export type Scene = 'home' | 'tavern' | 'table';

/** Teintes d'avatar : des tons chauds de taverne (cuir, rhum, laiton, sapin, nuit) plutôt qu'un arc-en-ciel. */
export const AVATAR_HUES = [18, 32, 44, 2, 150, 200, 275, 330] as const;

export function avatarHue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_HUES[h % AVATAR_HUES.length]!;
}
