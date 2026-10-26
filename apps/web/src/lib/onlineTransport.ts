// `GameTransport` en ligne : relaie les actions au serveur (`action{action}`) et redistribue
// les messages `view` (vue, échéance, sièges auto) et `error` du client WebSocket.
import type { Action, PlayerId, PlayerView } from './types';
import type { ClientMsg } from './protocol';
import type { WsClient } from './net';
import type { GameTransport } from './transport';
import { errorMessage } from './errors';

export class OnlineTransport implements GameTransport {
  private readonly offs: (() => void)[] = [];
  private closed = false;

  constructor(readonly client: WsClient) {}

  /** Lève si la connexion est tombée : le store affiche l'erreur, l'action n'est pas envoyée. */
  send(action: Action): void {
    if (this.closed) throw new Error('Partie fermée');
    // Les actions des cartes maison (`pass`) sont typées ici avant le moteur ; le serveur les valide.
    const msg = { type: 'action', action } as unknown as Extract<ClientMsg, { type: 'action' }>;
    if (!this.client.send(msg)) throw new Error('Connexion perdue — réessaie dans un instant');
  }

  onView(cb: (view: PlayerView) => void): () => void {
    return this.track(this.client.on('view', (m) => cb(m.view)));
  }

  onError(cb: (message: string) => void): () => void {
    // Le code fait foi ; le `msg` serveur n'est repris que s'il est propre (C10).
    // `superseded` (un autre onglet a la main) est porté par la bannière spectateur du module en ligne, pas en toast.
    const offErr = this.client.on('error', (m) => {
      if (m.code !== 'superseded') cb(errorMessage(m.code, m.msg, m.reason));
    });
    // Une coupure est dite une fois (`stale` puis `closed` ne la répètent pas) ; la bannière de la table fait le reste (#3).
    let down = this.client.state !== 'open' && this.client.state !== 'connecting';
    const offState = this.client.onState((s) => {
      if (s === 'open') down = false;
      else if ((s === 'closed' || s === 'stale') && !down) {
        down = true;
        cb('Connexion perdue — reconnexion…');
      }
    });
    return this.track(() => {
      offErr();
      offState();
    });
  }

  onDeadline(cb: (deadline: number | null) => void): () => void {
    return this.track(this.client.on('view', (m) => cb(m.deadline ?? null)));
  }

  /** Sièges joués par le serveur (timer expiré / joueur parti) — badge « auto ». */
  onAutoSeats(cb: (seats: PlayerId[]) => void): () => void {
    return this.track(this.client.on('view', (m) => cb(m.autoSeats ?? [])));
  }

  /** Se désabonne des messages ; la connexion elle-même reste ouverte (elle appartient à l'app). */
  close(): void {
    this.closed = true;
    for (const off of this.offs.splice(0)) off();
  }

  private track(off: () => void): () => void {
    this.offs.push(off);
    return off;
  }
}
