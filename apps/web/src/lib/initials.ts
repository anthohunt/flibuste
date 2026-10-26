// Initiales d'un pseudo par graphème (emoji et drapeaux compris), jamais un demi-surrogate (C13).
let segmenter: { segment: (s: string) => Iterable<{ segment: string }> } | null | undefined;

function firstGrapheme(word: string): string {
  if (segmenter === undefined) {
    try {
      const Seg = (Intl as unknown as { Segmenter?: new (locale: string, opts: { granularity: string }) => typeof segmenter }).Segmenter;
      segmenter = Seg ? new Seg('fr', { granularity: 'grapheme' }) : null;
    } catch {
      segmenter = null;
    }
  }
  if (segmenter) {
    for (const g of segmenter.segment(word)) return g.segment;
  }
  return Array.from(word)[0] ?? '';
}

/** Une ou deux initiales : première lettre (majuscule) des deux premiers mots ; « ? » si vide. */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/[\s\-_]+/)
    .filter(Boolean)
    .slice(0, 2);
  const out = words.map((w) => firstGrapheme(w).toLocaleUpperCase('fr')).join('');
  return out || '?';
}
