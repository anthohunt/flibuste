import { cardCatalog, cardNameFr, dealsOf, EXPANSION_NONE, type GameState, type Rules } from '@flibuste/engine';
import { realDeals } from './variants';

export const SOLO_RECORDS_KEY = 'flibuste:solo-records:v1';
export interface SoloConditions { rules: Rules; players: number; bots: unknown[]; dealt?: number[] }
export interface SoloRecord { id: string; at: number; name: string; total: number; conditions: SoloConditions; recovered?: true }
export interface SoloRecordGroup { key: string; best: SoloRecord; games: number }

/** Sorted keys make conditions comparable even after JSON reload; array order remains meaningful. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

export function normalConditions(c: SoloConditions): SoloConditions {
  const rules = c.rules;
  return { ...c, dealt: c.dealt ?? realDeals(rules, c.players), rules: { ...rules, rounds: dealsOf(rules).length, deals: dealsOf(rules), ghost: rules.ghost !== false,
    pirateAbilitiesOnPlay: !!rules.pirateAbilitiesOnPlay, expansion: { ...EXPANSION_NONE, ...rules.expansion }, custom: { storm: false, ...rules.custom } } };
}

export function readSoloRecords(): SoloRecord[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(SOLO_RECORDS_KEY) ?? '[]');
    if (!Array.isArray(data)) return [];
    return data.filter((r): r is SoloRecord => !!r && typeof r.id === 'string' && typeof r.name === 'string' && Number.isFinite(r.at) && Number.isFinite(r.total)
      && r.conditions && Number.isInteger(r.conditions.players) && r.conditions.players >= 2 && Array.isArray(r.conditions.bots)
      && r.conditions.rules && Number.isInteger(r.conditions.rules.rounds) && r.conditions.rules.rounds > 0);
  } catch { return []; }
}

/** The final round score is already definitive before the explicit transition to the podium. */
export function hasFinalSoloScore(state: Pick<GameState, 'phase' | 'round' | 'rules'>): boolean {
  return state.phase === 'gameOver' || (state.phase === 'roundEnd' && state.round === dealsOf(state.rules).length);
}

/** Called by the offline engine when the final score is persisted, before opening the podium. */
export function saveSoloRecord(state: GameState, setup: { seed: string; names: Record<string, string>; bots: Record<string, unknown> }, me = 'me', recovered = false): boolean {
  if (!hasFinalSoloScore(state) || !state.players.includes(me)) return false;
  const id = `solo:${setup.seed}`;
  try {
    const records = readSoloRecords();
    if (records.some((r) => r.id === id)) return true;
    const record: SoloRecord = { id, at: Date.now(), name: setup.names[me] ?? 'Moussaillon', total: state.scores[me] ?? 0, ...(recovered ? { recovered: true as const } : {}),
      conditions: normalConditions({ rules: state.rules, players: state.players.length, bots: state.players.filter((p) => p !== me).map((p) => setup.bots[p] ?? null) }) };
    localStorage.setItem(SOLO_RECORDS_KEY, JSON.stringify([...records, record]));
    return true;
  } catch { return false; }
}

export function soloRecordGroups(records = readSoloRecords()): SoloRecordGroup[] {
  const groups = new Map<string, SoloRecordGroup>();
  for (const record of records) {
    const key = canonical(normalConditions(record.conditions));
    const group = groups.get(key);
    if (!group) groups.set(key, { key, best: record, games: 1 });
    else { group.games++; if (record.total > group.best.total || (record.total === group.best.total && record.at > group.best.at)) group.best = record; }
  }
  return [...groups.values()].sort((a, b) => b.best.at - a.best.at);
}

export function conditionsLines(c: SoloConditions): string[] {
  const r = c.rules;
  const expansions: Record<string, string> = { colourCards: 'Numéros bonus 7, 8, 0/14', wild15: '15 joker', hexer: 'Mathilde la Sorcière', volley: 'Dernière salve', mate: 'Second', stingray: 'Raie tachetée', davyJones: 'Casier de Davy Jones', plank: 'Supplice de la planche' };
  const active = Object.entries(r.expansion ?? {}).filter(([, on]) => on).map(([key]) => expansions[key] ?? key);
  const selection = (r as Rules & { cardIds?: string[] | null }).cardIds;
  const actual = c.dealt ?? realDeals(r, c.players);
  const capped = actual.some((n, i) => n !== dealsOf(r)[i]);
  const cardNames = selection ? new Map(cardCatalog().map((card) => [card.id, `${cardNameFr(card)}${/^(escape|mermaid|loot)-\d+$/.test(card.id) ? ` (exemplaire ${card.id.split('-').at(-1)})` : card.kind === 'number' && card.expansion ? ' (bonus)' : ''}`])) : new Map<string, string>();
  return [
    `${c.players} joueurs · ${dealsOf(r).length} manche${dealsOf(r).length > 1 ? 's' : ''} · cartes par manche : ${actual.join(', ')}`,
    ...(capped ? [`Plan prévu : ${dealsOf(r).join(', ')}. Distribution plafonnée par le paquet et le nombre de mains.`] : []),
    `Kraken ${r.kraken ? 'oui' : 'non'} · Baleine ${r.whale ? 'oui' : 'non'} · Butin ${r.loot ? 'oui' : 'non'}`,
    `Pouvoirs de pirates ${r.pirateAbilities ? 'oui' : 'non'} · pouvoirs à la pose ${r.pirateAbilitiesOnPlay ? 'oui' : 'non'}`,
    `Extension : ${active.length ? active.join(', ') : 'aucune'}`,
    `Tempête ${r.custom?.storm ? 'oui' : 'non'}${c.players === 2 ? ` · Vieux Loup ${r.ghost !== false ? 'oui' : 'non'}` : ''}`,
    ...(selection ? [`Sélection de cartes personnalisée : ${selection.map((id) => cardNames.get(id) ?? 'Carte non reconnue').join(', ')}`] : []),
    ...(c.bots.length ? [`Adversaires : ${c.bots.map((b) => botDescription(b).split(' · ')[0]).join(', ')}`] : []),
  ];
}

export function botDescription(bot: unknown): string {
  const labels: Record<string, string> = { easy: 'Facile', normal: 'Moyen', hard: 'Difficile', ruthless: 'Impitoyable', custom: 'Personnalisé' };
  if (typeof bot === 'string') return labels[bot] ?? bot;
  if (!bot || typeof bot !== 'object') return 'Profil non renseigné';
  const b = bot as Record<string, unknown>;
  const p = b.profile && typeof b.profile === 'object' ? b.profile as Record<string, unknown> : b;
  const names: Record<string, string> = { force: 'Force', malice: 'Malice', prudence: 'Prudence', bonus: 'Bonus', memory: 'Mémoire', bluff: 'Bluff', powers: 'Pouvoirs' };
  return [labels[String(b.level)] ?? 'Personnalisé', ...Object.entries(names).filter(([key]) => typeof p[key] === 'number').map(([key, name]) => `${name} ${p[key]}/10`)].join(' · ');
}
