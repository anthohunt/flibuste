import { APP_NAME } from './brand';
// Aides d'accessibilité (E3, E4, E6) : focus sur le titre à chaque écran, titre de document par écran, préférence
// de mouvement exposée sur <html>.
import type { PlayerView } from './types';
import type { RouteName } from './router.svelte';
import { codex } from './codex.svelte';

/**
 * Donne le focus au `h1` de l'écran (`tabindex="-1"` posé au besoin), sans faire défiler. Renvoie l'élément ciblé
 * ou null s'il n'y a pas de titre. Le focus programmatique ne dessine pas d'anneau (CSS `h1[tabindex="-1"]:focus`).
 */
export function focusHeading(root: ParentNode | null | undefined = typeof document !== 'undefined' ? document : null): HTMLElement | null {
  if (!root) return null;
  const h = root.querySelector<HTMLElement>('main h1, h1');
  if (!h) return null;
  if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
  try {
    h.focus({ preventScroll: true });
  } catch {
    h.focus();
  }
  return h;
}

/** Focus sur la main (`[data-testid="hand"]`, `tabindex="-1"`), après un pari ou une carte jouée (E3). */
export function focusHand(root: ParentNode | null | undefined = typeof document !== 'undefined' ? document : null): HTMLElement | null {
  const hand = root?.querySelector<HTMLElement>('[data-testid="hand"]') ?? null;
  if (!hand) return null;
  try {
    hand.focus({ preventScroll: true });
  } catch {
    hand.focus();
  }
  return hand;
}

/**
 * `document.title` par écran (WCAG 2.4.2) : « Flibuste — Salon », « Flibuste — Manche 3 »…
 *
 * A11Y-02 — une situation du codex est une couche modale posée par-dessus l'écran : c'est ELLE qu'il faut annoncer,
 * sinon le titre continue de dire « Salon » alors qu'on joue une scène. Le titre est calculé ici, et pas écrit par
 * la couche elle-même, pour qu'il n'y ait qu'un seul auteur du titre du document : deux effets qui se disputent
 * `document.title` se battent à l'ordre de passage, et c'est l'écran de fond qui gagnait.
 */
export function pageTitle(route: RouteName, params: Record<string, string>, view: Pick<PlayerView, 'round' | 'phase'> | null): string {
  const base = APP_NAME;
  if (codex.situation) return `${base} — Situation : ${codex.situation.title}`;
  switch (route) {
    case 'home':
      return base;
    case 'friends':
      return `${base} — Avec des amis`;
    case 'lobby':
      return `${base} — ${params.code ? `Table ${params.code}` : 'Salon'}`;
    case 'join':
      return `${base} — Invitation${params.code ? ` ${params.code}` : ''}`;
    case 'table':
      return view ? `${base} — Manche ${view.round}${view.phase === 'bidding' ? ' : pari' : ''}` : `${base} — Table`;
    case 'score':
      return view ? `${base} — Scores, manche ${view.round}` : `${base} — Scores`;
    case 'over':
      return `${base} — Classement`;
    case 'classement':
      return `${base} — Tableau d’honneur`;
    case 'dev':
      return `${base} — Vitrine`;
    case 'art':
      return `${base} — Illustrations`;
    case 'son':
      return `${base} — Sons`;
  }
  // Pas de `default` : il rendait le `switch` exhaustif par construction, donc muet. `#/son` s'est annoncée
  // « Roi des Flibustiers » pendant tout le chantier du son sans que rien ne le signale. Le `satisfies never` fait
  // maintenant échouer la COMPILATION à la prochaine route ajoutée, plutôt que le titre en silence.
  return route satisfies never;
}

/** Pose `data-motion="reduce" | "full"` sur l'élément racine selon la préférence. */
export function applyMotionPreference(doc: Document, reduce: boolean): void {
  doc.documentElement.dataset.motion = reduce ? 'reduce' : 'full';
}

/** Suit `prefers-reduced-motion` et tient `data-motion` à jour ; renvoie la fonction d'arrêt. */
export function watchMotionPreference(doc: Document): () => void {
  const win = doc.defaultView;
  if (!win || typeof win.matchMedia !== 'function') {
    applyMotionPreference(doc, false);
    return () => {};
  }
  const mq = win.matchMedia('(prefers-reduced-motion: reduce)');
  const apply = () => applyMotionPreference(doc, mq.matches);
  apply();
  mq.addEventListener?.('change', apply);
  return () => mq.removeEventListener?.('change', apply);
}
