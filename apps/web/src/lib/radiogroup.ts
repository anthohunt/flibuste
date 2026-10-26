// Groupe de radios ARIA au clavier (motif WAI-ARIA « Radio Group », E6) : les flèches changent la valeur et
// déplacent le focus ; un seul arrêt de tabulation (le bouton coché, sinon le premier). Action Svelte
// `use:radiogroup` sur l'élément `role="radiogroup"` ; les enfants `role="radio"` gardent leur `onclick`.
export function radiogroup(node: HTMLElement) {
  const radios = () => [...node.querySelectorAll<HTMLElement>('[role="radio"]')];

  function retab() {
    const list = radios();
    const checked = list.find((r) => r.getAttribute('aria-checked') === 'true') ?? list[0];
    for (const r of list) r.tabIndex = r === checked ? 0 : -1;
  }

  function onKey(e: KeyboardEvent) {
    const list = radios();
    const i = list.indexOf(e.target as HTMLElement);
    if (i < 0 || list.length === 0) return;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % list.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      list[i]!.click();
      return;
    }
    if (next < 0) return;
    e.preventDefault();
    const target = list[next]!;
    target.click();
    target.focus();
  }

  retab();
  node.addEventListener('keydown', onKey);
  const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(retab) : null;
  mo?.observe(node, { subtree: true, attributes: true, attributeFilter: ['aria-checked'], childList: true });
  return {
    destroy() {
      node.removeEventListener('keydown', onKey);
      mo?.disconnect();
    },
  };
}
