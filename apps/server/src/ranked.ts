import { dealsOf, EXPANSION_ALL, EXPANSION_NONE, type Rules } from '@flibuste/engine';

export type RankedFormat = 'classic' | 'full';
export const RANKED_NAMES: Record<RankedFormat, string> = { classic: 'Classique', full: 'Classique + extension' };
const RULE_KEYS = new Set(['kraken', 'whale', 'loot', 'pirateAbilities', 'pirateAbilitiesOnPlay', 'rounds', 'deals', 'ghost', 'expansion', 'custom', 'cardIds']);

/** Fail closed: a future rule cannot silently enter a comparable format. No client eligibility flag. */
export function rankedFormat(r: Rules): RankedFormat | null {
  if (Object.keys(r).some((key) => !RULE_KEYS.has(key))) return null;
  if ((r as Rules & { cardIds?: string[] | null }).cardIds != null || r.pirateAbilitiesOnPlay || !r.pirateAbilities || r.ghost === false) return null;
  if (r.rounds !== 10 || dealsOf(r).length !== 10 || dealsOf(r).some((n, i) => n !== i + 1)) return null;
  if (Object.entries(r.custom ?? {}).some(([key, value]) => key !== 'storm' || value !== false)) return null;
  if (Object.keys(r.expansion ?? {}).some((key) => !(key in EXPANSION_ALL))) return null;
  const exp = { ...EXPANSION_NONE, ...r.expansion };
  if (!r.kraken && !r.whale && !r.loot && Object.values(exp).every((v) => v === false)) return 'classic';
  if (r.kraken && r.whale && r.loot && Object.values(exp).every((v) => v === true)) return 'full';
  return null;
}

export interface RankedEntry { playerId: string; nom: string; meilleur: number; parties: number; dernier: number; gameId: string; conditions: { rules: Rules; players: number; bots: never[] } }
export interface RankedBoard { entrees: RankedEntry[]; parties: number; format: RankedFormat; players: number; historical: number }
