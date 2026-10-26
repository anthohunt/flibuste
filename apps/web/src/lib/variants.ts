// Vague 5 (2026-09-06) : variantes classiques de manches (`rules.deals`) et Vieux Loup, le troisième joueur
// fantôme de la règle standard à deux (`rules.ghost`). Le moteur (`@flibuste/engine`) est la source de
// vérité (`DEAL_VARIANTS`, `dealsOf`, `GHOST_ID`, `GHOST_RULE_FR`) ; ce module n'ajoute que ce qui sert
// à l'écran : aperçu, variante courante, application d'une variante, Vieux Loup ON par défaut à deux.
import { DEAL_VARIANTS, GHOST_ID, GHOST_RULE_FR, buildDeck, dealsOf as engineDealsOf, type DealVariant } from '@flibuste/engine';
import type { PlayerId, Rules } from './types';

export { DEAL_VARIANTS, GHOST_ID, GHOST_RULE_FR };
export type { DealVariant };
export const GHOST_NAME = 'Vieux Loup';

const range = (n: number) => Array.from({ length: Math.max(0, n) }, (_, i) => i + 1);

/** Une manche ne distribue jamais plus de 10 cartes (variantes des règles). */
export const MAX_DEAL = 10;

/** Cartes distribuées par manche : `rules.deals`, sinon 1..rounds (classique) — le moteur décide, garde-fou sur des `deals` malformés. */
export function dealsOf(rules: Pick<Rules, 'rounds'> & { deals?: number[] }): number[] {
  const d = rules.deals;
  const clean = Array.isArray(d) && d.length > 0 && d.every((n) => Number.isInteger(n) && n >= 1 && n <= 10) ? d : undefined;
  const out = engineDealsOf({ ...(rules as Rules), deals: clean });
  return out.length > 0 ? out : range(rules.rounds ?? 10);
}

/** Nombre de manches d'une table (les `deals` font foi, `rounds` en repli). */
export function roundsOf(rules: Pick<Rules, 'rounds'> & { deals?: number[] }): number {
  return dealsOf(rules).length;
}

/** Cartes de la manche `round` (1-based) ; `round` en repli si la manche n'existe pas. */
export function cardsInRound(rules: Pick<Rules, 'rounds'> & { deals?: number[] }, round: number): number {
  return dealsOf(rules)[round - 1] ?? round;
}

const sameDeals = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((n, i) => n === b[i]);

/** Variante correspondant aux règles (null si aucune : « Autre »). */
export function variantOf(rules: Pick<Rules, 'rounds'> & { deals?: number[] }): DealVariant | null {
  const deals = dealsOf(rules);
  return DEAL_VARIANTS.find((v) => sameDeals(v.deals, deals)) ?? null;
}

/** Règles avec la variante `id` : `deals` + `rounds = deals.length` (compat serveur / moteur). */
export function applyVariant<R extends Rules>(rules: R, id: string): R {
  const v = DEAL_VARIANTS.find((x) => x.id === id);
  if (!v) return rules;
  return { ...rules, deals: [...v.deals], rounds: v.deals.length };
}

/** Plan de manches personnalisé (vague 6) : `rounds` manches (1–10), `start` cartes au départ (1–10), +1 par manche, plafonné à 10. */
export function customDeals(rounds: number, start: number): number[] {
  const n = Math.max(1, Math.min(10, Math.round(Number(rounds) || 1)));
  const s0 = Math.max(1, Math.min(10, Math.round(Number(start) || 1)));
  return Array.from({ length: n }, (_, i) => Math.min(10, s0 + i));
}

/** Les deux curseurs qui décrivent des `deals` (manches, cartes de départ) — pour un plan qui n'est pas une variante. */
export function customParamsOf(deals: readonly number[]): { rounds: number; start: number } {
  return { rounds: Math.max(1, Math.min(10, deals.length || 1)), start: Math.max(1, Math.min(10, deals[0] ?? 1)) };
}

