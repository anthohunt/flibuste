// Info-bulle à l'appui long : l'UI épurée n'a plus de libellés, chaque glyphe explique son nom et sa règle
// quand on le maintient (≈ 450 ms) — et au survol prolongé à la souris. Une seule bulle pour toute l'app
// (`TipLayer.svelte`), positionnée près de l'élément.
export interface Tip {
  title: string;
  text?: string;
  /** Rectangle de l'élément source (viewport). */
  x: number;
  y: number;
  width: number;
  height: number;
}

export const tip = $state<{ current: Tip | null }>({ current: null });

export const LONG_PRESS_MS = 450;

export function showTip(el: Element, title: string, text?: string) {
  const r = el.getBoundingClientRect();
  tip.current = { title, text, x: r.left, y: r.top, width: r.width, height: r.height };
}

export function hideTip() {
  tip.current = null;
}

export interface TipParams {
  title: string;
  text?: string;
  /** Un simple tap montre aussi la bulle, brièvement (jetons et badges sans autre action, D4). */
  tap?: boolean;
  /**
   * Appui long (doigt ou souris maintenue) : appelé À LA PLACE de la bulle — le codex ouvre la carte en plein écran
   * (vague 6). Le survol prolongé à la souris garde la bulle. Le clic qui suit l'appui long est avalé.
   */
  onlong?: () => void;
}

/**
 * Une bulle ouverte au tap RESTE ouverte. Elle se referme au tap suivant — sur le même élément ou
 * sur un autre — ou quand on touche ailleurs. Elle disparaissait auparavant toute seule au bout de
 * trois secondes : le temps de lire le nom de la carte, la règle s'était évanouie (rapport #15).
 */
let tapOuvertePour: HTMLElement | null = null;

/**
 * Action Svelte `use:longpress={{ title, text }}` : affiche la bulle après un appui long (ou un survol prolongé),
 * la cache au relâchement. Un appui long n'émet pas de clic (le `click` suivant est avalé une fois).
 */
export function longpress(node: HTMLElement, params: TipParams) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let shown = false;
  let swallowClick = false;
  let current = params;

  const start = (viaHover: boolean) => {
    cancel();
    timer = setTimeout(
      () => {
        timer = null;
        swallowClick = !viaHover;
        if (!viaHover && current.onlong) {
          current.onlong();
          return;
        }
        shown = true;
        showTip(node, current.title, current.text);
      },
      viaHover ? 600 : LONG_PRESS_MS,
    );
  };
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const end = () => {
    cancel();
    if (shown) {
      shown = false;
      hideTip();
    }
  };
  /** Un tap ailleurs referme la bulle laissée ouverte : elle ne doit pas survivre au geste suivant. */
  const ailleurs = (e: PointerEvent) => {
    if (!tapOuvertePour || node.contains(e.target as Node)) return;
    tapOuvertePour = null;
    hideTip();
  };
  /**
   * Bulle au tap : montrée tout de suite, sans dépendre du `click` (qu'un label parent ou le
   * navigateur peut avaler). Un second tap sur le MÊME élément la referme ; un tap sur un autre
   * la déplace. Aucune minuterie : c'est le joueur qui décide quand il a fini de lire.
   */
  const tapTip = () => {
    if (tapOuvertePour === node && tip.current) {
      tapOuvertePour = null;
      hideTip();
      return;
    }
    tapOuvertePour = node;
    showTip(node, current.title, current.text);
  };
  let tappedAt = 0;
  const onPointerUp = (e: PointerEvent) => {
    const wasTimer = timer !== null;
    end();
    if (current.tap && wasTimer && e.pointerType !== 'mouse') {
      tappedAt = Date.now();
      tapTip();
    }
  };
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    start(false);
  };
  const onPointerEnter = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') start(true);
  };
  const onClick = (e: MouseEvent) => {
    if (swallowClick) {
      swallowClick = false;
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (current.tap) {
      e.preventDefault(); // un label parent ne doit pas déplacer le focus vers son champ
      if (Date.now() - tappedAt > 400) tapTip();
    }
  };
  const onContextMenu = (e: Event) => {
    if (shown || timer) e.preventDefault();
  };

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointerenter', onPointerEnter);
  node.addEventListener('pointerup', onPointerUp);
  node.addEventListener('pointerleave', end);
  node.addEventListener('pointercancel', end);
  node.addEventListener('click', onClick, true);
  node.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('scroll', end, true);
  window.addEventListener('pointerdown', ailleurs, true);

  return {
    update(p: TipParams) {
      current = p;
    },
    destroy() {
      end();
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointerenter', onPointerEnter);
      node.removeEventListener('pointerup', onPointerUp);
      node.removeEventListener('pointerleave', end);
      node.removeEventListener('pointercancel', end);
      node.removeEventListener('click', onClick, true);
      node.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('scroll', end, true);
      window.removeEventListener('pointerdown', ailleurs, true);
      if (tapOuvertePour === node) tapOuvertePour = null;
    },
  };
}
