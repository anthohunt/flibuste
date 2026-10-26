import type { Action, PlayerId, PlayerView } from './types';

/**
 * Canal entre l'UI et une partie, quelle que soit sa localisation.
 * - hors-ligne : `OfflineGame` (moteur + bots dans le navigateur) ;
 * - en ligne : client WebSocket (tâche 16), qui relaie `send` au serveur et `onView` depuis lui.
 * `send` d'une action illégale : lève (hors-ligne, `RuleError`) ou signale via `onError` (en ligne).
 */
export interface GameTransport {
  send(action: Action): void;
  /** S'abonne aux vues successives ; renvoie la fonction de désabonnement. */
  onView(cb: (view: PlayerView) => void): () => void;
  /** Erreurs asynchrones (action refusée par le serveur, déconnexion…). */
  onError?(cb: (message: string) => void): () => void;
  /** Échéance du tour courant (timer serveur), en ms epoch ; null = pas de timer. */
  onDeadline?(cb: (deadline: number | null) => void): () => void;
  /** Sièges joués par le serveur (timer expiré, joueur parti) ; vide hors-ligne. */
  onAutoSeats?(cb: (seats: PlayerId[]) => void): () => void;
  close?(): void;
}