/** Règles avec un plan personnalisé : `deals` + `rounds = deals.length`. */
export function applyCustomDeals<R extends Rules>(rules: R, rounds: number, start: number): R {
  const deals = customDeals(rounds, start);
  return { ...rules, deals, rounds: deals.length };
}

/**
 * Cartes distribuables au plus par main à cette table : le paquet divisé par le nombre de mains — Vieux Loup en
 * tient une à deux joueurs. C'est le plafond que le moteur applique vraiment (`engine/src/legal.ts` `dealSize`) :
 * à 8 joueurs, un paquet classique de 70 cartes ne donne que 8 cartes par main, pas 10 (FONC-05).
 * `seats` inconnu ou plus petit que 2 : aucun plafond (10, le maximum d'une variante).
 */
export function dealCap(rules: Pick<Rules, 'rounds'> & Partial<Rules>, seats: number): number {
  const n = Math.floor(Number(seats) || 0);
  if (n < 2) return MAX_DEAL;
  const hands = n + (ghostOn(rules, n) ? 1 : 0);
  const deck = buildDeck(rules as Rules, n).length;
  return Math.max(1, Math.min(MAX_DEAL, Math.floor(deck / hands)));
}

/** Le plan de manches tel que la partie le distribuera : chaque manche plafonnée par le paquet (`dealCap`). */
export function cappedDeals(deals: readonly number[], cap: number): number[] {
  return deals.map((n) => Math.min(n, cap));
}

/** Le plan de la table, plafonné par le paquet : ce que le salon doit annoncer, à la carte près. */
export function realDeals(rules: Pick<Rules, 'rounds'> & Partial<Rules>, seats: number): number[] {
  return cappedDeals(dealsOf(rules), dealCap(rules, seats));
}

/** Le plafond mord-il ? (au moins une manche annoncée est rabotée par le paquet) */
export function isCapped(deals: readonly number[], cap: number): boolean {
  return deals.some((n) => n > cap);
}

/** « 8 cartes au plus à 8 joueurs » — la phrase qui dit pourquoi le plan est raboté. */
export function capNoticeFr(cap: number, seats: number): string {
  return `${cap} carte${cap > 1 ? 's' : ''} au plus à ${seats} joueur${seats > 1 ? 's' : ''} : le paquet ne va pas plus loin.`;
}

/** Aperçu « 6 · 7 · 8 · 9 · 10 » ; répétitions compactées (« 5 cartes × 5 manches »). */
export function dealPreview(deals: readonly number[]): string {
  if (deals.length === 0) return '';
  if (deals.length > 1 && deals.every((n) => n === deals[0])) return `${deals[0]} cartes × ${deals.length} manches`;
  return deals.join(' · ');
}

/**
 * La restriction officielle à deux joueurs, appliquée par le moteur **sans condition** dès
 * `nPlayers === 2` — Vieux Loup à table ou non (`engine/src/cards.ts` : `wild15`, `plank` et les `flex14`
 * sortent du paquet). Le salon doit l'annoncer dans les deux cas (CT-07).
 */
export const TWO_PLAYER_REMOVED_FR = 'À deux, le 15 joker, le Supplice de la planche et les 0/14 sortent du paquet, même si tu les allumes.';

/** Les interrupteurs que cette restriction rend sans effet à deux joueurs (le 0/14 vient avec « Numéros bonus »). */
export const TWO_PLAYER_MUTED_RULES: readonly string[] = ['wild15', 'plank'];

/** Vieux Loup est-il à table ? Seulement à deux joueurs, et à moins d'être débranché (`rules.ghost === false`). */
export function ghostOn(rules: Partial<Pick<Rules, 'ghost'>> | Rules | null | undefined, playerCount: number): boolean {
  return playerCount === 2 && (rules?.ghost ?? true);
}

export const isGhost = (id: PlayerId | null | undefined): boolean => id === GHOST_ID;
