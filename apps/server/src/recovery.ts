// Au démarrage : les salles en lobby encore vivantes sont restaurées, les parties en cours sont rejouées
// depuis leur journal d'actions (moteur déterministe : newGame + log = même état), puis bots, timers et
// délais de grâce repartent. Les salles de plus de 7 jours sont closes ; les lobbies sans aucun humain
// sont supprimés ; une partie que tous ses humains ont quittée est close ; une partie dont le journal est
// incomplet est REFUSÉE plutôt que ressuscitée amputée, et ses joueurs l'apprennent en revenant.

import { replay } from '@flibuste/engine';
import type { Hub } from './hub';
import { ROOM_MAX_AGE_MS } from './room';

export function recover(hub: Hub): { lobbies: number; games: number; closed: number; deleted: number } {
  const stats = { lobbies: 0, games: 0, closed: 0, deleted: 0 };
  const now = Date.now();
  for (const row of hub.db.listRooms(['lobby', 'playing'])) {
    if (now - row.created > ROOM_MAX_AGE_MS) {
      hub.db.setRoomStatus(row.code, 'over');
      stats.closed++;
      continue;
    }
    const seats = hub.db.getSeats(row.code);
    if (row.status === 'lobby') {
      // Un salon ne se juge PAS sur son silence. `updated` ne bouge qu'aux changements de salle et aux
      // (dé)connexions : un salon où l'on discute depuis plus que la grâce n'a rien écrit depuis autant de
      // temps, et il était SUPPRIMÉ au redémarrage alors que tout le monde y était — mesuré (a12.1) :
      // 5 joueurs tous connectés, « 1 deleted », puis « Pas de table JKWSFS » pour chacun d'eux.
      //
      // Le seul critère qui tienne est celui que le serveur applique déjà en marche : on restaure, et la
      // grâce décide. `Room.restore` fait repartir chaque déconnexion du REDÉMARRAGE (c'est lui qui vient
      // de couper tout le monde), donc un salon mort meurt de lui-même une grâce plus tard, par
      // `onGraceExpired` → `dropSeat` → `deleteRoom`, exactement comme en fonctionnement normal.
      if (seats.every((s) => s.playerId === null)) {
        hub.db.deleteRoom(row.code);
        stats.deleted++;
        continue;
      }
      hub.restoreRoom(row, seats, null).restart();
      stats.lobbies++;
      continue;
    }
    // Refuser une partie, c'est la perdre : ça se dit deux fois. Dans le journal du serveur, et à chaque
    // joueur qui y était assis quand il revient avec son code (`Hub.noteClosedAtRecovery`) — sans quoi il ne
    // voyait qu'un « Pas de table », indiscernable d'une faute de frappe.
    const refuser = (pourquoi: string, auJoueur: string) => {
      console.error(`[recovery] room ${row.code}: ${pourquoi} ; la salle est close plutôt que rejouée`);
      hub.db.setRoomStatus(row.code, 'over');
      hub.noteClosedAtRecovery(row.code, auJoueur, seats.flatMap((s) => (s.playerId ? [s.playerId] : [])));
      stats.closed++;
    };
    // Tous les humains avaient QUITTÉ la partie (une base écrite avant que `Room.leave` n'arrête ces
    // parties-là) : la rejouer, c'est faire tourner des bots pour personne jusqu'à l'abandon.
    const humains = seats.filter((s) => s.playerId !== null);
    if (humains.length > 0 && humains.every((s) => s.hasLeft)) {
      hub.db.setRoomStatus(row.code, 'over');
      stats.closed++;
      continue;
    }
    const game = row.gameId ? hub.db.getGame(row.gameId) : undefined;
    if (!game) {
      refuser('partie introuvable en base', `La partie ${row.code} n'a pas pu être reprise après le redémarrage du serveur : elle est close.`);
      continue;
    }
    try {
      const journal = hub.db.getActions(game.id);
      // LE GARDE-FOU DU JOURNAL. `games.nbActions` est écrit dans la même transaction que chaque coup
      // (`db.appendAction`) : c'est le seul témoin indépendant du journal lui-même. S'ils ne disent pas la
      // même chose, il manque des coups, et rejouer donnerait une table qui RECULE — mesuré en effaçant
      // les 3 dernières lignes de `actions` : le siège j0-0 repassait de seq 63 à 60, sans une erreur
      // côté client, sans une ligne dans le journal du serveur, et les joueurs rejouaient des coups déjà
      // joués. On perd la même partie qu'avant, mais on la perd EN LE DISANT.
      if (journal.length !== game.nbActions) {
        refuser(
          `journal incomplet (${journal.length} action(s) lues, ${game.nbActions} appliquées)`,
          `La partie ${row.code} n'a pas survécu au redémarrage du serveur : des coups manquaient, et la reprendre l'aurait fait revenir en arrière. Elle est close.`,
        );
        continue;
      }
      const state = replay(game.players, game.rules, game.seed, journal);
      if (state.phase === 'gameOver') {
        hub.db.completeRankedGame(game.id, state, seats);
        hub.db.setRoomStatus(row.code, 'over');
        stats.closed++;
        continue;
      }
      // Le dernier signe de vie d'une partie, c'est son dernier COUP — `rooms.updated` ne le sait pas, il
      // ne bouge qu'aux changements de salle. C'est de là que repart le minuteur d'abandon (`Room.restart`),
      // sans quoi une salle morte se fait réarmer six heures fraîches à chaque relance et ne meurt jamais.
      const vivant = Math.max(row.updated || row.created, hub.db.lastActionAt(game.id) ?? 0);
      const room = hub.restoreRoom({ ...row, updated: vivant }, seats, state);
      room.restart();
      stats.games++;
    } catch (err) {
      refuser(`replay failed (${(err as Error).message})`, `La partie ${row.code} n'a pas pu être reprise après le redémarrage du serveur : elle est close.`);
    }
  }
  return stats;
}
