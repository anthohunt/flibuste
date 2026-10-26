// Contrat client <-> serveur : les types viennent du serveur (source unique, import de type en relatif,
// effacé à la compilation — aucun code serveur n'entre dans le bundle). Les constantes sont redéclarées ici.
//
// Ré-audit 2026-09-06 : le serveur porte tout le contrat (`ready`, `restartRoom`, `replaceSeat`, `ping`/`pong`,
// `RoomView.ready / disconnectedSince / maxPlayers / left`, `error.reason`) — les surcouches locales de l'audit
// précédent sont retirées, les types serveur sont ré-exportés tels quels.
import type { ClientMsg as ServerClientMsg, RoomView as ServerRoomView, ServerMsg as ServerServerMsg } from '../../../server/src/protocol';
import type { BotLevel, TimerMode } from '../../../server/src/protocol';

export type { BotLevel, BotProfile, Reaction, ErrorCode, PushSubscriptionJSON, RoomStatus, SeatView, TimerMode } from '../../../server/src/protocol';
import type { SeatView } from '../../../server/src/protocol';

export type RoomView = ServerRoomView;
export type ClientMsg = ServerClientMsg;
export type ServerMsg = ServerServerMsg;

/** Raisons d'illégalité (`error.reason`, `RuleError.reason`) ; `malformed` est celle du moteur hors-ligne. */
export type IllegalReason = 'not-your-turn' | 'must-follow-suit' | 'forced-card' | 'storm-first' | 'bad-phase' | 'bad-value' | 'malformed';

/** Codes de salle : le serveur en génère à 6 lettres ; les anciennes salles (4 lettres) restent acceptées. */
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_MIN = 4;
export const ROOM_CODE_RE = /^[A-Z]{4,6}$/;

export const TIMER_MODES: readonly TimerMode[] = ['30s', '2m', 'none', 'async'];
/** Vague 6 : quatre niveaux (Impitoyable en plus) ; `'custom'` = profil personnalisé (`SeatView.botLevel`). */
export const BOT_LEVELS: readonly BotLevel[] = ['easy', 'normal', 'hard', 'ruthless'];

export const TIMER_LABEL: Record<TimerMode, string> = {
  '30s': '30 s',
  '2m': '2 min',
  none: 'Sans limite',
  async: 'Au fil de l’eau',
};
export const TIMER_HINT: Record<TimerMode, string> = {
  '30s': 'Passé 30 s, le serveur joue pour toi',
  '2m': 'Passé 2 min, le serveur joue pour toi',
  none: 'Chacun joue quand il veut, la table attend',
  async: 'Sans limite, et une notification quand c’est ton tour',
};
export const LEVEL_LABEL: Record<BotLevel | 'custom', string> = { easy: 'Facile', normal: 'Normal', hard: 'Difficile', ruthless: 'Impitoyable', custom: 'Perso' };

/** Id d'un siège tel que le moteur le voit : le joueur humain, ou `bot:CODE:idx` pour un bot (cf. Room.botId). */
export function seatPlayerId(code: string, seat: { idx: number; playerId: string | null }): string {
  return seat.playerId ?? `bot:${code}:${seat.idx}`;
}

/**
 * Nombre de sièges d'une salle : le serveur le dit, POINT. Il tient la seule définition qui compte (il
 * appelle `maxPlayersFor` du moteur) ; recalculer la formule ici ne peut produire qu'un deuxième avis, et
 * c'est exactement ce qui faisait annoncer 9 sièges à un salon que le serveur refusait de remplir au-delà
 * de 8. Le repli à 8 ne sert qu'avant la première `RoomView` reçue, quand il n'y a encore aucun siège à
 * dessiner.
 */
export function roomMaxPlayers(room: RoomView | null | undefined): number {
  return room?.maxPlayers ?? 8;
}

/**
 * L'identité du siège visé par `removeSeat` / `setBot`. MÊME FORMULE que `seatKey` du serveur
 * (`apps/server/src/protocol.ts`) — redéclarée ici comme les autres constantes du contrat, pour qu'aucun
 * code serveur n'entre dans le bundle ; les deux évoluent ensemble.
 *
 * Elle existe parce qu'un NUMÉRO de siège bouge : un départ dans le salon réindexe toute la table, et le
 * clic du capitaine arrive après. Sans elle, il vise Chloé et c'est David qui part.
 */
export function seatKey(seat: Pick<SeatView, 'playerId' | 'name'>): string {
  return seat.playerId ? `p:${seat.playerId}` : `b:${seat.name}`;
}
