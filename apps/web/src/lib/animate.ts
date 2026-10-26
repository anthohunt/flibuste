// Aides d'animation (Web Animations API) pour que Hand / TrickArea restent simples.
// Sobres : 200–400 ms, courbes « sortie douce ». Tout est neutralisé quand l'utilisateur préfère moins de mouvement,
// ou quand `Element.animate` n'existe pas (jsdom).

export const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
export const EASE_IN = 'cubic-bezier(0.4, 0, 0.8, 0.4)';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Vrai si l'utilisateur a demandé moins d'animations (`prefers-reduced-motion: reduce`). */
export function reducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Vrai si l'on peut animer `el` (WAAPI disponible et mouvement souhaité). */
export function canAnimate(el: Element | null | undefined): el is HTMLElement {
  return !!el && typeof (el as HTMLElement).animate === 'function' && !reducedMotion();
}

export function rectOf(el: Element | null | undefined): Rect | null {
  if (!el || typeof el.getBoundingClientRect !== 'function') return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function boardScale(el: Element): number {
  const stage = el.closest('.fit-stage');
  if (!stage) return 1;
  const scale = Number.parseFloat(getComputedStyle(stage).getPropertyValue('--board-scale'));
  return scale > 0 ? scale : 1;
}

function centre(r: Rect) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * FLIP : `el` est déjà à sa place finale ; on le fait partir de `from` (position + taille) et arriver sur place.
 * Renvoie l'animation, ou null si rien n'est animé.
 */
export function flyFrom(el: Element | null | undefined, from: Rect | null | undefined, opts: { duration?: number; fade?: boolean } = {}): Animation | null {
  if (!from || !canAnimate(el)) return null;
  const to = rectOf(el);
  if (!to) return null;
  const a = centre(from);
  const b = centre(to);
  const scale = boardScale(el);
  const dx = (a.x - b.x) / scale;
  const dy = (a.y - b.y) / scale;
  const s = to.width ? Math.max(0.2, Math.min(3, from.width / to.width)) : 1;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(s - 1) < 0.02) return null;
  return el.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: opts.fade === false ? 1 : 0.7 },
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
    ],
    { duration: opts.duration ?? 300, easing: EASE_OUT, fill: 'backwards' },
  );
}

/**
 * Fin de pli : les éléments rétrécissent et volent vers `target` (le badge du gagnant) en s'effaçant.
 * Sans cible (pli défaussé), ils rétrécissent et s'effacent sur place. Résout à la fin (ou tout de suite si rien n'est animé).
 */
