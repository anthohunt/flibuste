// Icônes SVG inline (viewBox 0 0 24 24, trait `currentColor`). Une seule source pour toute l'UI épurée :
// pas d'emoji, pas de police d'icônes. Chaque entrée = fragment SVG (paths, cercles, textes).

export type IconName =
  | 'skull'
  | 'swords'
  | 'plus'
  | 'enter'
  | 'kraken'
  | 'whale'
  | 'loot'
  | 'powers'
  | 'colourCards'
  | 'wild15'
  | 'hexer'
  | 'volley'
  | 'mate'
  | 'stingray'
  | 'davyJones'
  | 'plank'
  | 'timer30'
  | 'timer2m'
  | 'infinity'
  | 'moon'
  | 'share'
  | 'crown'
  | 'home'
  | 'replay'
  | 'arrowRight'
  | 'check'
  | 'close'
  | 'bell'
  | 'pencil'
  | 'exit'
  | 'bot'
  | 'dealer'
  | 'link'
  | 'history'
  | 'wifiOff'
  | 'eye'
  | 'image'
  | 'trash'
  | 'cards'
  | 'storm'
  | 'ghost'
  | 'qr'
  | 'gear'
  | 'soundOff'
  | 'music';

const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

export const ICONS: Record<IconName, string> = {
  skull: `<path ${S} d="M12 2a8 8 0 0 0-8 8c0 2.6 1.2 4.6 3 5.9V19a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-3.1c1.8-1.3 3-3.3 3-5.9a8 8 0 0 0-8-8z"/><circle cx="9" cy="11" r="1.6" fill="currentColor"/><circle cx="15" cy="11" r="1.6" fill="currentColor"/><path ${S} d="M10 21v-3M14 21v-3M12 14l-1 2h2z"/>`,
  // Sabres croisés — lames COURBES et gardes visibles : deux diagonales droites d'un coin à l'autre se lisaient
  // « ✕ » (fermer/annuler) sur le bouton qui LANCE la partie (vague 8, #7 / audit visuel #31).
  swords: `<path ${S} d="M4.2 3.2c6 1.6 10.4 6 12.4 12.1"/><path ${S} d="M19.8 3.2c-6 1.6-10.4 6-12.4 12.1"/><path ${S} d="M14.1 16.3l4.7-2.1M9.9 16.3l-4.7-2.1"/><path ${S} d="M16.6 15.3l1.4 3.1a1.7 1.7 0 1 1-3.1 1.4l-.9-2"/><path ${S} d="M7.4 15.3L6 18.4a1.7 1.7 0 1 0 3.1 1.4l.9-2"/>`,
  plus: `<path ${S} d="M12 5v14M5 12h14"/>`,
  enter: `<path ${S} d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5M3 12h11M10 8l4 4-4 4"/>`,
  kraken: `<path ${S} d="M12 3a5 5 0 0 0-5 5v3c0 1-1 2-2 3s-1 3 0 4 3 0 3-2c0 2 1 3 2 4s2-1 2-3c0 2 1 4 2 3s1-2 1-4c1 2 3 3 3 1s-1-3-2-4-1-2-1-3V8a5 5 0 0 0-3-5z"/><circle cx="10" cy="8" r="1" fill="currentColor"/><circle cx="14" cy="8" r="1" fill="currentColor"/>`,
  whale: `<path ${S} d="M3 13c2-5 7-7 12-6 3 .6 5 2.5 6 5-1 2-3 3-6 3H9c-3 0-5-1-6-2z"/><path ${S} d="M18 8l3-3v4M6 14c-1 2-2 3-3 4M9 8c0-2 1-3 1-5"/><circle cx="16" cy="11" r="1" fill="currentColor"/>`,
  loot: `<path ${S} d="M3 9h18v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path ${S} d="M3 9a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5M3 13h18"/><rect x="10" y="12" width="4" height="3" rx=".5" fill="currentColor"/>`,
  powers: `<path ${S} d="M13 2L4 14h7l-1 8 9-12h-7z"/>`,
  colourCards: `<rect ${S} x="4" y="4" width="10" height="14" rx="1.5"/><path ${S} d="M14 8h4a1.5 1.5 0 0 1 1.5 1.5V20a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 8.5 20v-2"/><text x="9" y="15" font-size="9" font-weight="700" fill="currentColor" text-anchor="middle" font-family="ui-monospace,monospace">7</text>`,
  wild15: `<path ${S} d="M12 3l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.4l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8z"/><text x="12" y="14.5" font-size="7" font-weight="700" fill="currentColor" text-anchor="middle" font-family="ui-monospace,monospace">15</text>`,
  hexer: `<path ${S} d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10z"/><path ${S} d="M7 5l2 3M17 5l-2 3"/>`,
  volley: `<circle ${S} cx="9" cy="14" r="4"/><path ${S} d="M12 11l7-7M19 4h-4M19 4v4M5 20l-1 1"/>`,
  mate: `<circle ${S} cx="12" cy="5" r="2"/><path ${S} d="M12 7v14M5 13a7 7 0 0 0 14 0M3 13h4M17 13h4"/>`,
  stingray: `<path ${S} d="M12 4c5 0 9 4 9 7-3 1-6 1-9 1s-6 0-9-1c0-3 4-7 9-7z"/><path ${S} d="M12 12c0 3 1 6 3 9M10 8h.01M14 8h.01"/>`,
  davyJones: `<rect ${S} x="5" y="10" width="14" height="11" rx="1.5"/><path ${S} d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.5" fill="currentColor"/>`,
  plank: `<path ${S} d="M3 15l14-9 4 3-14 9z"/><path ${S} d="M6 18l1 3M15 12l1 3M20 9l1-3M9 9l2-2"/>`,
  timer30: `<circle ${S} cx="12" cy="13" r="8"/><path ${S} d="M12 5V3M9 3h6"/><text x="12" y="16" font-size="7" font-weight="700" fill="currentColor" text-anchor="middle" font-family="ui-monospace,monospace">30</text>`,
  timer2m: `<circle ${S} cx="12" cy="13" r="8"/><path ${S} d="M12 5V3M9 3h6"/><text x="12" y="16" font-size="7" font-weight="700" fill="currentColor" text-anchor="middle" font-family="ui-monospace,monospace">2m</text>`,
  infinity: `<path ${S} d="M7 8c-2.5 0-4 2-4 4s1.5 4 4 4c3 0 4-3 5-4 1-1 2-4 5-4 2.5 0 4 2 4 4s-1.5 4-4 4c-3 0-4-3-5-4-1-1-2-4-5-4z"/>`,
  moon: `<path ${S} d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>`,
  share: `<circle ${S} cx="18" cy="5" r="2.5"/><circle ${S} cx="6" cy="12" r="2.5"/><circle ${S} cx="18" cy="19" r="2.5"/><path ${S} d="M8.2 10.8l7.6-4.6M8.2 13.2l7.6 4.6"/>`,
  crown: `<path ${S} d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>`,
  home: `<path ${S} d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>`,
  replay: `<path ${S} d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/>`,
  arrowRight: `<path ${S} d="M5 12h14M13 6l6 6-6 6"/>`,
  check: `<path ${S} d="M5 13l4 4L19 7"/>`,
  close: `<path ${S} d="M6 6l12 12M18 6L6 18"/>`,
  bell: `<path ${S} d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>`,
  pencil: `<path ${S} d="M4 20h4l10-10-4-4L4 16zM13 7l4 4"/>`,
  exit: `<path ${S} d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M21 12H10M17 8l4 4-4 4"/>`,
  bot: `<rect ${S} x="5" y="8" width="14" height="11" rx="2"/><path ${S} d="M12 8V4M9 4h6M2 13h3M19 13h3"/><circle cx="9.5" cy="13" r="1.3" fill="currentColor"/><circle cx="14.5" cy="13" r="1.3" fill="currentColor"/>`,
  // Vague 8 (#5) : le « D » du donneur rendait 3 à 4 px sur la plaque (icône de 10 px) — une tache. Le paquet de
  // cartes suffit à le dire, et le libellé accessible (« Donneur ») porte le sens.
  dealer: `<rect ${S} x="5" y="3" width="11" height="15" rx="1.5"/><path ${S} d="M8 21h11a1 1 0 0 0 1-1V8"/><path ${S} d="M7.6 7h5.8M7.6 10.5h5.8M7.6 14h3.4"/>`,
  link: `<path ${S} d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>`,
  history: `<path ${S} d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 8v4l3 2"/>`,
  wifiOff: `<path ${S} d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 4-2.5M12 6a15 15 0 0 1 10 4M2 10a15 15 0 0 1 3-2"/><circle cx="12" cy="20" r="1" fill="currentColor"/>`,
  eye: `<path ${S} d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle ${S} cx="12" cy="12" r="3"/>`,
  /** Une capture d'écran : un cadre, un horizon, un soleil. Dessinée au même trait que les autres. */
  image: `<rect ${S} x="3" y="5" width="18" height="14" rx="2"/><path ${S} d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="8.5" cy="9.5" r="1.4" fill="currentColor"/>`,
  trash: `<path ${S} d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>`,
  cards: `<rect ${S} x="3" y="6" width="10" height="14" rx="1.5" transform="rotate(-8 8 13)"/><rect ${S} x="11" y="4" width="10" height="14" rx="1.5" transform="rotate(8 16 11)"/>`,
  storm: `<path ${S} d="M7 15a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.6 1.2A3.5 3.5 0 0 1 17.5 15H7z"/><path ${S} d="M12 14l-2 4h4l-2 4"/><path ${S} d="M4 19h3M17 19h3"/>`,
  ghost: `<path ${S} d="M12 3a7 7 0 0 0-7 7v11l2.5-2 2.5 2 2-2 2 2 2.5-2 2.5 2V10a7 7 0 0 0-7-7z"/><circle cx="9.5" cy="10.5" r="1.2" fill="currentColor"/><circle cx="14.5" cy="10.5" r="1.2" fill="currentColor"/>`,
  qr: `<rect ${S} x="3" y="3" width="7" height="7" rx="1"/><rect ${S} x="14" y="3" width="7" height="7" rx="1"/><rect ${S} x="3" y="14" width="7" height="7" rx="1"/><path ${S} d="M14 14h3v3h-3zM20 14v1M14 20h1M18 18h3v3"/>`,
  // L'engrenage de l'en-tête permanent. Une roue dentée n'a rien de la taverne, et c'est voulu : c'est le seul
  // glyphe que tout le monde lit sans l'apprendre, et il ouvre la seule feuille qui ne parle pas du jeu.
  gear: `<circle ${S} cx="12" cy="12" r="3"/><path ${S} d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`,
  // Le haut-parleur barré. Il ne porte PAS le trait commun `S` : il n'est jamais dessiné en 24 px mais en 11,
  // sur la pastille de l'engrenage, où un trait de 2 rendrait moins d'un pixel. D'où 2,8, et un dessin réduit
  // à ce qui survit à cette taille — le pavillon plein et la croix, rien du cône ni des ondes.
  music: `<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2.4" fill="currentColor"/><ellipse cx="17" cy="16" rx="3" ry="2.4" fill="currentColor"/>`,
  soundOff: `<path fill="currentColor" d="M4 9.4h3.4L12 5.3v13.4L7.4 14.6H4z"/><path fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" d="m15.6 9.6 5 4.8m0-4.8-5 4.8"/>`,
};
