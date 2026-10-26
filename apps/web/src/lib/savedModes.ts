import { validateCardIds, type Rules } from '@flibuste/engine';
import { EMPTY_EXPANSION } from './rulesMeta';

export const SAVED_MODES_KEY = 'flibuste:saved-modes:v1';
export interface SavedMode { id: string; name: string; rules: Rules; updatedAt: number }

/** Copy only game settings, never identity, seats, credentials or live-game state. */
export function copyModeRules(value: unknown): Rules {
  if (!value || typeof value !== 'object') throw new Error('Les règles de ce mode sont illisibles.');
  const rules = value as Rules;
  const deals = rules.deals == null ? undefined : rules.deals;
  if (deals !== undefined && (!Array.isArray(deals) || deals.length < 1 || deals.length > 10 || deals.some((n) => !Number.isInteger(n) || n < 1 || n > 10)))
    throw new Error('Le plan des manches de ce mode est invalide.');
  const rounds = deals?.length ?? rules.rounds;
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10) throw new Error('Le nombre de manches de ce mode est invalide.');
  const out: Rules = { kraken: !!rules.kraken, whale: !!rules.whale, loot: !!rules.loot, pirateAbilities: !!rules.pirateAbilities, rounds };
  if (deals) out.deals = [...deals];
  if (rules.ghost !== undefined) out.ghost = !!rules.ghost;
  if (rules.pirateAbilitiesOnPlay !== undefined) out.pirateAbilitiesOnPlay = !!rules.pirateAbilitiesOnPlay;
  if (rules.expansion) {
    const expansion = { ...EMPTY_EXPANSION };
    for (const key of Object.keys(EMPTY_EXPANSION) as (keyof typeof EMPTY_EXPANSION)[]) expansion[key] = !!rules.expansion[key];
    out.expansion = expansion;
  }
  if (rules.custom) out.custom = { storm: !!rules.custom.storm };
  if (rules.cardIds != null) out.cardIds = validateCardIds(rules.cardIds);
  return out;
}

function cleanName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 40) throw new Error('Donne un nom de 1 à 40 caractères à ce mode.');
  return name;
}

/** Read fresh for each mutation so saving in another tab does not discard its modes. */
export function loadSavedModes(): SavedMode[] {
  const raw = localStorage.getItem(SAVED_MODES_KEY);
  if (raw === null) return [];
  let data: { version?: unknown; modes?: unknown };
  try { data = JSON.parse(raw); } catch { throw new Error('Les modes enregistrés sont illisibles. Ils n’ont pas été modifiés.'); }
  if (!data || data.version !== 1 || !Array.isArray(data.modes)) throw new Error('Le format des modes enregistrés est inconnu. Ils n’ont pas été modifiés.');
  const ids = new Set<string>();
  return data.modes.map((value: unknown) => {
    const mode = value as Partial<SavedMode> | null;
    if (!mode || typeof mode.id !== 'string' || !mode.id || ids.has(mode.id) || typeof mode.name !== 'string' || !Number.isFinite(mode.updatedAt))
      throw new Error('Un mode enregistré est illisible. Les sauvegardes n’ont pas été modifiées.');
    ids.add(mode.id);
    return { id: mode.id, name: cleanName(mode.name), rules: copyModeRules(mode.rules), updatedAt: mode.updatedAt! };
  });
}

function writeModes(modes: SavedMode[]): void {
  try { localStorage.setItem(SAVED_MODES_KEY, JSON.stringify({ version: 1, modes })); }
  catch { throw new Error('Impossible d’enregistrer sur cet appareil : le stockage est plein ou indisponible.'); }
}

/** Omit id to create; an explicit id updates exactly that saved mode, including its name. */
export function saveNamedMode(name: string, rules: Rules, id?: string): SavedMode {
  const modes = loadSavedModes();
  const label = cleanName(name);
  if (id && !modes.some((mode) => mode.id === id)) throw new Error('Ce mode a été supprimé. Enregistre-le comme nouveau mode.');
  if (modes.some((mode) => mode.id !== id && mode.name.toLocaleLowerCase('fr') === label.toLocaleLowerCase('fr')))
    throw new Error('Ce nom existe déjà. Choisis ce mode pour le mettre à jour, ou donne un autre nom.');
  const saved = { id: id ?? crypto.randomUUID(), name: label, rules: copyModeRules(rules), updatedAt: Date.now() };
  const next = id ? modes.map((mode) => mode.id === id ? saved : mode) : [...modes, saved];
  writeModes(next);
  return saved;
}

export function deleteSavedMode(id: string): void {
  const modes = loadSavedModes();
  if (!modes.some((mode) => mode.id === id)) throw new Error('Ce mode a déjà été supprimé.');
  writeModes(modes.filter((mode) => mode.id !== id));
}
