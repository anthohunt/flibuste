// Requête média réactive (runes) : `const compact = mediaQuery('(max-height: 520px)')` → `compact.matches`.
// Sans `matchMedia` (jsdom), toujours faux.
export function mediaQuery(query: string): { readonly matches: boolean } {
  const state = $state({ matches: false });
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mq = window.matchMedia(query);
    state.matches = mq.matches;
    mq.addEventListener?.('change', (e) => (state.matches = e.matches));
  }
  return state;
}
