// Bot de repli : une action légale au hasard. Utilisé tant que `@flibuste/bots` n'est pas
// disponible, et comme filet de sécurité si un bot lève une exception.

import type { Action, PlayerView } from '@flibuste/engine';
import crypto from 'node:crypto';

export function randomLegalAction(view: PlayerView): Action | null {
  if (view.legal.length === 0) return null;
  return view.legal[crypto.randomInt(view.legal.length)] as Action;
}
