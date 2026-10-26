// Absences à la table (ré-audit 2026-09-06, #1 #2 #22 #25) : qui a décroché, depuis combien de temps, quand le siège
// pourra être confié à un bot, à qui passera le capitanat. Fonctions pures (testées avec une horloge simulée) ;
// `Table.svelte` et `GameOver.svelte` ne font que les afficher.
import type { PlayerId } from '@flibuste/engine';
import type { RoomView, SeatView } from './protocol';

/** Délai serveur avant qu'un siège déconnecté puisse être remplacé (contrat : 60 s, tous les rythmes). */
export const REPLACE_AFTER_MS = 60_000;
/** Délai serveur avant que le capitanat d'un hôte déconnecté passe au premier humain connecté (contrat : 60 s). */
export const HOST_HANDOVER_MS = 60_000;

/** Humains partis explicitement (contrat `room.left`). */
export const leftOf = (room: RoomView | null | undefined): PlayerId[] => room?.left ?? [];

/** Secondes entières restantes avant `delay` depuis `since` ; 0 dès que le délai est passé ; null si la date manque. */
export function secondsLeft(since: number | null | undefined, now: number, delay: number): number | null {
  if (since === null || since === undefined) return null;
  return Math.max(0, Math.ceil((delay - (now - since)) / 1000));
}

/** Prochain capitaine si l'hôte ne revient pas : premier humain connecté (ordre des sièges) qui n'a pas quitté. */
export function nextCaptain(room: RoomView): SeatView | null {
  const left = new Set(leftOf(room));
  const humans = room.seats.filter((s) => s.playerId !== null && s.playerId !== room.host);
  return humans.find((s) => s.connected && !left.has(s.playerId!)) ?? humans.find((s) => s.connected) ?? null;
}

export interface Absence {
  seat: number;
  id: PlayerId;
  name: string;
  /** Parti explicitement (« a quitté la table ») plutôt que déconnecté. */
  left: boolean;
  /** C'est le capitaine qui manque. */
  isHost: boolean;
  /** Secondes avant de pouvoir le remplacer ; 0 = maintenant ; null = inconnu (pas de date). */
  replaceIn: number | null;
  /** Le bouton « Remplacer par un bot » a un sens (partie en cours, délai écoulé ou joueur parti). */
  replaceable: boolean;
  /** « Alice a perdu la connexion · remplacement possible dans 42 s », « Alice a quitté la table »… */
  text: string;
  /** Pour le capitaine absent : « Le capitanat passera à Bob dans 40 s » ; null sinon. */
  handover: string | null;
}

/**
 * Sièges humains absents (déconnectés ou partis), hors moi et hors sièges déjà confiés à un bot, avec le texte
 * de la bannière à l'instant `now`. `meName` sert à dire « toi » quand le capitanat me revient.
 */
export function absences(room: RoomView | null, me: PlayerId, now: number, opts: { replaceAfterMs?: number; handoverMs?: number } = {}): Absence[] {
  if (!room) return [];
  const replaceAfter = opts.replaceAfterMs ?? REPLACE_AFTER_MS;
  const handoverMs = opts.handoverMs ?? HOST_HANDOVER_MS;
  const since = room.disconnectedSince;
  const left = new Set(leftOf(room));
  const playing = room.status === 'playing';
  const heir = nextCaptain(room);
  return room.seats
    .filter((s) => s.playerId !== null && s.playerId !== me && !s.botLevel && (!s.connected || left.has(s.playerId)))
    .map((s) => {
      const id = s.playerId!;
      const gone = left.has(id);
      const isHost = room.host === id;
      const replaceIn = gone ? 0 : secondsLeft(since[id] ?? null, now, replaceAfter);
      const replaceable = playing && replaceIn === 0;
      let text: string;
      if (gone) text = `${s.name} a quitté la table`;
      else if (replaceIn === null) text = `${s.name} a perdu la connexion…`;
      else if (replaceIn > 0) text = `${s.name} a perdu la connexion · remplacement possible dans ${replaceIn} s`;
      else text = `${s.name} a perdu la connexion`;
      let handover: string | null = null;
      if (isHost && heir) {
        const who = heir.playerId === me ? 'toi' : heir.name;
        const inS = gone ? 0 : secondsLeft(since[id] ?? null, now, handoverMs);
        handover = inS === null ? `Le capitanat passera à ${who}` : inS > 0 ? `Le capitanat passera à ${who} dans ${inS} s` : `Le capitanat passe à ${who}`;
      }
      return { seat: s.idx, id, name: s.name, left: gone, isHost, replaceIn, replaceable, text, handover };
    });
}

export interface OverStatus {
  /** Noms de ceux qui ont quitté la table (hors moi). */
  leftNames: string[];
  /** Le capitaine (tel que la salle le dit) a quitté la table : personne ne relancera sans transfert. */
  hostLeft: boolean;
  /** Tous les autres humains sont partis : attendre n'a plus de sens. */
  othersGone: boolean;
}

/** Fin de partie en ligne : qui est parti, et s'il reste quelqu'un à attendre (#2, #22). */
export function overStatus(room: RoomView | null, me: PlayerId): OverStatus {
  if (!room) return { leftNames: [], hostLeft: false, othersGone: false };
  const left = new Set(leftOf(room));
  const others = room.seats.filter((s) => s.playerId !== null && s.playerId !== me);
  return {
    leftNames: others.filter((s) => left.has(s.playerId!)).map((s) => s.name),
    hostLeft: left.has(room.host),
    othersGone: others.length > 0 && others.every((s) => left.has(s.playerId!)),
  };
}
