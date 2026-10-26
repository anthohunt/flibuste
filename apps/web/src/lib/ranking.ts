// Classement final avec ex æquo (C13) : même score = même rang (1, 1, 3). Le moteur a `ranking(state)` sur l'état
// complet (serveur) ; ici on classe depuis la vue (scores publics), même résultat.
import type { PlayerId } from './types';

export interface Ranked {
  id: PlayerId;
  score: number;
  /** Rang 1-based ; deux ex æquo partagent le rang. */
  rank: number;
}

export function rankPlayers(players: readonly PlayerId[], scores: Record<PlayerId, number>): Ranked[] {
  const sorted = players.map((id) => ({ id, score: scores[id] ?? 0 })).sort((a, b) => b.score - a.score);
  const out: Ranked[] = [];
  sorted.forEach((p, i) => {
    const prev = out[i - 1];
    out.push({ ...p, rank: prev && prev.score === p.score ? prev.rank : i + 1 });
  });
  return out;
}

/** Vrai si plusieurs joueurs partagent la première place. */
export function tiedFirst(ranked: readonly Ranked[]): boolean {
  return ranked.filter((r) => r.rank === 1).length > 1;
}
