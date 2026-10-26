import type { Card, PlayAs } from './types';
import { prechargerEffets } from './audio.svelte';
import type { SlotId } from './audioManifest';

/** Signature de la carte qui vient réellement d’être jouée, jamais de la simple sélection. */
export function annonceCarte(card: Card | undefined, as?: PlayAs): SlotId | null {
  if (!card) return null;
  switch (card.kind) {
    case 'tigress': return as === 'pirate' ? 'lame-tiree' : 'fuite';
    case 'pirate':
    case 'mate': return 'lame-tiree';
    case 'escape': return 'fuite';
    case 'pirateking': return 'roi-flibustiers';
    case 'mermaid': return 'sirene-capture';
    case 'kraken': return 'kraken-pose';
    case 'whale': return 'baleine-pose';
    default: return null;
  }
}

/** Les signatures rares se chargent à l’entrée en partie pour sonner dès leur première pose. */
export function preparerSonsCartes(): void {
  prechargerEffets(['lame-tiree', 'fuite', 'roi-flibustiers', 'sirene-capture', 'kraken-pose', 'baleine-pose']);
}
