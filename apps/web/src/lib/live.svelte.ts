// Région live (E2) : une seule voix pour tout ce qui change tout seul à la table — « Anne joue Albatros 9 »,
// « Pli remporté par Barbe-Noire », « À toi de jouer, 3 cartes jouables », « Manche 3 : pari »… — et une région
// `role="alert"` pour les erreurs. Les annonces sont dédoublonnées par clé : la même clé deux fois de suite se tait.
import type { PlayerId, PlayerView, TrickRecord } from './types';
import { cardLabel } from './cardMeta';

interface LiveState {
  /** Texte de la région `role="status"` (polie). */
  status: string;
  /** Texte de la région `role="alert"` (assertive). */
  alert: string;
}

export const live = $state<LiveState>({ status: '', alert: '' });

let lastKey: string | null = null;
let lastAlertKey: string | null = null;
let statusTimer: ReturnType<typeof setTimeout> | null = null;

/** Annonce polie ; `key` (par défaut le texte) évite de répéter deux fois la même chose de suite. */
export function announce(text: string, key: string = text): boolean {
  if (!text || key === lastKey) return false;
  lastKey = key;
  // Le même texte peut revenir plus tard (« À toi de jouer ») : on vide puis on remplit pour que le lecteur
  // d'écran voie un changement.
  live.status = '';
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    live.status = text;
    statusTimer = null;
  }, 30);
  return true;
}

/** Alerte (erreurs) : lue tout de suite ; dédoublonnée elle aussi. */
export function alert(text: string, key: string = text): boolean {
  if (!text || key === lastAlertKey) return false;
  lastAlertKey = key;
  live.alert = '';
  setTimeout(() => (live.alert = text), 30);
  return true;
}

/** Oublie les dernières clés (nouvelle partie, tests). */
export function resetLive() {
  lastKey = null;
  lastAlertKey = null;
  live.status = '';
  live.alert = '';
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = null;
}

// --- Ce que la table raconte ------------------------------------------------------------------------------------

export type NameOf = (id: PlayerId) => string;

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Phrases à annoncer entre deux vues (`prev` → `next`), dans l'ordre : nouvelle manche, cartes des autres, à toi. */
export function narrateView(prev: PlayerView | null, next: PlayerView, nameOf: NameOf, announcedPlays: Set<string>): string[] {
  const out: string[] = [];
  const me = next.me;
  const newRound = !prev || prev.round !== next.round;
  if (newRound) announcedPlays.clear();
  // Nouvelle manche / nouvelle phase de départ.
  if (next.phase === 'bidding' && (newRound || prev?.phase !== 'bidding')) out.push(`Manche ${next.round} : pari. ${plural(next.hand.length, 'carte', 'cartes')} en main.`);
  else if (next.phase === 'pass' && (newRound || prev?.phase !== 'pass')) out.push(`Manche ${next.round} : la Tempête, passe une carte à ton voisin.`);
  // Cartes posées par les autres depuis la dernière vue.
  const sameTrick = !!prev && prev.round === next.round && prev.history.length === next.history.length;
  if (sameTrick || newRound || (prev && prev.history.length !== next.history.length)) {
    for (const p of next.trick.plays) {
      const k = `${next.round}:${next.history.length}:${p.player}:${p.card.id}`;
      if (announcedPlays.has(k)) continue;
      announcedPlays.add(k);
      if (p.player !== me) out.push(`${nameOf(p.player)} joue ${cardLabel(p.card)}.`);
    }
  }
  // Fin de manche / de partie.
  if (next.phase === 'roundEnd' && prev?.phase !== 'roundEnd') out.push(`Manche ${next.round} terminée : les scores.`);
  if (next.phase === 'gameOver' && prev?.phase !== 'gameOver') out.push('Fin de partie : le classement.');
  // À moi.
  const myTurn = (next.phase === 'playing' || next.phase === 'volley') && next.currentPlayer === me;
  const wasMyTurn = !!prev && (prev.phase === 'playing' || prev.phase === 'volley') && prev.currentPlayer === me && prev.history.length === next.history.length && prev.trick.plays.length === next.trick.plays.length;
  if (myTurn && !wasMyTurn) {
    const legal = next.legal.filter((a) => a.type === 'play');
    const forced = me in next.forcedPlays;
    const detail = forced ? 'carte imposée par Mathilde la Sorcière' : plural(new Set(legal.map((a) => (a as { cardId: string }).cardId)).size, 'carte jouable', 'cartes jouables');
    out.push(`${next.phase === 'volley' ? 'Dernière salve : rejoue une carte' : 'À toi de jouer'}, ${detail}.`);
  }
  if (next.phase === 'ability' && next.currentPlayer === me && !(prev?.phase === 'ability' && prev.currentPlayer === me)) out.push('À toi : un pouvoir de pirate à jouer.');
  return out;
}

/** Fin de pli : qui l'emporte (ou personne). */
export function narrateTrick(rec: TrickRecord, nameOf: NameOf, me: PlayerId): string {
  if (rec.winner === null) {
    const why = rec.kraken ? 'le Kraken' : rec.whale ? 'la Baleine blanche' : rec.stingray ? 'la Raie tachetée' : null;
    return why ? `Pli défaussé par ${why}, personne ne le gagne.` : 'Pli sans gagnant.';
  }
  return rec.winner === me ? 'Pli remporté : il est pour toi.' : `Pli remporté par ${nameOf(rec.winner)}.`;
}