export function flyTo(els: Iterable<Element>, target: Rect | null, opts: { duration?: number; stagger?: number } = {}): Promise<void> {
  const list = Array.from(els).filter((e): e is HTMLElement => canAnimate(e));
  if (list.length === 0) return Promise.resolve();
  const duration = opts.duration ?? 400;
  const stagger = opts.stagger ?? 25;
  const t = target ? centre(target) : null;
  const done = list.map((el, i) => {
    const from = rectOf(el);
    if (!from) return Promise.resolve();
    const c = centre(from);
    const scale = boardScale(el);
    const dx = t ? (t.x - c.x) / scale : 0;
    const dy = t ? (t.y - c.y) / scale : 24;
    const anim = el.animate(
      [
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.25)`, opacity: 0 },
      ],
      { duration, delay: i * stagger, easing: EASE_IN, fill: 'forwards' },
    );
    return anim.finished.then(
      () => undefined,
      () => undefined,
    );
  });
  return Promise.all(done).then(() => undefined);
}

/**
 * Fin de pli, carte RETIRÉE (Supplice de la planche, Casier de Davy Jones) : elle ne rejoint pas le gagnant —
 * elle n'a pas été capturée, elle a quitté la table. Elle part vers l'EXTÉRIEUR du feutre (droit dans l'axe
 * centre → carte, plus une chute), pivote et s'efface : « par-dessus bord ».
 *
 * `from` est le rectangle du centre de la table (le pli) ; sans lui, la carte tombe simplement vers le bas.
 * Rien n'est animé quand l'utilisateur préfère moins de mouvement (`canAnimate`) : la carte reste alors en
 * place, barrée et étiquetée, jusqu'à la fin de la pause — aucun mouvement n'est ajouté à l'écran.
 */
export function overboard(els: Iterable<Element>, from: Rect | null, opts: { duration?: number; reach?: number } = {}): Promise<void> {
  const list = Array.from(els).filter((e): e is HTMLElement => canAnimate(e));
  if (list.length === 0) return Promise.resolve();
  const duration = opts.duration ?? 520;
  const reach = opts.reach ?? 150;
  const origin = from ? centre(from) : null;
  const done = list.map((el) => {
    const r = rectOf(el);
    if (!r) return Promise.resolve();
    const c = centre(r);
    const scale = boardScale(el);
    // Direction : du centre du pli vers la carte. Une carte pile au centre tombe tout droit.
    let vx = origin ? c.x - origin.x : 0;
    let vy = origin ? c.y - origin.y : 1;
    const len = Math.hypot(vx, vy);
    if (len < 1) {
      vx = 0;
      vy = 1;
    } else {
      vx /= len;
      vy /= len;
    }
    const dx = (vx * reach) / scale;
    const dy = (vy * reach + 46) / scale;
    const anim = el.animate(
      [
        { transform: 'translate(0, 0) rotate(0deg) scale(1)', opacity: 1, offset: 0 },
        { transform: `translate(${dx * 0.45}px, ${dy * 0.35}px) rotate(${vx >= 0 ? 10 : -10}deg) scale(0.95)`, opacity: 0.85, offset: 0.45 },
        { transform: `translate(${dx}px, ${dy}px) rotate(${vx >= 0 ? 26 : -26}deg) scale(0.7)`, opacity: 0, offset: 1 },
      ],
      { duration, easing: EASE_IN, fill: 'forwards' },
    );
    return anim.finished.then(
      () => undefined,
      () => undefined,
    );
  });
  return Promise.all(done).then(() => undefined);
}

/** Révélation : retournement (rotateX) d'un jeton, 400 ms. */
export function flip(el: Element | null | undefined, opts: { duration?: number } = {}): Animation | null {
  if (!canAnimate(el)) return null;
  return el.animate(
    [
      { transform: 'perspective(240px) rotateX(90deg)', opacity: 0.2 },
      { transform: 'perspective(240px) rotateX(0deg)', opacity: 1 },
    ],
    { duration: opts.duration ?? 400, easing: EASE_OUT },
  );
}

/** Léger « pop » d'apparition (badge, jeton), 200 ms. */
export function pop(el: Element | null | undefined, opts: { duration?: number } = {}): Animation | null {
  if (!canAnimate(el)) return null;
  return el.animate([{ transform: 'scale(0.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], {
    duration: opts.duration ?? 200,
    easing: EASE_OUT,
  });
}

/**
 * Action Svelte `use:popIn` : léger « pop » à l'apparition (bandeau de verdict). Rien quand l'utilisateur
 * préfère moins de mouvement — `pop` le vérifie déjà par `canAnimate`.
 */
export function popIn(node: HTMLElement, opts: { duration?: number } = {}) {
  pop(node, opts);
  return {};
}

/**
 * Action Svelte `use:flyIn={origin}` : à l'apparition de l'élément, il arrive depuis `origin` (rectangle),
 * ou depuis le bas de l'écran si `origin` est une fonction qui renvoie null.
 */
export function flyIn(node: HTMLElement, origin: Rect | null | (() => Rect | null)) {
  const from = typeof origin === 'function' ? origin() : origin;
  const fallback: Rect | null = from ?? (typeof window !== 'undefined' ? { left: window.innerWidth / 2 - 24, top: window.innerHeight, width: 48, height: 64 } : null);
  flyFrom(node, fallback);
  return {};
}

/**
 * Glissement d'un élément fantôme (la Tempête : la carte donnée file vers le voisin, la carte reçue arrive
 * de l'autre) : `el` est posé sur `from` par l'appelant ; il glisse jusqu'au centre de `to` en rétrécissant.
 * Résout à la fin (tout de suite si rien n'est animé).
 */
export function slide(el: Element | null | undefined, from: Rect | null, to: Rect | null, opts: { duration?: number } = {}): Promise<void> {
  if (!from || !to || !canAnimate(el)) return Promise.resolve();
  const a = centre(from);
  const b = centre(to);
  const anim = el.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${b.x - a.x}px, ${b.y - a.y}px) scale(0.6)`, opacity: 0.2 },
    ],
    { duration: opts.duration ?? 500, easing: EASE_IN, fill: 'forwards' },
  );
  return anim.finished.then(
    () => undefined,
    () => undefined,
  );
}
